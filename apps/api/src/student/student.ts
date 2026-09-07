import { Body, Controller, Get, Injectable, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiForbiddenResponse, ApiTags, ApiUnauthorizedResponse } from "@nestjs/swagger";
import { AccountType, AttemptStatus, Prisma, QuestionResultStatus, ResolutionMode, SessionStatus, UnlockSource } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { answerSubmissionSchema, reflectionSchema, type MissionAccessDto } from "@carbon/contracts";
import { answerRuleSchema } from "@carbon/content-schema";
import { candidateScore, evaluateAnswer } from "@carbon/game-rules";
import { AuthUser, CurrentUser, JwtAuthGuard } from "../common/auth";
import { apiError } from "../common/api-error";
import { PrismaService } from "../common/prisma.service";
import { ScoringService } from "./scoring.service";
import { AnswerSubmissionDto, ReflectionDto, ValueChainNodeDto } from "../openapi/request-dtos";

type RuntimeState = { viewedNodes?: string[]; reflection?: string; hintUsed?: boolean; revealUsed?: boolean; currentQuestionId?: string };
const json = (value: unknown) => value as Prisma.InputJsonValue;
const hashRequest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

@Injectable()
export class StudentService {
  constructor(private readonly prisma: PrismaService, private readonly scoring: ScoringService) {}

  private ensureStudent(user: AuthUser) { if (user.accountType !== AccountType.STUDENT) apiError(403, "FORBIDDEN", "Student account required"); }

  async activeSessions(user: AuthUser) {
    this.ensureStudent(user);
    const profile = await this.prisma.studentProfile.findUnique({ where: { userId: user.userId } });
    if (!profile) apiError(409, "PROFILE_INCOMPLETE", "Complete your student profile first");
    const sessions = await this.prisma.workshopSession.findMany({
      where: { status: SessionStatus.ACTIVE, audiences: { some: { schoolId: profile.schoolId, OR: [{ classId: null }, { classId: profile.classId }] } } },
      include: { workshop: true }, orderBy: { startedAt: "desc" }
    });
    if (sessions.length > 1) apiError(409, "ACTIVE_SESSION_AUDIENCE_CONFLICT", "Student matches more than one active session");
    if (!sessions[0]) return [];
    const participant = await this.prisma.workshopParticipant.upsert({
      where: { sessionId_studentId: { sessionId: sessions[0].id, studentId: user.userId } },
      update: { lastActivityAt: new Date() }, create: { sessionId: sessions[0].id, studentId: user.userId, lastActivityAt: new Date() }
    });
    return [{ id: sessions[0].id, workshopId: sessions[0].workshopId, workshopName: sessions[0].workshop.name, startedAt: sessions[0].startedAt, participantId: participant.id }];
  }

  private async ownedParticipant(user: AuthUser, sessionId: string) {
    this.ensureStudent(user);
    const participant = await this.prisma.workshopParticipant.findUnique({ where: { sessionId_studentId: { sessionId, studentId: user.userId } }, include: { session: { include: { workshop: true } } } });
    if (!participant) apiError(403, "FORBIDDEN", "Student does not participate in this session");
    return participant;
  }

