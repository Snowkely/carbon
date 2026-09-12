import { Body, Controller, Get, Injectable, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiForbiddenResponse, ApiTags, ApiUnauthorizedResponse } from "@nestjs/swagger";
import { AccountType, AnswerMode, AttemptStatus, Prisma, QuestionResultStatus, QuestionType, ResolutionMode, SessionStatus, UnlockSource } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { answerSubmissionSchema, reflectionSchema, type MissionAccessDto } from "@carbon/contracts";
import { answerRuleSchema } from "@carbon/content-schema";
import { calculateEtsState, calculateFootprint, candidateScore, commitEtsTrade, evaluateAnswer, evaluateOrderedMultiExact, projectMissionFiveDecision, type EtsSimulationConfig, type EtsTrade, type MissionFiveDecision, type MissionFiveScenario } from "@carbon/game-rules";
import { AuthUser, CurrentUser, JwtAuthGuard } from "../common/auth";
import { apiError } from "../common/api-error";
import { PrismaService } from "../common/prisma.service";
import { ScoringService } from "./scoring.service";
import { AnswerSubmissionDto, ReflectionDto, ValueChainNodeDto } from "../openapi/request-dtos";

type RuntimeState = { viewedNodes?: string[]; reflection?: string; hintUsed?: boolean; revealUsed?: boolean; currentQuestionId?: string };
const json = (value: unknown) => value as Prisma.InputJsonValue;
const hashRequest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const selectedTrade = (attempt: { studentAnswer: unknown; evaluatedResult?: unknown; resolutionMode?: ResolutionMode } | null | undefined): EtsTrade | null => {
  if (!attempt) return null;
  const answer = attempt.resolutionMode === ResolutionMode.REVEALED ? (attempt.evaluatedResult as { answer?: unknown } | null)?.answer : attempt.studentAnswer;
  return answer && typeof answer === "object" ? answer as EtsTrade : null;
};
const selectedAnswer = (attempt: { studentAnswer: unknown; evaluatedResult?: unknown; resolutionMode?: ResolutionMode } | null | undefined): unknown => {
  if (!attempt) return null;
  return attempt.resolutionMode === ResolutionMode.REVEALED ? (attempt.evaluatedResult as { answer?: unknown } | null)?.answer : attempt.studentAnswer;
};
const gameplayImplemented = (displayConfig: unknown, stableId?: string) => {
  const display = (displayConfig ?? {}) as { phase?: string; gameplayImplemented?: boolean };
  return display.gameplayImplemented ?? (display.phase ? display.phase === "IMPLEMENTED" : stableId === "M1");
};

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
      else if (active) { accessState = "ACTIVE_ATTEMPT"; capabilities = { canStartAttempt: false, canContinueAttempt: gameplayImplemented(mission.displayConfig, mission.stableId), canSubmitAnswer: gameplayImplemented(mission.displayConfig, mission.stableId) }; }
      else if (completed) { accessState = "COMPLETED_READ_ONLY"; reason = "MISSION_COMPLETED"; }
      else {
        accessState = "AVAILABLE";
        capabilities.canStartAttempt = gameplayImplemented(mission.displayConfig, mission.stableId);
        if (!capabilities.canStartAttempt) reason = "GAMEPLAY_DEFERRED_PHASE_1";
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
    if (!gameplayImplemented(mission.displayConfig, mission.stableId)) apiError(409, "MISSION_NOT_IMPLEMENTED", "Mission gameplay is not available in this build");
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
      let attempt = await tx.attempt.findFirst({ where: { participantId: participant.id, status: AttemptStatus.IN_PROGRESS, attemptKind: "COURSE" }, orderBy: { startedAt: "desc" } });
      if (!attempt) {
        const attemptNo = await tx.attempt.count({ where: { participantId: participant.id } }) + 1;
        attempt = await tx.attempt.create({ data: { participantId: participant.id, attemptNo } });
      }
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

  private async etsConfig(missionTemplateId: string): Promise<EtsSimulationConfig> {
    const screen = await this.prisma.missionScreenTemplate.findFirst({ where: { missionTemplateId, stableId: "M4-S02" } });
    const config = screen?.inputConfig as EtsSimulationConfig | undefined;
    if (!config || !Number.isFinite(config.cap) || !Array.isArray(config.companies)) apiError(409, "ETS_CONFIG_INVALID", "The versioned ETS simulation is unavailable");
    return config;
  }

  private async validateEtsTrade(missionAttemptId: string, missionTemplateId: string, stableId: string, answer: unknown) {
    const submitted = answer && typeof answer === "object" ? answer as Record<string, unknown> : {};
    const trade: EtsTrade = { seller: String(submitted.seller ?? ""), buyer: String(submitted.buyer ?? ""), quantity: Number(submitted.quantity) };
    if (!trade.seller || !trade.buyer || !Number.isFinite(trade.quantity)) apiError(400, "INVALID_ETS_TRADE", "Seller, buyer and a numeric quantity are required");
    const results = await this.prisma.questionResult.findMany({
      where: { missionAttemptId, status: QuestionResultStatus.FINALIZED, question: { stableId: { in: ["M4-Q05", "M4-Q06"] } } },
      include: { question: { select: { stableId: true } }, selectedAttempt: { select: { studentAnswer: true, evaluatedResult: true, resolutionMode: true } } }
    });
    const ordered = results.sort((left, right) => left.question.stableId.localeCompare(right.question.stableId));
    if (stableId === "M4-Q06" && !ordered.some((result) => result.question.stableId === "M4-Q05")) apiError(409, "ETS_TRADE_SEQUENCE_INVALID", "Commit the GreenTex trade before the PowerCo trade");
    const committed = ordered.map((result) => selectedTrade(result.selectedAttempt)).filter((trade): trade is EtsTrade => Boolean(trade));
    try { commitEtsTrade(await this.etsConfig(missionTemplateId), committed, trade); }
    catch (error) { apiError(409, "INVALID_ETS_TRADE", error instanceof Error ? error.message : "Trade violates the ETS state"); }
  }

  private async missionFiveConfig(missionTemplateId: string): Promise<MissionFiveScenario> {
    const screen = await this.prisma.missionScreenTemplate.findFirst({ where: { missionTemplateId, stableId: "M5-S01" } });
    const config = screen?.inputConfig as unknown as MissionFiveScenario | undefined;
    if (!config || !Number.isFinite(config.verifiedEmissions) || !Number.isFinite(config.allowances) || !Number.isFinite(config.marketPrice) || !Array.isArray(config.projects)) apiError(409, "M5_CONFIG_INVALID", "The versioned Mission 5 training simulation is unavailable");
    return config;
  }

  private async missionFiveSelectedProjects(missionAttemptId: string): Promise<string[]> {
    const result = await this.prisma.questionResult.findFirst({
      where: { missionAttemptId, status: QuestionResultStatus.FINALIZED, question: { stableId: "M5-Q02" } },
      include: { selectedAttempt: { select: { studentAnswer: true, evaluatedResult: true, resolutionMode: true } } }
    });
    const answer = selectedAnswer(result?.selectedAttempt);
    if (!Array.isArray(answer)) apiError(409, "M5_PROJECT_SELECTION_REQUIRED", "Submit the project comparison before reviewing an action");
    return answer.map(String);
  }

  private async projectMissionFive(missionAttemptId: string, missionTemplateId: string, answer: unknown) {
    const value = answer && typeof answer === "object" ? answer as Record<string, unknown> : {};
    const decision = { action: String(value.action ?? ""), quantity: Number(value.quantity) } as MissionFiveDecision;
    try { return projectMissionFiveDecision(await this.missionFiveConfig(missionTemplateId), await this.missionFiveSelectedProjects(missionAttemptId), decision); }
    catch (error) { apiError(409, "INVALID_M5_DECISION", error instanceof Error ? error.message : "Decision violates the Mission 5 state"); }
  }

  async previewMissionFive(user: AuthUser, missionAttemptId: string, input: unknown) {
    const attempt = await this.ownedAttempt(user, missionAttemptId); this.assertSessionActive(attempt);
    if (attempt.mission.stableId !== "M5") apiError(404, "M5_PREVIEW_NOT_AVAILABLE", "Mission 5 preview is not available for this Mission");
    const body = input && typeof input === "object" ? input as { answer?: unknown } : {};
    return { projection: await this.projectMissionFive(missionAttemptId, attempt.missionTemplateId, body.answer) };
  }

  async attempt(user: AuthUser, missionAttemptId: string) {
    const attempt = await this.ownedAttempt(user, missionAttemptId);
    const [screens, questions, config] = await Promise.all([
      this.prisma.missionScreenTemplate.findMany({ where: { missionTemplateId: attempt.missionTemplateId }, orderBy: { sequenceNo: "asc" } }),
      this.prisma.questionTemplate.findMany({ where: { missionTemplateId: attempt.missionTemplateId }, orderBy: { stableId: "asc" }, include: { results: { where: { missionAttemptId }, select: { status: true, systemScore: true, resolutionMode: true, selectedAttempt: { select: { studentAnswer: true, evaluatedResult: true, resolutionMode: true } } } }, attempts: { where: { missionAttemptId, resolutionMode: ResolutionMode.INDEPENDENT }, select: { questionAttemptNo: true } } } }),
      this.prisma.missionScoringConfig.findUniqueOrThrow({ where: { contentVersionId_missionTemplateId: { contentVersionId: attempt.mission.contentVersionId, missionTemplateId: attempt.missionTemplateId } } })
    ]);
    const revealAfterFailures = Number((config.revealPolicy as { afterFailures?: number }).afterFailures);
    const calculator = screens.find((screen) => screen.stableId === "M2-S04");
    const footprint = calculator ? calculateFootprint(((calculator.inputConfig as { activities?: Parameters<typeof calculateFootprint>[0] }).activities ?? [])) : null;
    const etsConfig = attempt.mission.stableId === "M4" ? (screens.find((screen) => screen.stableId === "M4-S02")?.inputConfig as EtsSimulationConfig | undefined) : undefined;
    const etsTrades = questions.filter((question) => ["M4-Q05", "M4-Q06"].includes(question.stableId) && question.results[0]?.status === QuestionResultStatus.FINALIZED).map((question) => selectedTrade(question.results[0]!.selectedAttempt)).filter((trade): trade is EtsTrade => Boolean(trade));
    const ets = etsConfig ? calculateEtsState(etsConfig, etsTrades) : null;
    const m5Config = attempt.mission.stableId === "M5" ? (screens.find((screen) => screen.stableId === "M5-S01")?.inputConfig as unknown as MissionFiveScenario | undefined) : undefined;
    const m5ProjectAnswer = selectedAnswer(questions.find((question) => question.stableId === "M5-Q02")?.results[0]?.selectedAttempt);
    const m5DecisionAnswer = selectedAnswer(questions.find((question) => question.stableId === "M5-Q03")?.results[0]?.selectedAttempt);
    const m5ReasoningAnswer = selectedAnswer(questions.find((question) => question.stableId === "M5-Q04")?.results[0]?.selectedAttempt);
    let m5Projection = null;
    if (m5Config && Array.isArray(m5ProjectAnswer) && m5DecisionAnswer && typeof m5DecisionAnswer === "object") {
      try { m5Projection = projectMissionFiveDecision(m5Config, m5ProjectAnswer.map(String), m5DecisionAnswer as MissionFiveDecision); } catch { m5Projection = null; }
    }
    const m5RubricBreakdown = attempt.mission.stableId === "M5" && m5Projection && typeof m5ReasoningAnswer === "string" ? await this.scoring.calculateMissionFiveBreakdown(missionAttemptId) : null;
    const m6Scenario = attempt.mission.stableId === "M6" ? (screens.find((screen) => screen.stableId === "M6-S03")?.inputConfig as { mac?: number; allowancePrice?: number; marginalAdvantage?: number } | undefined) : undefined;
    const m6RoundBreakdown = attempt.mission.stableId === "M6" ? await this.scoring.calculateMissionSixBreakdown(missionAttemptId) : null;
    const mappedQuestions = questions.map((question) => ({ questionTemplateId: question.id, stableId: question.stableId, screenTemplateId: question.screenTemplateId, type: question.questionType, answerMode: question.answerMode, promptCn: question.promptCn, promptEn: question.promptEn, options: question.options, baseScore: Number(question.baseScore), attemptsUsed: question.attempts.length, revealAvailable: question.answerMode !== AnswerMode.STRATEGY && question.attempts.length >= revealAfterFailures && question.results[0]?.status !== QuestionResultStatus.FINALIZED, finalized: question.results[0]?.status === QuestionResultStatus.FINALIZED, score: question.results[0]?.systemScore !== null && question.results[0]?.systemScore !== undefined ? Number(question.results[0].systemScore) : null, resolutionMode: question.results[0]?.resolutionMode, selectedAnswer: question.answerMode === AnswerMode.STRATEGY && question.results[0]?.status === QuestionResultStatus.FINALIZED ? selectedAnswer(question.results[0].selectedAttempt) : undefined, isSimulation: question.isSimulation }));
    return {
      id: attempt.id, status: attempt.status, mission: attempt.mission, currentScreen: attempt.currentScreen, runtimeState: attempt.runtimeState,
      capabilities: { canContinueAttempt: attempt.attempt.participant.session.status === SessionStatus.ACTIVE && attempt.status === AttemptStatus.IN_PROGRESS, canSubmitAnswer: attempt.attempt.participant.session.status === SessionStatus.ACTIVE && attempt.status === AttemptStatus.IN_PROGRESS },
      screens: screens.map((screen) => ({ id: screen.id, stableId: screen.stableId, sequenceNo: screen.sequenceNo, displayConfig: screen.displayConfig })),
      questions: mappedQuestions, allRequiredResolved: mappedQuestions.every((question) => question.finalized),
      footprint: footprint ? { scope1: footprint.byScope["Scope 1"], scope2: footprint.byScope["Scope 2"], scope3: footprint.byScope["Scope 3"], total: footprint.total } : null,
      ets,
      m5: m5Config ? { scenario: m5Config, selectedProjectIds: Array.isArray(m5ProjectAnswer) ? m5ProjectAnswer.map(String) : [], committedDecision: m5DecisionAnswer, reasoning: typeof m5ReasoningAnswer === "string" ? m5ReasoningAnswer : null, projection: m5Projection, rubricBreakdown: m5RubricBreakdown } : null,
      m6: m6Scenario ? { scenario: m6Scenario, roundBreakdown: m6RoundBreakdown } : null
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
    return { questionTemplateId: question.id, stableId: question.stableId, type: question.questionType, answerMode: question.answerMode, promptCn: question.promptCn, promptEn: question.promptEn, options: question.options, baseScore: Number(question.baseScore), attemptsUsed, revealAvailable: question.answerMode !== AnswerMode.STRATEGY && attemptsUsed >= revealAfterFailures && result?.status !== QuestionResultStatus.FINALIZED, finalized: result?.status === QuestionResultStatus.FINALIZED, isSimulation: question.isSimulation };
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
      const evaluated = duplicate.evaluatedResult as { correct?: boolean; mode?: string };
      const feedback = duplicate.feedbackSnapshot as { correct?: string; wrong?: string; explanation?: string };
      const storedResult = await this.prisma.questionResult.findUnique({ where: { missionAttemptId_questionTemplateId: { missionAttemptId, questionTemplateId } } });
      const snapshottedReveal = (storedResult?.scoringPolicySnapshot as { reveal?: { afterFailures?: number } } | null)?.reveal;
      return {
        idempotent: true, attemptNumber: duplicate.questionAttemptNo, correct: Boolean(evaluated.correct), score: Number(duplicate.candidateSystemScore),
        finalized: Boolean(evaluated.correct) || evaluated.mode === "STRATEGY", revealAvailable: evaluated.mode !== "STRATEGY" && !evaluated.correct && duplicate.questionAttemptNo >= Number(snapshottedReveal?.afterFailures ?? Number.POSITIVE_INFINITY),
        feedback: evaluated.correct ? feedback.correct : feedback.wrong, explanation: evaluated.correct ? feedback.explanation : undefined
      };
    }
    const question = await this.prisma.questionTemplate.findUnique({ where: { id: questionTemplateId } });
    if (!question || question.missionTemplateId !== attempt.missionTemplateId) apiError(404, "QUESTION_NOT_FOUND", "Question not found");
    const config = await this.prisma.missionScoringConfig.findUniqueOrThrow({ where: { contentVersionId_missionTemplateId: { contentVersionId: question.contentVersionId, missionTemplateId: question.missionTemplateId } } });
    const retryPolicy = config.retryPolicy as { maxIndependentAttempts?: number; strategyIndependentAttempts?: number; factors?: number[] };
    const retryFactors = retryPolicy.factors ?? [];
    const currentResult = await this.prisma.questionResult.findUnique({ where: { missionAttemptId_questionTemplateId: { missionAttemptId, questionTemplateId } } });
    if (currentResult?.status === QuestionResultStatus.FINALIZED) apiError(409, "QUESTION_FINALIZED", "QuestionResult is already finalized");
    const attemptNumber = await this.prisma.questionAttempt.count({ where: { missionAttemptId, questionTemplateId, resolutionMode: ResolutionMode.INDEPENDENT } }) + 1;
    const isStrategy = question.answerMode === AnswerMode.STRATEGY;
    const maxIndependentAttempts = Number(isStrategy ? retryPolicy.strategyIndependentAttempts ?? 1 : retryPolicy.maxIndependentAttempts);
    if (attemptNumber > maxIndependentAttempts) apiError(409, "MAX_ATTEMPTS_REACHED", "No further independent submission is allowed; Reveal is available");
    const rule = answerRuleSchema.parse(question.answerRule);
    if (attempt.mission.stableId === "M4" && ["M4-Q05", "M4-Q06"].includes(question.stableId)) await this.validateEtsTrade(missionAttemptId, attempt.missionTemplateId, question.stableId, parsed.data.answer);
    if (attempt.mission.stableId === "M5" && question.stableId === "M5-Q03") await this.projectMissionFive(missionAttemptId, attempt.missionTemplateId, parsed.data.answer);
    if (attempt.mission.stableId === "M5" && question.stableId === "M5-Q04" && (typeof parsed.data.answer !== "string" || !parsed.data.answer.trim())) apiError(400, "M5_REASONING_REQUIRED", "Submit a non-empty strategy explanation");
    const authoritativeAnswer = attempt.mission.stableId === "M5" && question.stableId === "M5-Q03" && parsed.data.answer && typeof parsed.data.answer === "object"
      ? { action: String((parsed.data.answer as Record<string, unknown>).action ?? ""), quantity: Number((parsed.data.answer as Record<string, unknown>).quantity) }
      : parsed.data.answer;
    const evaluation = question.questionType === QuestionType.ORDER ? evaluateOrderedMultiExact(rule, authoritativeAnswer) : evaluateAnswer(rule, authoritativeAnswer);
    if (evaluation.correct === null) apiError(409, "STRATEGY_RULE_UNAVAILABLE", "This versioned strategy rule has no deterministic evaluator");
    const evidenceScore = Number(evaluation.details.evidenceScore);
    const score = isStrategy && Number.isFinite(evidenceScore) ? evidenceScore : candidateScore(Number(question.baseScore), Boolean(evaluation.correct), attemptNumber, retryFactors);
    const finalized = Boolean(evaluation.correct) || isStrategy;
    const resolutionMode = isStrategy ? ResolutionMode.STRATEGY : ResolutionMode.INDEPENDENT;
    const state = (attempt.runtimeState ?? {}) as RuntimeState;
    const feedback = question.feedbackConfig as { correct?: string; wrong?: string; explanation?: string };
    return this.prisma.$transaction(async (tx) => {
      const submission = await tx.questionAttempt.create({ data: {
        missionAttemptId, questionTemplateId, questionAttemptNo: attemptNumber, clientSubmissionId: parsed.data.clientSubmissionId, requestHash,
        studentAnswer: json(authoritativeAnswer), evaluatedResult: json({ correct: evaluation.correct, ...evaluation.details }), candidateSystemScore: score,
        questionSnapshot: json({ stableId: question.stableId, promptCn: question.promptCn, promptEn: question.promptEn, options: question.options, baseScore: Number(question.baseScore) }),
        ruleSnapshot: json(question.answerRule), feedbackSnapshot: json(question.feedbackConfig), timeSpentMs: parsed.data.timeSpentMs,
        hintUsage: json({ hintUsed: state.hintUsed ?? false }), independentlyCorrect: Boolean(evaluation.correct), resolutionMode
      } });
      const policySnapshot = { contentVersionId: question.contentVersionId, baseScore: Number(question.baseScore), retry: config.retryPolicy, hints: config.assistancePolicy, reveal: config.revealPolicy, selectedAttemptId: finalized ? submission.id : null, resolutionMode: finalized ? resolutionMode : null, calculatedSystemScore: finalized ? score : null, scoringConfigId: config.id, checksum: config.checksum };
      if (finalized) {
        await tx.questionResult.upsert({
          where: { missionAttemptId_questionTemplateId: { missionAttemptId, questionTemplateId } },
          update: { status: QuestionResultStatus.FINALIZED, selectedQuestionAttemptId: submission.id, resolutionMode, systemScore: score, finalizedAt: new Date(), scoringPolicySnapshot: json(policySnapshot) },
          create: { missionAttemptId, questionTemplateId, status: QuestionResultStatus.FINALIZED, selectedQuestionAttemptId: submission.id, resolutionMode, v5BaseScore: question.baseScore, systemScore: score, scoringConfigId: config.id, scoringConfigChecksum: config.checksum, scoringPolicySnapshot: json(policySnapshot), finalizedAt: new Date() }
        });
      } else {
        await tx.questionResult.upsert({ where: { missionAttemptId_questionTemplateId: { missionAttemptId, questionTemplateId } }, update: {}, create: { missionAttemptId, questionTemplateId, v5BaseScore: question.baseScore, scoringConfigId: config.id, scoringConfigChecksum: config.checksum, scoringPolicySnapshot: json(policySnapshot) } });
      }
      await tx.workshopParticipant.update({ where: { id: attempt.attempt.participant.id }, data: { lastActivityAt: new Date() } });
      const showCausalChain = attempt.mission.stableId === "M6" && ["M6-Q01", "M6-Q02", "M6-Q03", "M6-Q11", "M6-Q12", "M6-Q13", "M6-Q14"].includes(question.stableId);
      return { idempotent: false, attemptNumber, correct: evaluation.correct, score, finalized, revealAvailable: !isStrategy && !evaluation.correct && attemptNumber >= Number((config.revealPolicy as { afterFailures?: number }).afterFailures), feedback: evaluation.correct ? feedback.correct : feedback.wrong, explanation: finalized || showCausalChain ? feedback.explanation : undefined };
    });
  }

  async reveal(user: AuthUser, missionAttemptId: string, questionTemplateId: string) {
    const attempt = await this.ownedAttempt(user, missionAttemptId); this.assertSessionActive(attempt);
    const question = await this.prisma.questionTemplate.findUnique({ where: { id: questionTemplateId } });
    if (!question || question.missionTemplateId !== attempt.missionTemplateId) apiError(404, "QUESTION_NOT_FOUND", "Question not found");
    if (question.answerMode === AnswerMode.STRATEGY) apiError(409, "REVEAL_NOT_CONFIGURED", "Reveal is not configured for this strategy decision");
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
    if (!attempt.currentScreen) apiError(409, "MISSION_STATE_INVALID", "MissionAttempt has no current screen");
    const screen = await this.prisma.missionScreenTemplate.findFirst({ where: { missionTemplateId: attempt.missionTemplateId, stableId: screenStableId } });
    if (!screen) apiError(404, "SCREEN_NOT_FOUND", "Screen is not part of this MissionAttempt");
    if (screen.sequenceNo > attempt.currentScreen.sequenceNo + 1) apiError(409, "SCREEN_SEQUENCE_INVALID", "Mission screens must be completed in order");
    if (screen.sequenceNo === attempt.currentScreen.sequenceNo + 1) {
      const [required, resolved] = await Promise.all([
        this.prisma.questionTemplate.count({ where: { screenTemplateId: attempt.currentScreenId! } }),
        this.prisma.questionResult.count({ where: { missionAttemptId, status: QuestionResultStatus.FINALIZED, question: { screenTemplateId: attempt.currentScreenId! } } })
      ]);
      if (resolved !== required) apiError(409, "SCREEN_NOT_RESOLVED", "Resolve every question on this screen before continuing", { resolved, required });
      if (attempt.currentScreen.stableId === "M1-S02") {
        const state = (attempt.runtimeState ?? {}) as RuntimeState;
        const requiredNodes = Number((attempt.currentScreen.inputConfig as { nodesRequired?: number }).nodesRequired);
        if ((state.viewedNodes?.length ?? 0) < requiredNodes) apiError(409, "SCREEN_NOT_RESOLVED", `Inspect at least ${requiredNodes} value-chain nodes before continuing`);
      }
    }
    await this.prisma.$transaction([
      this.prisma.missionAttempt.update({ where: { id: missionAttemptId }, data: { currentScreenId: screen.id } }),
      this.prisma.workshopParticipant.update({ where: { id: attempt.attempt.participant.id }, data: { lastActivityAt: new Date() } })
    ]);
    return { currentScreenId: screen.id, stableId: screen.stableId };
  }

  async complete(user: AuthUser, missionAttemptId: string) {
    const attempt = await this.ownedAttempt(user, missionAttemptId); this.assertSessionActive(attempt);
    const state = (attempt.runtimeState ?? {}) as RuntimeState;
    if (attempt.mission.stableId === "M1") {
      const valueChainScreen = await this.prisma.missionScreenTemplate.findFirstOrThrow({ where: { missionTemplateId: attempt.missionTemplateId, stableId: "M1-S02" } });
      const nodesRequired = Number((valueChainScreen.inputConfig as { nodesRequired?: number }).nodesRequired);
      if ((state.viewedNodes?.length ?? 0) < nodesRequired) apiError(409, "MISSION_NOT_COMPLETABLE", `Inspect at least ${nodesRequired} value-chain nodes`);
      if (!state.reflection?.trim()) apiError(409, "MISSION_NOT_COMPLETABLE", "A non-empty reflection is required");
    }
    const totalQuestions = await this.prisma.questionTemplate.count({ where: { missionTemplateId: attempt.missionTemplateId } });
    const resolved = await this.prisma.questionResult.count({ where: { missionAttemptId, status: QuestionResultStatus.FINALIZED } });
    if (resolved !== totalQuestions) apiError(409, "MISSION_NOT_COMPLETABLE", "All Mission questions must be resolved", { resolved, required: totalQuestions });
    const rubricBreakdown = attempt.mission.stableId === "M5" ? await this.scoring.calculateMissionFiveBreakdown(missionAttemptId) : null;
    const roundBreakdown = attempt.mission.stableId === "M6" ? await this.scoring.calculateMissionSixBreakdown(missionAttemptId) : null;
    const systemScore = rubricBreakdown?.total ?? roundBreakdown?.total ?? await this.scoring.calculateMission(missionAttemptId, false);
    const scoreBreakdown = typeof (this.scoring as { calculateMissionBreakdown?: unknown }).calculateMissionBreakdown === "function" ? await this.scoring.calculateMissionBreakdown(missionAttemptId, false) : null;
    const config = await this.prisma.missionScoringConfig.findUniqueOrThrow({ where: { contentVersionId_missionTemplateId: { contentVersionId: attempt.mission.contentVersionId, missionTemplateId: attempt.missionTemplateId } } });
    await this.prisma.$transaction([
      this.prisma.missionAttempt.update({ where: { id: missionAttemptId }, data: { status: AttemptStatus.COMPLETED, systemScore, completedAt: new Date(), scoringPolicySnapshot: json({ contentVersionId: attempt.mission.contentVersionId, configId: config.id, checksum: config.checksum, components: config.componentDefinitions, retry: config.retryPolicy, assistance: config.assistancePolicy, reveal: config.revealPolicy, completion: config.completionPolicy, ...(rubricBreakdown ? { rubricBreakdown } : {}), ...(roundBreakdown ? { roundBreakdown } : {}), systemScore }) } }),
      this.prisma.workshopParticipant.update({ where: { id: attempt.attempt.participant.id }, data: { lastActivityAt: new Date() } })
    ]);
    let finalResult = null;
    if (attempt.mission.stableId === "M6") {
      finalResult = await this.scoring.calculateFinalResult(attempt.attemptId);
      if (finalResult) await this.prisma.attempt.update({ where: { id: attempt.attemptId }, data: { status: AttemptStatus.COMPLETED, systemTotalScore: finalResult.calculatedScore, scoringPolicySnapshot: json({ contentVersionId: attempt.mission.contentVersionId, missionScores: finalResult.missionScores, calculatedScore: finalResult.calculatedScore, weights: finalResult.weights }), completedAt: new Date() } });
    }
    return { status: "COMPLETED", systemScore, ...(scoreBreakdown ? { scoreBreakdown } : {}), ...(rubricBreakdown ? { rubricBreakdown } : {}), ...(roundBreakdown ? { roundBreakdown } : {}), ...(finalResult ? { finalResult } : {}), nextMission: attempt.mission.stableId === "M6" ? { state: "NONE" } : { state: "LOCKED", reason: "WAITING_FOR_TEACHER" } };
  }

  async finalResult(user: AuthUser, sessionId: string) {
    const participant = await this.ownedParticipant(user, sessionId);
    const attempts = await this.prisma.attempt.findMany({ where: { participantId: participant.id }, include: { missionAttempts: { include: { mission: true } } }, orderBy: { startedAt: "desc" } });
    for (const attempt of attempts) {
      if ([...new Set(attempt.missionAttempts.filter((mission) => mission.status === AttemptStatus.COMPLETED).map((mission) => mission.mission.stableId))].length === 6) return this.scoring.calculateFinalResult(attempt.id);
    }
    return null;
  }

  async history(user: AuthUser) {
    this.ensureStudent(user);
    const attempts = await this.prisma.attempt.findMany({ where: { participant: { studentId: user.userId } }, include: { missionAttempts: { include: { mission: true, questionResults: { include: { question: { select: { stableId: true } } } } } }, participant: { include: { session: { include: { workshop: true } } } } }, orderBy: { startedAt: "desc" } });
    return Promise.all(attempts.map(async (attempt) => {
      const finalResult = attempt.missionAttempts.length >= 6 ? await this.scoring.calculateFinalResult(attempt.id).catch(() => null) : null;
      return {
      id: attempt.id,
      attemptNo: attempt.attemptNo,
      status: attempt.status,
      systemTotalScore: attempt.systemTotalScore === null ? null : Number(attempt.systemTotalScore),
      startedAt: attempt.startedAt,
      completedAt: attempt.completedAt,
      session: { id: attempt.participant.session.id, status: attempt.participant.session.status, workshop: { id: attempt.participant.session.workshop.id, name: attempt.participant.session.workshop.name } },
      calculatedFinalScore: finalResult?.calculatedScore ?? null,
      effectiveFinalScore: finalResult?.effectiveScore ?? null,
      finalOverride: finalResult?.finalOverride ?? null,
      missionAttempts: await Promise.all(attempt.missionAttempts.map(async (missionAttempt) => ({
        id: missionAttempt.id,
        status: missionAttempt.status,
        systemScore: missionAttempt.systemScore === null ? null : Number(missionAttempt.systemScore),
        effectiveScore: missionAttempt.systemScore === null ? null : await this.scoring.calculateMission(missionAttempt.id, true),
        scoreBreakdown: missionAttempt.systemScore === null || typeof (this.scoring as { calculateMissionBreakdown?: unknown }).calculateMissionBreakdown !== "function" ? null : await this.scoring.calculateMissionBreakdown(missionAttempt.id, true),
        roundBreakdown: missionAttempt.mission.stableId === "M6" && missionAttempt.systemScore !== null ? await this.scoring.calculateMissionSixBreakdown(missionAttempt.id, true) : null,
        completedAt: missionAttempt.completedAt,
        mission: { stableId: missionAttempt.mission.stableId, titleCn: missionAttempt.mission.titleCn, titleEn: missionAttempt.mission.titleEn },
        questionResults: missionAttempt.questionResults.map((result) => ({ questionStableId: result.question.stableId, status: result.status, systemScore: result.systemScore === null ? null : Number(result.systemScore), resolutionMode: result.resolutionMode }))
      })))
    };
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
  @Get("sessions/:sessionId/final-result") finalResult(@CurrentUser() user: AuthUser, @Param("sessionId") sessionId: string) { return this.service.finalResult(user, sessionId); }
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
  @Post("mission-attempts/:missionAttemptId/m5/preview")
  previewMissionFive(@CurrentUser() user: AuthUser, @Param("missionAttemptId") missionAttemptId: string, @Body() body: unknown) { return this.service.previewMissionFive(user, missionAttemptId, body); }
  @Post("mission-attempts/:missionAttemptId/questions/:questionTemplateId/hint") hint(@CurrentUser() user: AuthUser, @Param("missionAttemptId") missionAttemptId: string, @Param("questionTemplateId") questionTemplateId: string) { return this.service.hint(user, missionAttemptId, questionTemplateId); }
  @Post("mission-attempts/:missionAttemptId/questions/:questionTemplateId/reveal") reveal(@CurrentUser() user: AuthUser, @Param("missionAttemptId") missionAttemptId: string, @Param("questionTemplateId") questionTemplateId: string) { return this.service.reveal(user, missionAttemptId, questionTemplateId); }
  @Post("mission-attempts/:missionAttemptId/complete") complete(@CurrentUser() user: AuthUser, @Param("missionAttemptId") id: string) { return this.service.complete(user, id); }
  @Get("history") history(@CurrentUser() user: AuthUser) { return this.service.history(user); }
}