  async missions(user: AuthUser, sessionId: string): Promise<MissionAccessDto[]> {
    const participant = await this.ownedParticipant(user, sessionId);
    const missions = await this.prisma.missionTemplate.findMany({ where: { contentVersionId: participant.session.workshop.contentVersionId }, orderBy: { sequenceNo: "asc" } });
    const unlocks = await this.prisma.missionUnlock.findMany({ where: { sessionId } });
    const attempts = await this.prisma.missionAttempt.findMany({ where: { attempt: { participantId: participant.id } }, select: { id: true, missionTemplateId: true, status: true } });
    return missions.map((mission, index) => {
      const unlock = unlocks.find((item) => item.missionTemplateId === mission.id);
      const own = attempts.filter((item) => item.missionTemplateId === mission.id);
      const completed = own.some((item) => item.status === AttemptStatus.COMPLETED);
      const activeAttempt = own.find((item) => item.status === AttemptStatus.IN_PROGRESS);
      const active = Boolean(activeAttempt);
      const previous = index === 0 ? true : attempts.some((item) => item.missionTemplateId === missions[index - 1]!.id && item.status === AttemptStatus.COMPLETED);
      const sessionActive = participant.session.status === SessionStatus.ACTIVE;
      let progressState: MissionAccessDto["progressState"] = completed ? "COMPLETED" : active ? "IN_PROGRESS" : "NOT_STARTED";
      let accessState: MissionAccessDto["accessState"];
      let reason: string | undefined;
      let capabilities = { canStartAttempt: false, canContinueAttempt: false, canSubmitAnswer: false };
      if (!sessionActive) { accessState = completed ? "COMPLETED_READ_ONLY" : "BLOCKED_SESSION_INACTIVE"; reason = "SESSION_INACTIVE"; }
      else if (!unlock) { accessState = "BLOCKED_SESSION_UNLOCK"; reason = "SESSION_NOT_UNLOCKED"; }
      else if (index > 0 && !previous) { accessState = "BLOCKED_PREREQUISITE"; reason = "PREREQUISITE_NOT_COMPLETED"; }
      else if (active) { accessState = "ACTIVE_ATTEMPT"; capabilities = { canStartAttempt: false, canContinueAttempt: mission.stableId === "M1", canSubmitAnswer: mission.stableId === "M1" }; }
      else if (completed) { accessState = "COMPLETED_READ_ONLY"; reason = "MISSION_COMPLETED"; }
      else {
        accessState = "AVAILABLE";
        capabilities.canStartAttempt = mission.stableId === "M1";
        if (mission.stableId !== "M1") reason = "GAMEPLAY_DEFERRED_PHASE_1";
      }
      return {
        missionTemplateId: mission.id, missionStableId: mission.stableId, titleCn: mission.titleCn, titleEn: mission.titleEn,
        sessionUnlock: unlock ? { state: "UNLOCKED_FOR_SESSION", source: unlock.unlockSource } : { state: "LOCKED_FOR_SESSION" },
        progressState, accessState, reason, activeMissionAttemptId: activeAttempt?.id, capabilities
      };
    });
  }

  async startAttempt(user: AuthUser, sessionId: string, missionTemplateId: string) {
    const participant = await this.ownedParticipant(user, sessionId);
    const access = (await this.missions(user, sessionId)).find((item) => item.missionTemplateId === missionTemplateId);
    const mission = await this.prisma.missionTemplate.findUnique({ where: { id: missionTemplateId } });
    if (!mission) apiError(404, "MISSION_NOT_FOUND", "Mission not found");
    if (mission.stableId !== "M1") apiError(409, "MISSION_NOT_IMPLEMENTED", "Mission 2 gameplay is intentionally outside Phase 1");
    if (!access || !access.capabilities.canStartAttempt) {
      const code = access?.reason === "SESSION_INACTIVE"
        ? "SESSION_INACTIVE"
        : access?.reason === "PREREQUISITE_NOT_COMPLETED"
          ? "PREREQUISITE_NOT_COMPLETED"
          : "MISSION_LOCKED";
      apiError(409, code, code === "SESSION_INACTIVE" ? "Gameplay mutations are disabled because the Session is inactive" : "Mission cannot be started", { accessState: access?.accessState });
    }
    const firstScreen = await this.prisma.missionScreenTemplate.findFirstOrThrow({ where: { missionTemplateId }, orderBy: { sequenceNo: "asc" } });
    return this.prisma.$transaction(async (tx) => {
      const attemptNo = await tx.attempt.count({ where: { participantId: participant.id } }) + 1;
      const attempt = await tx.attempt.create({ data: { participantId: participant.id, attemptNo } });
      return tx.missionAttempt.create({ data: { attemptId: attempt.id, missionTemplateId, missionAttemptNo: 1, currentScreenId: firstScreen.id, runtimeState: { viewedNodes: [], reflection: null, hintUsed: false, revealUsed: false } }, include: { mission: true, currentScreen: true } });
    });
  }

  private async ownedAttempt(user: AuthUser, missionAttemptId: string) {
    this.ensureStudent(user);
    const attempt = await this.prisma.missionAttempt.findFirst({ where: { id: missionAttemptId, attempt: { participant: { studentId: user.userId } } }, include: { attempt: { include: { participant: { include: { session: true } } } }, mission: true, currentScreen: true } });
    if (!attempt) apiError(403, "FORBIDDEN", "MissionAttempt does not belong to this student");
    return attempt;
  }

  private assertSessionActive(attempt: Awaited<ReturnType<StudentService["ownedAttempt"]>>) {
    if (attempt.attempt.participant.session.status !== SessionStatus.ACTIVE) apiError(409, "SESSION_INACTIVE", "Gameplay mutations are disabled because the Session is inactive");
    if (attempt.status !== AttemptStatus.IN_PROGRESS) apiError(409, "MISSION_ATTEMPT_FINALIZED", "This MissionAttempt is read only");
  }

  async attempt(user: AuthUser, missionAttemptId: string) {
    const attempt = await this.ownedAttempt(user, missionAttemptId);
    const [questions, config] = await Promise.all([
      this.prisma.questionTemplate.findMany({ where: { missionTemplateId: attempt.missionTemplateId }, orderBy: { stableId: "asc" }, include: { results: { where: { missionAttemptId }, select: { status: true, systemScore: true, resolutionMode: true } }, attempts: { where: { missionAttemptId, resolutionMode: ResolutionMode.INDEPENDENT }, select: { questionAttemptNo: true } } } }),
      this.prisma.missionScoringConfig.findUniqueOrThrow({ where: { contentVersionId_missionTemplateId: { contentVersionId: attempt.mission.contentVersionId, missionTemplateId: attempt.missionTemplateId } } })
    ]);
    const revealAfterFailures = Number((config.revealPolicy as { afterFailures?: number }).afterFailures);
    return {
      id: attempt.id, status: attempt.status, mission: attempt.mission, currentScreen: attempt.currentScreen, runtimeState: attempt.runtimeState,
      capabilities: { canContinueAttempt: attempt.attempt.participant.session.status === SessionStatus.ACTIVE && attempt.status === AttemptStatus.IN_PROGRESS, canSubmitAnswer: attempt.attempt.participant.session.status === SessionStatus.ACTIVE && attempt.status === AttemptStatus.IN_PROGRESS },
      questions: questions.map((question) => ({ questionTemplateId: question.id, stableId: question.stableId, screenTemplateId: question.screenTemplateId, type: question.questionType, promptCn: question.promptCn, promptEn: question.promptEn, options: question.options, baseScore: Number(question.baseScore), attemptsUsed: question.attempts.length, revealAvailable: question.attempts.length >= revealAfterFailures && question.results[0]?.status !== QuestionResultStatus.FINALIZED, finalized: question.results[0]?.status === QuestionResultStatus.FINALIZED, score: question.results[0]?.systemScore !== null && question.results[0]?.systemScore !== undefined ? Number(question.results[0].systemScore) : null, resolutionMode: question.results[0]?.resolutionMode }))
    };
  }

  async question(user: AuthUser, missionAttemptId: string, questionTemplateId: string) {
    const owned = await this.ownedAttempt(user, missionAttemptId);
    const question = await this.prisma.questionTemplate.findFirst({ where: { id: questionTemplateId, mission: { missionAttempts: { some: { id: missionAttemptId } } } } });
    if (!question) apiError(404, "QUESTION_NOT_FOUND", "Question is not part of this MissionAttempt");
    const [attemptsUsed, result, config] = await Promise.all([
      this.prisma.questionAttempt.count({ where: { missionAttemptId, questionTemplateId, resolutionMode: ResolutionMode.INDEPENDENT } }),
      this.prisma.questionResult.findUnique({ where: { missionAttemptId_questionTemplateId: { missionAttemptId, questionTemplateId } } }),
      this.prisma.missionScoringConfig.findUniqueOrThrow({ where: { contentVersionId_missionTemplateId: { contentVersionId: owned.mission.contentVersionId, missionTemplateId: owned.missionTemplateId } } })
    ]);
    const revealAfterFailures = Number((config.revealPolicy as { afterFailures?: number }).afterFailures);
    return { questionTemplateId: question.id, stableId: question.stableId, type: question.questionType, promptCn: question.promptCn, promptEn: question.promptEn, options: question.options, baseScore: Number(question.baseScore), attemptsUsed, revealAvailable: attemptsUsed >= revealAfterFailures && result?.status !== QuestionResultStatus.FINALIZED, finalized: result?.status === QuestionResultStatus.FINALIZED };
  }

  async viewNode(user: AuthUser, missionAttemptId: string, input: { nodeId?: string }) {
    const attempt = await this.ownedAttempt(user, missionAttemptId); this.assertSessionActive(attempt);
    if (!input.nodeId?.trim()) apiError(400, "VALIDATION_ERROR", "nodeId is required");
    const valueChainScreen = await this.prisma.missionScreenTemplate.findFirst({ where: { missionTemplateId: attempt.missionTemplateId, stableId: "M1-S02" } });
    const allowedNodes = (valueChainScreen?.inputConfig as { nodeIds?: string[] } | undefined)?.nodeIds ?? [];
    if (!allowedNodes.includes(input.nodeId.trim())) apiError(400, "INVALID_VALUE_CHAIN_NODE", "nodeId is not part of this content version");
    const state = (attempt.runtimeState ?? {}) as RuntimeState;
    const viewedNodes = [...new Set([...(state.viewedNodes ?? []), input.nodeId.trim()])];
    const nodesRequired = Number((valueChainScreen?.inputConfig as { nodesRequired?: number } | undefined)?.nodesRequired);
    await this.prisma.$transaction([
      this.prisma.missionAttempt.update({ where: { id: missionAttemptId }, data: { runtimeState: json({ ...state, viewedNodes }) } }),
      this.prisma.workshopParticipant.update({ where: { id: attempt.attempt.participant.id }, data: { lastActivityAt: new Date() } })
    ]);
    return { viewedNodes, explorationComplete: viewedNodes.length >= nodesRequired };
  }

  async reflection(user: AuthUser, missionAttemptId: string, input: unknown) {
    const attempt = await this.ownedAttempt(user, missionAttemptId); this.assertSessionActive(attempt);
    const parsed = reflectionSchema.safeParse(input);
    if (!parsed.success) apiError(400, "REFLECTION_REQUIRED", "Reflection must contain non-whitespace text");
    const state = (attempt.runtimeState ?? {}) as RuntimeState;
    await this.prisma.$transaction([
      this.prisma.missionAttempt.update({ where: { id: missionAttemptId }, data: { runtimeState: json({ ...state, reflection: parsed.data.response }) } }),
      this.prisma.workshopParticipant.update({ where: { id: attempt.attempt.participant.id }, data: { lastActivityAt: new Date() } })
    ]);
    return { completed: true, contribution: 2 };
  }

  async hint(user: AuthUser, missionAttemptId: string, questionTemplateId: string) {
    const attempt = await this.ownedAttempt(user, missionAttemptId); this.assertSessionActive(attempt);
    const question = await this.prisma.questionTemplate.findUnique({ where: { id: questionTemplateId } });
    if (!question || question.missionTemplateId !== attempt.missionTemplateId) apiError(404, "QUESTION_NOT_FOUND", "Question not found");
    const state = (attempt.runtimeState ?? {}) as RuntimeState;
    await this.prisma.$transaction([
      this.prisma.missionAttempt.update({ where: { id: missionAttemptId }, data: { runtimeState: json({ ...state, hintUsed: true }) } }),
      this.prisma.workshopParticipant.update({ where: { id: attempt.attempt.participant.id }, data: { lastActivityAt: new Date() } })
    ]);
    const hint = (question.hintConfig as { hint?: string }).hint;
    return { hint: hint ?? "Use the Scope Lens.", hintUsed: true, questionScorePenalty: 0 };
  }

  async submit(user: AuthUser, missionAttemptId: string, questionTemplateId: string, input: unknown) {
    const attempt = await this.ownedAttempt(user, missionAttemptId); this.assertSessionActive(attempt);
    const parsed = answerSubmissionSchema.safeParse(input);
    if (!parsed.success) apiError(400, "VALIDATION_ERROR", "Submission must contain only clientSubmissionId, answer and timeSpentMs", { issues: parsed.error.issues });
    const requestHash = hashRequest(parsed.data);
    const duplicate = await this.prisma.questionAttempt.findUnique({ where: { clientSubmissionId: parsed.data.clientSubmissionId } });
    if (duplicate) {
      if (duplicate.missionAttemptId !== missionAttemptId || duplicate.questionTemplateId !== questionTemplateId || duplicate.requestHash !== requestHash) apiError(409, "IDEMPOTENCY_CONFLICT", "Submission ID was already used for a different request");
      const evaluated = duplicate.evaluatedResult as { correct?: boolean };
      const feedback = duplicate.feedbackSnapshot as { correct?: string; wrong?: string; explanation?: string };
      const storedResult = await this.prisma.questionResult.findUnique({ where: { missionAttemptId_questionTemplateId: { missionAttemptId, questionTemplateId } } });
      const snapshottedReveal = (storedResult?.scoringPolicySnapshot as { reveal?: { afterFailures?: number } } | null)?.reveal;
      return {
        idempotent: true, attemptNumber: duplicate.questionAttemptNo, correct: Boolean(evaluated.correct), score: Number(duplicate.candidateSystemScore),
        finalized: Boolean(evaluated.correct), revealAvailable: !evaluated.correct && duplicate.questionAttemptNo >= Number(snapshottedReveal?.afterFailures ?? Number.POSITIVE_INFINITY),
        feedback: evaluated.correct ? feedback.correct : feedback.wrong, explanation: evaluated.correct ? feedback.explanation : undefined
      };
    }
    const question = await this.prisma.questionTemplate.findUnique({ where: { id: questionTemplateId } });
    if (!question || question.missionTemplateId !== attempt.missionTemplateId) apiError(404, "QUESTION_NOT_FOUND", "Question not found");
    const config = await this.prisma.missionScoringConfig.findUniqueOrThrow({ where: { contentVersionId_missionTemplateId: { contentVersionId: question.contentVersionId, missionTemplateId: question.missionTemplateId } } });
    const retryPolicy = config.retryPolicy as { maxIndependentAttempts?: number; factors?: number[] };
    const maxIndependentAttempts = Number(retryPolicy.maxIndependentAttempts);
    const retryFactors = retryPolicy.factors ?? [];
    const currentResult = await this.prisma.questionResult.findUnique({ where: { missionAttemptId_questionTemplateId: { missionAttemptId, questionTemplateId } } });
    if (currentResult?.status === QuestionResultStatus.FINALIZED) apiError(409, "QUESTION_FINALIZED", "QuestionResult is already finalized");
    const attemptNumber = await this.prisma.questionAttempt.count({ where: { missionAttemptId, questionTemplateId, resolutionMode: ResolutionMode.INDEPENDENT } }) + 1;
    if (attemptNumber > maxIndependentAttempts) apiError(409, "MAX_ATTEMPTS_REACHED", "No further independent submission is allowed; Reveal is available");
    const rule = answerRuleSchema.parse(question.answerRule);
    if (rule.mode === "STRATEGY") apiError(409, "STRATEGY_NOT_AVAILABLE", "Strategy gameplay is outside Phase 1");
    const evaluation = evaluateAnswer(rule, parsed.data.answer);
    const score = candidateScore(Number(question.baseScore), Boolean(evaluation.correct), attemptNumber, retryFactors);
    const state = (attempt.runtimeState ?? {}) as RuntimeState;
    const feedback = question.feedbackConfig as { correct?: string; wrong?: string; explanation?: string };
    return this.prisma.$transaction(async (tx) => {
      const submission = await tx.questionAttempt.create({ data: {
        missionAttemptId, questionTemplateId, questionAttemptNo: attemptNumber, clientSubmissionId: parsed.data.clientSubmissionId, requestHash,
        studentAnswer: json(parsed.data.answer), evaluatedResult: json({ correct: evaluation.correct, mode: rule.mode }), candidateSystemScore: score,
        questionSnapshot: json({ stableId: question.stableId, promptCn: question.promptCn, promptEn: question.promptEn, options: question.options, baseScore: Number(question.baseScore) }),
        ruleSnapshot: json(question.answerRule), feedbackSnapshot: json(question.feedbackConfig), timeSpentMs: parsed.data.timeSpentMs,
        hintUsage: json({ hintUsed: state.hintUsed ?? false }), independentlyCorrect: Boolean(evaluation.correct)
      } });
      const policySnapshot = { contentVersionId: question.contentVersionId, baseScore: Number(question.baseScore), retry: config.retryPolicy, hints: config.assistancePolicy, reveal: config.revealPolicy, selectedAttemptId: evaluation.correct ? submission.id : null, resolutionMode: evaluation.correct ? "INDEPENDENT" : null, calculatedSystemScore: evaluation.correct ? score : null, scoringConfigId: config.id, checksum: config.checksum };
      if (evaluation.correct) {
        await tx.questionResult.upsert({
          where: { missionAttemptId_questionTemplateId: { missionAttemptId, questionTemplateId } },
          update: { status: QuestionResultStatus.FINALIZED, selectedQuestionAttemptId: submission.id, resolutionMode: ResolutionMode.INDEPENDENT, systemScore: score, finalizedAt: new Date(), scoringPolicySnapshot: json(policySnapshot) },
          create: { missionAttemptId, questionTemplateId, status: QuestionResultStatus.FINALIZED, selectedQuestionAttemptId: submission.id, resolutionMode: ResolutionMode.INDEPENDENT, v5BaseScore: question.baseScore, systemScore: score, scoringConfigId: config.id, scoringConfigChecksum: config.checksum, scoringPolicySnapshot: json(policySnapshot), finalizedAt: new Date() }
        });
      } else {
        await tx.questionResult.upsert({ where: { missionAttemptId_questionTemplateId: { missionAttemptId, questionTemplateId } }, update: {}, create: { missionAttemptId, questionTemplateId, v5BaseScore: question.baseScore, scoringConfigId: config.id, scoringConfigChecksum: config.checksum, scoringPolicySnapshot: json(policySnapshot) } });
      }
      await tx.workshopParticipant.update({ where: { id: attempt.attempt.participant.id }, data: { lastActivityAt: new Date() } });
      return { idempotent: false, attemptNumber, correct: evaluation.correct, score, finalized: Boolean(evaluation.correct), revealAvailable: !evaluation.correct && attemptNumber >= Number((config.revealPolicy as { afterFailures?: number }).afterFailures), feedback: evaluation.correct ? feedback.correct : feedback.wrong, explanation: evaluation.correct ? feedback.explanation : undefined };
    });
  }

  async reveal(user: AuthUser, missionAttemptId: string, questionTemplateId: string) {
    const attempt = await this.ownedAttempt(user, missionAttemptId); this.assertSessionActive(attempt);
    const question = await this.prisma.questionTemplate.findUnique({ where: { id: questionTemplateId } });
    if (!question || question.missionTemplateId !== attempt.missionTemplateId) apiError(404, "QUESTION_NOT_FOUND", "Question not found");
    const config = await this.prisma.missionScoringConfig.findUniqueOrThrow({ where: { contentVersionId_missionTemplateId: { contentVersionId: question.contentVersionId, missionTemplateId: question.missionTemplateId } } });
    const revealPolicy = config.revealPolicy as { afterFailures?: number; factor?: number };
    const failed = await this.prisma.questionAttempt.count({ where: { missionAttemptId, questionTemplateId, resolutionMode: ResolutionMode.INDEPENDENT, independentlyCorrect: false } });
    const result = await this.prisma.questionResult.findUnique({ where: { missionAttemptId_questionTemplateId: { missionAttemptId, questionTemplateId } } });
    if (result?.status === QuestionResultStatus.FINALIZED) apiError(409, "QUESTION_FINALIZED", "Question is already resolved");
    if (failed < Number(revealPolicy.afterFailures)) apiError(409, "REVEAL_NOT_AVAILABLE", "Reveal is not yet available");
    const state = (attempt.runtimeState ?? {}) as RuntimeState;
    const score = Number(question.baseScore) * Number(revealPolicy.factor);
    return this.prisma.$transaction(async (tx) => {
      const submission = await tx.questionAttempt.create({ data: {
        missionAttemptId, questionTemplateId, questionAttemptNo: failed + 1, clientSubmissionId: randomUUID(), requestHash: hashRequest({ reveal: true, questionTemplateId }),
        studentAnswer: { revealAcknowledged: true }, evaluatedResult: json({ revealed: true, answer: (question.answerRule as { answer?: unknown }).answer }), candidateSystemScore: score,
        questionSnapshot: json({ stableId: question.stableId, promptCn: question.promptCn, promptEn: question.promptEn, options: question.options, baseScore: Number(question.baseScore) }), ruleSnapshot: json(question.answerRule), feedbackSnapshot: json(question.feedbackConfig), timeSpentMs: 0,
        hintUsage: json({ hintUsed: state.hintUsed ?? false }), resolutionMode: ResolutionMode.REVEALED, revealUsed: true, independentlyCorrect: false
      } });
      const policySnapshot = { contentVersionId: question.contentVersionId, baseScore: Number(question.baseScore), retry: config.retryPolicy, hints: config.assistancePolicy, reveal: config.revealPolicy, selectedAttemptId: submission.id, resolutionMode: "REVEALED", calculatedSystemScore: score, scoringConfigId: config.id, checksum: config.checksum };
      await tx.questionResult.update({ where: { missionAttemptId_questionTemplateId: { missionAttemptId, questionTemplateId } }, data: { status: QuestionResultStatus.FINALIZED, selectedQuestionAttemptId: submission.id, resolutionMode: ResolutionMode.REVEALED, systemScore: score, scoringPolicySnapshot: json(policySnapshot), finalizedAt: new Date() } });
      await tx.missionAttempt.update({ where: { id: missionAttemptId }, data: { runtimeState: json({ ...state, revealUsed: true }) } });
      await tx.workshopParticipant.update({ where: { id: attempt.attempt.participant.id }, data: { lastActivityAt: new Date() } });
      return { finalized: true, resolutionMode: "REVEALED", score, revealedAnswer: (question.answerRule as { answer?: unknown }).answer, feedback: (question.feedbackConfig as { explanation?: string }).explanation };
    });
  }

  async setScreen(user: AuthUser, missionAttemptId: string, screenStableId: string) {
    const attempt = await this.ownedAttempt(user, missionAttemptId); this.assertSessionActive(attempt);
    const screen = await this.prisma.missionScreenTemplate.findFirst({ where: { missionTemplateId: attempt.missionTemplateId, stableId: screenStableId } });
    if (!screen) apiError(404, "SCREEN_NOT_FOUND", "Screen is not part of this MissionAttempt");
    await this.prisma.$transaction([
      this.prisma.missionAttempt.update({ where: { id: missionAttemptId }, data: { currentScreenId: screen.id } }),
      this.prisma.workshopParticipant.update({ where: { id: attempt.attempt.participant.id }, data: { lastActivityAt: new Date() } })
    ]);
    return { currentScreenId: screen.id, stableId: screen.stableId };
  }

  async complete(user: AuthUser, missionAttemptId: string) {
    const attempt = await this.ownedAttempt(user, missionAttemptId); this.assertSessionActive(attempt);
    const state = (attempt.runtimeState ?? {}) as RuntimeState;
    const valueChainScreen = await this.prisma.missionScreenTemplate.findFirstOrThrow({ where: { missionTemplateId: attempt.missionTemplateId, stableId: "M1-S02" } });
    const nodesRequired = Number((valueChainScreen.inputConfig as { nodesRequired?: number }).nodesRequired);
    if ((state.viewedNodes?.length ?? 0) < nodesRequired) apiError(409, "MISSION_NOT_COMPLETABLE", `Inspect at least ${nodesRequired} value-chain nodes`);
    if (!state.reflection?.trim()) apiError(409, "MISSION_NOT_COMPLETABLE", "A non-empty reflection is required");
    const totalQuestions = await this.prisma.questionTemplate.count({ where: { missionTemplateId: attempt.missionTemplateId } });
    const resolved = await this.prisma.questionResult.count({ where: { missionAttemptId, status: QuestionResultStatus.FINALIZED } });
    if (resolved !== totalQuestions) apiError(409, "MISSION_NOT_COMPLETABLE", "All Mission 1 questions must be resolved", { resolved, required: totalQuestions });
    const systemScore = await this.scoring.calculateMissionOne(missionAttemptId, false);
    const config = await this.prisma.missionScoringConfig.findFirstOrThrow({ where: { missionTemplateId: attempt.missionTemplateId } });
    await this.prisma.$transaction([
      this.prisma.missionAttempt.update({ where: { id: missionAttemptId }, data: { status: AttemptStatus.COMPLETED, systemScore, completedAt: new Date(), scoringPolicySnapshot: json({ contentVersionId: attempt.mission.contentVersionId, configId: config.id, checksum: config.checksum, components: config.componentDefinitions, retry: config.retryPolicy, assistance: config.assistancePolicy, reveal: config.revealPolicy, completion: config.completionPolicy, systemScore }) } }),
      this.prisma.attempt.update({ where: { id: attempt.attemptId }, data: { status: AttemptStatus.COMPLETED, completedAt: new Date() } }),
      this.prisma.workshopParticipant.update({ where: { id: attempt.attempt.participant.id }, data: { lastActivityAt: new Date() } })
    ]);
    return { status: "COMPLETED", systemScore, nextMission: { state: "LOCKED", reason: "WAITING_FOR_TEACHER" } };
  }

  async history(user: AuthUser) {
    this.ensureStudent(user);
    const attempts = await this.prisma.attempt.findMany({ where: { participant: { studentId: user.userId } }, include: { missionAttempts: { include: { mission: true, questionResults: { include: { question: { select: { stableId: true } } } } } }, participant: { include: { session: { include: { workshop: true } } } } }, orderBy: { startedAt: "desc" } });
    return attempts.map((attempt) => ({
      id: attempt.id,
      attemptNo: attempt.attemptNo,
      status: attempt.status,
      systemTotalScore: attempt.systemTotalScore === null ? null : Number(attempt.systemTotalScore),
      startedAt: attempt.startedAt,
      completedAt: attempt.completedAt,
      session: { id: attempt.participant.session.id, status: attempt.participant.session.status, workshop: { id: attempt.participant.session.workshop.id, name: attempt.participant.session.workshop.name } },
      missionAttempts: attempt.missionAttempts.map((missionAttempt) => ({
        id: missionAttempt.id,
        status: missionAttempt.status,
        systemScore: missionAttempt.systemScore === null ? null : Number(missionAttempt.systemScore),
        completedAt: missionAttempt.completedAt,
        mission: { stableId: missionAttempt.mission.stableId, titleCn: missionAttempt.mission.titleCn, titleEn: missionAttempt.mission.titleEn },
        questionResults: missionAttempt.questionResults.map((result) => ({ questionStableId: result.question.stableId, status: result.status, systemScore: result.systemScore === null ? null : Number(result.systemScore), resolutionMode: result.resolutionMode }))
      }))
    }));
  }
}

@Controller("student")
@UseGuards(JwtAuthGuard)
@ApiTags("Student")
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: "Authentication required" })
@ApiForbiddenResponse({ description: "Student access required" })
export class StudentController {
  constructor(private readonly service: StudentService) {}
  @Get("sessions/active") active(@CurrentUser() user: AuthUser) { return this.service.activeSessions(user); }
  @Get("sessions/:sessionId/missions") missions(@CurrentUser() user: AuthUser, @Param("sessionId") sessionId: string) { return this.service.missions(user, sessionId); }
  @Post("sessions/:sessionId/missions/:missionTemplateId/attempts") attempts(@CurrentUser() user: AuthUser, @Param("sessionId") sessionId: string, @Param("missionTemplateId") missionTemplateId: string) { return this.service.startAttempt(user, sessionId, missionTemplateId); }
  @Get("mission-attempts/:missionAttemptId") attempt(@CurrentUser() user: AuthUser, @Param("missionAttemptId") id: string) { return this.service.attempt(user, id); }
  @Post("mission-attempts/:missionAttemptId/value-chain/nodes") @ApiBody({ type: ValueChainNodeDto }) viewNode(@CurrentUser() user: AuthUser, @Param("missionAttemptId") id: string, @Body() body: ValueChainNodeDto) { return this.service.viewNode(user, id, body); }
  @Post("mission-attempts/:missionAttemptId/reflection") @ApiBody({ type: ReflectionDto }) reflection(@CurrentUser() user: AuthUser, @Param("missionAttemptId") id: string, @Body() body: ReflectionDto) { return this.service.reflection(user, id, body); }
  @Post("mission-attempts/:missionAttemptId/screens/:screenStableId") screen(@CurrentUser() user: AuthUser, @Param("missionAttemptId") id: string, @Param("screenStableId") screenStableId: string) { return this.service.setScreen(user, id, screenStableId); }
  @Get("mission-attempts/:missionAttemptId/questions/:questionTemplateId") question(@CurrentUser() user: AuthUser, @Param("missionAttemptId") missionAttemptId: string, @Param("questionTemplateId") questionTemplateId: string) { return this.service.question(user, missionAttemptId, questionTemplateId); }
  @Post("mission-attempts/:missionAttemptId/questions/:questionTemplateId/submissions")
  @ApiBody({
    schema: {
      type: "object",
      required: ["clientSubmissionId", "answer", "timeSpentMs"],
      additionalProperties: false,
      properties: {
        clientSubmissionId: { type: "string", format: "uuid", example: "33333333-3333-4333-8333-333333333333" },
        answer: {
          description: "Answer payload; its JSON shape depends on the question type.",
          example: "Scope 1",
          nullable: true,
          oneOf: [
            { type: "string" },
            { type: "number" },
            { type: "boolean" },
            { type: "array", items: {} },
            { type: "object", additionalProperties: true }
          ]
        },
        timeSpentMs: { type: "integer", minimum: 0, maximum: 86400000, example: 12000 }
      }
    }
  })
  submit(@CurrentUser() user: AuthUser, @Param("missionAttemptId") missionAttemptId: string, @Param("questionTemplateId") questionTemplateId: string, @Body() body: AnswerSubmissionDto) { return this.service.submit(user, missionAttemptId, questionTemplateId, body); }
  @Post("mission-attempts/:missionAttemptId/questions/:questionTemplateId/hint") hint(@CurrentUser() user: AuthUser, @Param("missionAttemptId") missionAttemptId: string, @Param("questionTemplateId") questionTemplateId: string) { return this.service.hint(user, missionAttemptId, questionTemplateId); }
  @Post("mission-attempts/:missionAttemptId/questions/:questionTemplateId/reveal") reveal(@CurrentUser() user: AuthUser, @Param("missionAttemptId") missionAttemptId: string, @Param("questionTemplateId") questionTemplateId: string) { return this.service.reveal(user, missionAttemptId, questionTemplateId); }
  @Post("mission-attempts/:missionAttemptId/complete") complete(@CurrentUser() user: AuthUser, @Param("missionAttemptId") id: string) { return this.service.complete(user, id); }
  @Get("history") history(@CurrentUser() user: AuthUser) { return this.service.history(user); }
}
