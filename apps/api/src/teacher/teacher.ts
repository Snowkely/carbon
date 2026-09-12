import { Body, Controller, Delete, Get, Injectable, Param, Patch, Post, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiForbiddenResponse, ApiTags, ApiUnauthorizedResponse } from "@nestjs/swagger";
import { AccountType, ExportDataset, ExportFormat, ExportStatus, Prisma, QuestionResultStatus, ScoreTargetLevel, SessionStatus, UnlockSource, WorkshopRole, WorkshopStatus } from "@prisma/client";
import { AuthUser, CurrentUser, JwtAuthGuard } from "../common/auth";
import { apiError } from "../common/api-error";
import { PrismaService } from "../common/prisma.service";
import { ScoringService } from "../student/scoring.service";
import { CreateSessionDto, CreateWorkshopDto, ScoreAdjustmentDto, SetWorkshopTeacherDto, UpdateWorkshopDto } from "../openapi/request-dtos";
import { scoreAdjustmentStreamResponse } from "./teacher-response";

const json = (value: unknown) => value as Prisma.InputJsonValue;
const MUTATORS: WorkshopRole[] = [WorkshopRole.OWNER, WorkshopRole.INSTRUCTOR];

@Injectable()
export class TeacherService {
  constructor(private readonly prisma: PrismaService, private readonly scoring: ScoringService) {}
  private ensureTeacher(user: AuthUser) { if (user.accountType !== AccountType.TEACHER) apiError(403, "FORBIDDEN", "Teacher account required"); }

  private async membership(user: AuthUser, workshopId: string, allowed?: WorkshopRole[]) {
    this.ensureTeacher(user);
    const membership = await this.prisma.workshopTeacher.findUnique({ where: { workshopId_teacherId: { workshopId, teacherId: user.userId } } });
    if (!membership || (allowed && !allowed.includes(membership.role))) apiError(403, "FORBIDDEN", "Workshop permission denied");
    return membership;
  }

  async dashboard(user: AuthUser) {
    this.ensureTeacher(user);
    return this.prisma.workshop.findMany({ where: { status: { not: WorkshopStatus.ARCHIVED }, teachers: { some: { teacherId: user.userId } } }, include: { sessions: { orderBy: { sessionNo: "desc" }, take: 1 }, _count: { select: { sessions: true } } }, orderBy: { createdAt: "desc" } });
  }

  async workshop(user: AuthUser, workshopId: string) {
    const membership = await this.membership(user, workshopId);
    const workshop = await this.prisma.workshop.findUniqueOrThrow({
      where: { id: workshopId },
      include: { audiences: { include: { schoolClass: true } }, teachers: { include: { teacher: { include: { user: { select: { username: true } } } } } }, contentVersion: true }
    });
    return { ...workshop, currentRole: membership.role };
  }

  async updateWorkshop(user: AuthUser, workshopId: string, input: { name?: string }) {
    await this.membership(user, workshopId, [WorkshopRole.OWNER]);
    if (!input.name?.trim()) apiError(400, "VALIDATION_ERROR", "Workshop name is required");
    return this.prisma.workshop.update({ where: { id: workshopId }, data: { name: input.name.trim() } });
  }

  async setWorkshopTeacher(user: AuthUser, workshopId: string, input: { username?: string; role?: WorkshopRole }) {
    await this.membership(user, workshopId, [WorkshopRole.OWNER]);
    if (!input.username?.trim() || !input.role || !Object.values(WorkshopRole).includes(input.role)) apiError(400, "VALIDATION_ERROR", "username and a valid Workshop role are required");
    const workshop = await this.prisma.workshop.findUniqueOrThrow({ where: { id: workshopId } });
    const target = await this.prisma.userAccount.findUnique({ where: { username: input.username.trim() }, include: { teacher: true } });
    if (!target?.teacher || target.accountType !== AccountType.TEACHER || target.status !== "ACTIVE" || target.teacher.schoolId !== workshop.schoolId) apiError(400, "INVALID_TEACHER", "An active Teacher from the Workshop school is required");
    const existing = await this.prisma.workshopTeacher.findUnique({ where: { workshopId_teacherId: { workshopId, teacherId: target.id } } });
    if (existing?.role === WorkshopRole.OWNER && input.role !== WorkshopRole.OWNER) {
      const ownerCount = await this.prisma.workshopTeacher.count({ where: { workshopId, role: WorkshopRole.OWNER } });
      if (ownerCount <= 1) apiError(409, "LAST_OWNER_REQUIRED", "A Workshop must retain at least one OWNER");
    }
    return this.prisma.workshopTeacher.upsert({ where: { workshopId_teacherId: { workshopId, teacherId: target.id } }, update: { role: input.role }, create: { workshopId, teacherId: target.id, role: input.role } });
  }

  async removeWorkshopTeacher(user: AuthUser, workshopId: string, teacherId: string) {
    await this.membership(user, workshopId, [WorkshopRole.OWNER]);
    const existing = await this.prisma.workshopTeacher.findUnique({ where: { workshopId_teacherId: { workshopId, teacherId } } });
    if (!existing) apiError(404, "WORKSHOP_TEACHER_NOT_FOUND", "Workshop teacher not found");
    if (existing.role === WorkshopRole.OWNER) {
      const ownerCount = await this.prisma.workshopTeacher.count({ where: { workshopId, role: WorkshopRole.OWNER } });
      if (ownerCount <= 1) apiError(409, "LAST_OWNER_REQUIRED", "A Workshop must retain at least one OWNER");
    }
    await this.prisma.workshopTeacher.delete({ where: { workshopId_teacherId: { workshopId, teacherId } } });
    return { removed: true };
  }

  async archiveWorkshop(user: AuthUser, workshopId: string) {
    await this.membership(user, workshopId, [WorkshopRole.OWNER]);
    const activeSessions = await this.prisma.workshopSession.count({ where: { workshopId, status: SessionStatus.ACTIVE } });
    if (activeSessions) apiError(409, "ACTIVE_SESSION_EXISTS", "End the active Session before archiving the Workshop");
    return this.prisma.workshop.update({ where: { id: workshopId }, data: { status: WorkshopStatus.ARCHIVED } });
  }

  async createWorkshop(user: AuthUser, input: { name?: string; contentVersionId?: string; schoolId?: string; classIds?: string[] }) {
    this.ensureTeacher(user);
    if (!input.name?.trim() || !input.contentVersionId || !input.schoolId) apiError(400, "VALIDATION_ERROR", "name, contentVersionId and schoolId are required");
    const profile = await this.prisma.teacherProfile.findUnique({ where: { userId: user.userId } });
    if (!profile || profile.schoolId !== input.schoolId) apiError(403, "FORBIDDEN", "Teacher cannot create a Workshop for another school");
    const version = await this.prisma.gameContentVersion.findFirst({ where: { id: input.contentVersionId, status: "PUBLISHED" } });
    if (!version) apiError(400, "CONTENT_NOT_PUBLISHED", "Workshop requires a published content version");
    if (input.classIds?.length) {
      const count = await this.prisma.schoolClass.count({ where: { id: { in: input.classIds }, schoolId: input.schoolId, status: "ACTIVE" } });
      if (count !== new Set(input.classIds).size) apiError(400, "INVALID_REFERENCE", "All classes must be active controlled reference data");
    }
    return this.prisma.$transaction(async (tx) => {
      const workshop = await tx.workshop.create({ data: { schoolId: input.schoolId!, contentVersionId: input.contentVersionId!, name: input.name!.trim(), status: WorkshopStatus.READY, createdByTeacherId: user.userId } });
      await tx.workshopTeacher.create({ data: { workshopId: workshop.id, teacherId: user.userId, role: WorkshopRole.OWNER } });
      const classIds = [...new Set(input.classIds ?? [])];
      if (classIds.length) await tx.workshopAudience.createMany({ data: classIds.map((classId) => ({ workshopId: workshop.id, schoolId: input.schoolId!, classId })) });
      else await tx.workshopAudience.create({ data: { workshopId: workshop.id, schoolId: input.schoolId!, classId: null } });
      return workshop;
    });
  }

  async createSession(user: AuthUser, workshopId: string, input: { scheduledAt?: string }) {
    await this.membership(user, workshopId, MUTATORS);
    const workshop = await this.prisma.workshop.findUniqueOrThrow({ where: { id: workshopId } });
    if (workshop.status !== WorkshopStatus.READY) apiError(409, "INVALID_WORKSHOP_STATE", "Sessions may be created only for a READY Workshop");
    const count = await this.prisma.workshopSession.count({ where: { workshopId } });
    return this.prisma.workshopSession.create({ data: { workshopId, sessionNo: count + 1, scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null } });
  }

  async startSession(user: AuthUser, sessionId: string) {
    this.ensureTeacher(user);
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.workshopSession.findUnique({ where: { id: sessionId }, include: { workshop: { include: { audiences: true } } } });
      if (!session) apiError(404, "SESSION_NOT_FOUND", "Session not found");
      const membership = await tx.workshopTeacher.findUnique({ where: { workshopId_teacherId: { workshopId: session.workshopId, teacherId: user.userId } } });
      if (!membership || !MUTATORS.includes(membership.role)) apiError(403, "FORBIDDEN", "Session start permission denied");
      if (session.status !== SessionStatus.SCHEDULED) apiError(409, "INVALID_SESSION_STATE", "Only a scheduled Session can start");
      if (session.workshop.status !== WorkshopStatus.READY) apiError(409, "INVALID_WORKSHOP_STATE", "Only a READY Workshop Session can start");
      if (!session.workshop.audiences.length) apiError(409, "AUDIENCE_REQUIRED", "Workshop audience is required");
      const schoolIds = [...new Set(session.workshop.audiences.map((audience) => audience.schoolId))].sort();
      for (const schoolId of schoolIds) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${schoolId}))`;
      for (const audience of session.workshop.audiences) {
        const conflict = await tx.workshopSession.findFirst({
          where: {
            id: { not: sessionId }, status: SessionStatus.ACTIVE,
            audiences: { some: audience.classId === null ? { schoolId: audience.schoolId } : { schoolId: audience.schoolId, OR: [{ classId: null }, { classId: audience.classId }] } }
          }, select: { id: true, workshopId: true }
        });
        if (conflict) apiError(409, "ACTIVE_SESSION_AUDIENCE_CONFLICT", "Another active session already covers this school or class", { requestedSessionId: sessionId, conflictingSessionId: conflict.id, schoolId: audience.schoolId, classId: audience.classId });
      }
      await tx.workshopSessionAudience.createMany({ data: session.workshop.audiences.map((audience) => ({ sessionId, schoolId: audience.schoolId, classId: audience.classId })) });
      const m1 = await tx.missionTemplate.findFirstOrThrow({ where: { contentVersionId: session.workshop.contentVersionId, sequenceNo: 1 } });
      await tx.workshopSession.update({ where: { id: sessionId }, data: { status: SessionStatus.ACTIVE, startedByTeacherId: user.userId, startedAt: new Date() } });
      await tx.missionUnlock.create({ data: { sessionId, missionTemplateId: m1.id, unlockSource: UnlockSource.INITIAL, unlockedByTeacherId: user.userId } });
      return tx.workshopSession.findUnique({ where: { id: sessionId }, include: { audiences: true, unlocks: true } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async endSession(user: AuthUser, sessionId: string) {
    const session = await this.prisma.workshopSession.findUnique({ where: { id: sessionId } });
    if (!session) apiError(404, "SESSION_NOT_FOUND", "Session not found");
    await this.membership(user, session.workshopId, MUTATORS);
    if (session.status === SessionStatus.ENDED) return session;
    if (session.status !== SessionStatus.ACTIVE) apiError(409, "INVALID_SESSION_STATE", "Only an active Session can end");
    return this.prisma.workshopSession.update({ where: { id: sessionId }, data: { status: SessionStatus.ENDED, endedAt: new Date() } });
  }

  async unlock(user: AuthUser, sessionId: string, missionTemplateId: string) {
    const session = await this.prisma.workshopSession.findUnique({ where: { id: sessionId }, include: { workshop: true } });
    if (!session) apiError(404, "SESSION_NOT_FOUND", "Session not found");
    await this.membership(user, session.workshopId, MUTATORS);
    if (session.status !== SessionStatus.ACTIVE) apiError(409, "SESSION_INACTIVE", "Mission unlock requires an active Session");
    const mission = await this.prisma.missionTemplate.findUnique({ where: { id: missionTemplateId } });
    if (!mission || mission.contentVersionId !== session.workshop.contentVersionId || mission.sequenceNo < 2) apiError(400, "INVALID_MISSION_UNLOCK", "Teacher unlock is valid only for Mission 2–6 in the Session content version");
    return this.prisma.missionUnlock.upsert({ where: { sessionId_missionTemplateId: { sessionId, missionTemplateId } }, update: {}, create: { sessionId, missionTemplateId, unlockSource: UnlockSource.TEACHER, unlockedByTeacherId: user.userId } });
  }

  async missionControl(user: AuthUser, sessionId: string) {
    const session = await this.prisma.workshopSession.findUnique({ where: { id: sessionId }, include: { workshop: true, unlocks: true, participants: { include: { attempts: { include: { missionAttempts: true } } } } } });
    if (!session) apiError(404, "SESSION_NOT_FOUND", "Session not found");
    await this.membership(user, session.workshopId);
    const missions = await this.prisma.missionTemplate.findMany({ where: { contentVersionId: session.workshop.contentVersionId }, orderBy: { sequenceNo: "asc" } });
    return missions.map((mission, index) => {
      const unlock = session.unlocks.find((item) => item.missionTemplateId === mission.id);
      const statuses = session.participants.map((participant) => {
        const missionAttempts = participant.attempts.flatMap((attempt) => attempt.missionAttempts);
        const completed = missionAttempts.some((item) => item.missionTemplateId === mission.id && item.status === "COMPLETED");
        const active = missionAttempts.some((item) => item.missionTemplateId === mission.id && item.status === "IN_PROGRESS");
        const previous = index === 0 || missionAttempts.some((item) => item.missionTemplateId === missions[index - 1]!.id && item.status === "COMPLETED");
        return completed ? "COMPLETED" : active ? "IN_PROGRESS" : unlock && previous ? "AVAILABLE" : unlock ? "BLOCKED_PREREQUISITE" : "LOCKED";
      });
      const display = (mission.displayConfig ?? {}) as { phase?: string; gameplayImplemented?: boolean };
      return { missionTemplateId: mission.id, stableId: mission.stableId, gameplayImplemented: display.gameplayImplemented ?? display.phase === "IMPLEMENTED", unlockState: unlock ? "UNLOCKED_FOR_SESSION" : "LOCKED_FOR_SESSION", unlockSource: unlock?.unlockSource, counts: { eligible: statuses.length, completed: statuses.filter((s) => s === "COMPLETED").length, availableOrInProgress: statuses.filter((s) => s === "AVAILABLE" || s === "IN_PROGRESS").length, blockedByPrerequisite: statuses.filter((s) => s === "BLOCKED_PREREQUISITE").length } };
    });
  }

  async monitor(user: AuthUser, sessionId: string) {
    const session = await this.prisma.workshopSession.findUnique({ where: { id: sessionId } });
    if (!session) apiError(404, "SESSION_NOT_FOUND", "Session not found");
    await this.membership(user, session.workshopId);
    const threshold = Number(process.env.PRESENCE_OFFLINE_SECONDS ?? 30) * 1000;
    const participants = await this.prisma.workshopParticipant.findMany({ where: { sessionId }, include: { student: true, attempts: { include: { missionAttempts: { include: { mission: true, currentScreen: true } } }, orderBy: { startedAt: "desc" } } } });
    return Promise.all(participants.map(async (participant) => {
      const allMissionAttempts = participant.attempts.flatMap((attempt) => attempt.missionAttempts);
      const missionAttempt = allMissionAttempts.find((item) => item.status === "IN_PROGRESS") ?? [...allMissionAttempts].sort((left, right) => right.mission.sequenceNo - left.mission.sequenceNo)[0];
      const effectiveScore = missionAttempt ? await this.scoring.calculateMission(missionAttempt.id, true) : 0;
      const finalResult = participant.attempts[0] ? await this.scoring.calculateFinalResult(participant.attempts[0].id).catch(() => null) : null;
      return { studentId: participant.studentId, name: participant.student.name, online: Boolean(participant.lastActivityAt && Date.now() - participant.lastActivityAt.getTime() <= threshold), currentMission: missionAttempt?.mission.stableId ?? null, currentScreen: missionAttempt?.currentScreen?.stableId ?? null, currentEffectiveScore: effectiveScore, finalCarbonMarketIq: finalResult?.effectiveScore ?? null, lastActivity: participant.lastActivityAt };
    }));
  }

  async students(user: AuthUser, workshopId: string) {
    await this.membership(user, workshopId);
    const adjustmentStreamInclude = {
      currentAdjustment: true,
      adjustments: { include: { adjustedBy: { select: { name: true } } }, orderBy: { createdAt: "asc" as const } }
    };
    const participants = await this.prisma.workshopParticipant.findMany({
      where: { session: { workshopId } },
      include: {
        student: { include: { school: true, schoolClass: true } },
        attempts: {
          include: {
            adjustmentStream: { include: adjustmentStreamInclude },
            missionAttempts: {
              include: {
                mission: true,
                adjustmentStream: { include: adjustmentStreamInclude },
                questionResults: {
                  include: {
                    question: { select: { stableId: true, promptEn: true, promptCn: true } },
                    adjustmentStream: { include: adjustmentStreamInclude }
                  }
                }
              }
            }
          }
        }
      },
      orderBy: { discoveredAt: "asc" }
    });
    return Promise.all(participants.map(async (participant) => ({
      ...participant,
      attempts: await Promise.all(participant.attempts.map(async (attempt) => ({
        ...attempt,
        ...await (async () => {
          const finalResult = attempt.missionAttempts.length >= 6 ? await this.scoring.calculateFinalResult(attempt.id).catch(() => null) : null;
          return { calculatedFinalScore: finalResult?.calculatedScore ?? null, effectiveScore: finalResult?.effectiveScore ?? null };
        })(),
        adjustmentStream: attempt.adjustmentStream ? scoreAdjustmentStreamResponse(attempt.adjustmentStream) : null,
        missionAttempts: await Promise.all(attempt.missionAttempts.map(async (missionAttempt) => {
          const systemScore = missionAttempt.systemScore == null ? null : Number(missionAttempt.systemScore);
          const questionAdjustedScore = systemScore === null
            ? null
            : await this.scoring.calculateMission(missionAttempt.id, true, false);
          const missionOverride = missionAttempt.adjustmentStream?.currentAdjustment
            ? Number(missionAttempt.adjustmentStream.currentAdjustment.adjustedScore)
            : null;
          return {
            ...missionAttempt,
            scoreBreakdown: systemScore === null || typeof (this.scoring as { calculateMissionBreakdown?: unknown }).calculateMissionBreakdown !== "function" ? null : await this.scoring.calculateMissionBreakdown(missionAttempt.id, true),
            rubricBreakdown: missionAttempt.mission?.stableId === "M5" ? (missionAttempt.scoringPolicySnapshot as { rubricBreakdown?: unknown } | null)?.rubricBreakdown ?? null : null,
            roundBreakdown: missionAttempt.mission?.stableId === "M6" && systemScore !== null ? await this.scoring.calculateMissionSixBreakdown(missionAttempt.id, true) : null,
            questionAdjustedScore,
            effectiveScore: missionOverride ?? questionAdjustedScore,
            adjustmentStream: missionAttempt.adjustmentStream ? scoreAdjustmentStreamResponse(missionAttempt.adjustmentStream) : null,
            questionResults: missionAttempt.questionResults.map((questionResult) => ({
              ...questionResult,
              effectiveScore: questionResult.adjustmentStream?.currentAdjustment ? Number(questionResult.adjustmentStream.currentAdjustment.adjustedScore) : questionResult.systemScore == null ? null : Number(questionResult.systemScore),
              adjustmentStream: questionResult.adjustmentStream ? scoreAdjustmentStreamResponse(questionResult.adjustmentStream) : null
            }))
          };
        }))
      })))
    })));
  }

  async questionResult(user: AuthUser, questionResultId: string) {
    this.ensureTeacher(user);
    const result = await this.prisma.questionResult.findUnique({ where: { id: questionResultId }, include: { question: true, selectedAttempt: true, missionAttempt: { include: { attempt: { include: { participant: { include: { session: true, student: true } } } } } }, adjustmentStream: { include: { currentAdjustment: true, adjustments: { include: { adjustedBy: { select: { name: true } } }, orderBy: { createdAt: "asc" } } } } } });
    if (!result) apiError(404, "QUESTION_RESULT_NOT_FOUND", "QuestionResult not found");
    await this.membership(user, result.missionAttempt.attempt.participant.session.workshopId);
    const attempts = await this.prisma.questionAttempt.findMany({ where: { missionAttemptId: result.missionAttemptId, questionTemplateId: result.questionTemplateId }, orderBy: { questionAttemptNo: "asc" } });
    return { ...result, adjustmentStream: result.adjustmentStream ? scoreAdjustmentStreamResponse(result.adjustmentStream) : null, allAttempts: attempts, effectiveScore: result.adjustmentStream?.currentAdjustment ? Number(result.adjustmentStream.currentAdjustment.adjustedScore) : result.systemScore == null ? null : Number(result.systemScore) };
  }

  async adjust(user: AuthUser, input: { targetLevel?: ScoreTargetLevel; targetId?: string; adjustedScore?: number; reason?: string; expectedSupersedesAdjustmentId?: string | null }) {
    this.ensureTeacher(user);
    if (!input.targetLevel || !input.targetId || typeof input.adjustedScore !== "number" || !input.reason?.trim()) apiError(400, "VALIDATION_ERROR", "targetLevel, targetId, adjustedScore and reason are required");
    if (!Object.prototype.hasOwnProperty.call(input, "expectedSupersedesAdjustmentId")) apiError(400, "VALIDATION_ERROR", "expectedSupersedesAdjustmentId must be supplied explicitly");
    let workshopId: string; let systemScore: number; let maximum = 100;
    if (input.targetLevel === ScoreTargetLevel.QUESTION) {
      const target = await this.prisma.questionResult.findUnique({ where: { id: input.targetId }, include: { missionAttempt: { include: { attempt: { include: { participant: { include: { session: true } } } } } } } });
      if (!target || target.status !== QuestionResultStatus.FINALIZED) apiError(404, "QUESTION_RESULT_NOT_FOUND", "Finalized QuestionResult not found");
      workshopId = target.missionAttempt.attempt.participant.session.workshopId; systemScore = Number(target.systemScore); maximum = Number(target.v5BaseScore);
    } else if (input.targetLevel === ScoreTargetLevel.MISSION) {
      const target = await this.prisma.missionAttempt.findUnique({ where: { id: input.targetId }, include: { attempt: { include: { participant: { include: { session: true } } } } } });
      if (!target || target.systemScore === null) apiError(404, "MISSION_RESULT_NOT_FOUND", "Scored MissionAttempt not found");
      workshopId = target.attempt.participant.session.workshopId; systemScore = Number(target.systemScore);
    } else {
      const target = await this.prisma.attempt.findUnique({ where: { id: input.targetId }, include: { participant: { include: { session: true } } } });
      if (!target || target.systemTotalScore === null) apiError(404, "FINAL_RESULT_NOT_FOUND", "Final scored Attempt not found");
      workshopId = target.participant.session.workshopId;
      const finalResult = typeof (this.scoring as ScoringService & { calculateFinalResult?: ScoringService["calculateFinalResult"] }).calculateFinalResult === "function"
        ? await this.scoring.calculateFinalResult(target.id, false)
        : null;
      systemScore = finalResult?.calculatedScore ?? Number(target.systemTotalScore);
    }
    await this.membership(user, workshopId, MUTATORS);
    if (input.adjustedScore < 0 || input.adjustedScore > maximum) apiError(400, "SCORE_OUT_OF_BOUNDS", `Adjusted score must be between 0 and ${maximum}`);
    const targetWhere = input.targetLevel === ScoreTargetLevel.QUESTION ? { questionResultId: input.targetId } : input.targetLevel === ScoreTargetLevel.MISSION ? { missionAttemptId: input.targetId } : { attemptId: input.targetId };
    let adjustment;
    try {
      adjustment = await this.prisma.$transaction(async (tx) => {
        let stream = await tx.scoreAdjustmentStream.findFirst({ where: targetWhere });
        if (!stream) stream = await tx.scoreAdjustmentStream.create({ data: { targetLevel: input.targetLevel!, ...targetWhere } });
        const locked = await tx.$queryRaw<Array<{ id: string; currentAdjustmentId: string | null }>>(Prisma.sql`
          SELECT "id", "current_adjustment_id" AS "currentAdjustmentId"
          FROM "score_adjustment_stream"
          WHERE "id" = ${stream.id}::uuid
          FOR UPDATE
        `);
        const currentAdjustmentId = locked[0]?.currentAdjustmentId ?? null;
        const expected = input.expectedSupersedesAdjustmentId ?? null;
        if (currentAdjustmentId !== expected) apiError(409, "SCORE_ADJUSTMENT_STALE", "Another adjustment became effective first", { currentAdjustmentId });
        const created = await tx.scoreAdjustment.create({ data: { streamId: stream.id, supersedesAdjustmentId: currentAdjustmentId, originalSystemScore: systemScore, adjustedScore: input.adjustedScore!, reason: input.reason!.trim(), adjustedByTeacherId: user.userId } });
        await tx.scoreAdjustmentStream.update({ where: { id: stream.id }, data: { currentAdjustmentId: created.id, version: { increment: 1 } } });
        return created;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (["P2002", "P2034"].includes((error as { code?: string }).code ?? "")) apiError(409, "SCORE_ADJUSTMENT_STALE", "Another adjustment became effective first");
      throw error;
    }
    let effectiveMissionScore: number | undefined;
    if (input.targetLevel === ScoreTargetLevel.QUESTION) {
      const result = await this.prisma.questionResult.findUniqueOrThrow({ where: { id: input.targetId } });
      effectiveMissionScore = await this.scoring.calculateMission(result.missionAttemptId, true);
    }
    return { adjustment, effectiveMissionScore };
  }

  async exportCsv(user: AuthUser, workshopId: string) {
    await this.membership(user, workshopId, [WorkshopRole.OWNER, WorkshopRole.INSTRUCTOR]);
    const rows = await this.prisma.workshopParticipant.findMany({ where: { session: { workshopId } }, include: { student: true, attempts: { include: { missionAttempts: { include: { mission: true } } } } } });
    const lines = ["Name,Student ID,Mission,System Score,Effective Score,Status"];
    for (const participant of rows) for (const attempt of participant.attempts) for (const mission of attempt.missionAttempts) {
      const effectiveScore = await this.scoring.calculateMission(mission.id, true);
      lines.push([participant.student.name, participant.student.studentId, mission.mission.stableId, mission.systemScore?.toString() ?? "", effectiveScore, mission.status].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","));
    }
    const data = Buffer.from(lines.join("\r\n"), "utf8");
    return this.prisma.exportRecord.create({ data: { workshopId, requestedByTeacherId: user.userId, datasetType: ExportDataset.MISSION_SCORE, format: ExportFormat.CSV, filters: {}, status: ExportStatus.SUCCEEDED, objectKey: `db://${workshopId}/${Date.now()}.csv`, fileData: data, completedAt: new Date() }, select: { id: true, status: true, format: true, completedAt: true } });
  }

  async downloadExport(user: AuthUser, exportId: string) {
    const record = await this.prisma.exportRecord.findUnique({ where: { id: exportId } });
    if (!record) apiError(404, "EXPORT_NOT_FOUND", "Export not found");
    await this.membership(user, record.workshopId, [WorkshopRole.OWNER, WorkshopRole.INSTRUCTOR]);
    if (!record.fileData) apiError(409, "EXPORT_NOT_READY", "Export file is not ready");
    return { filename: `carbon-trader-${record.datasetType.toLowerCase()}.csv`, contentType: "text/csv; charset=utf-8", base64: Buffer.from(record.fileData).toString("base64") };
  }

  async questionBank(user: AuthUser) {
    this.ensureTeacher(user);
    return this.prisma.gameContentVersion.findMany({ where: { status: "PUBLISHED" }, orderBy: { publishedAt: "desc" }, include: { missions: { include: { questions: { select: { id: true, stableId: true, questionType: true, answerMode: true, promptCn: true, promptEn: true, baseScore: true } } } } } });
  }
}

@Controller("teacher")
@UseGuards(JwtAuthGuard)
@ApiTags("Teacher")
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: "Authentication required" })
@ApiForbiddenResponse({ description: "Teacher or Workshop permission required" })
export class TeacherController {
  constructor(private readonly service: TeacherService) {}
  @Get("dashboard") dashboard(@CurrentUser() user: AuthUser) { return this.service.dashboard(user); }
  @Post("workshops") @ApiBody({ type: CreateWorkshopDto }) workshops(@CurrentUser() user: AuthUser, @Body() body: CreateWorkshopDto) { return this.service.createWorkshop(user, body); }
  @Get("workshops/:workshopId") workshop(@CurrentUser() user: AuthUser, @Param("workshopId") id: string) { return this.service.workshop(user, id); }
  @Patch("workshops/:workshopId") @ApiBody({ type: UpdateWorkshopDto }) updateWorkshop(@CurrentUser() user: AuthUser, @Param("workshopId") id: string, @Body() body: UpdateWorkshopDto) { return this.service.updateWorkshop(user, id, body); }
  @Put("workshops/:workshopId/teachers") @ApiBody({ type: SetWorkshopTeacherDto }) setTeacher(@CurrentUser() user: AuthUser, @Param("workshopId") id: string, @Body() body: SetWorkshopTeacherDto) { return this.service.setWorkshopTeacher(user, id, body); }
  @Delete("workshops/:workshopId/teachers/:teacherId") removeTeacher(@CurrentUser() user: AuthUser, @Param("workshopId") id: string, @Param("teacherId") teacherId: string) { return this.service.removeWorkshopTeacher(user, id, teacherId); }
  @Post("workshops/:workshopId/archive") archive(@CurrentUser() user: AuthUser, @Param("workshopId") id: string) { return this.service.archiveWorkshop(user, id); }
  @Post("workshops/:workshopId/sessions") @ApiBody({ type: CreateSessionDto }) sessions(@CurrentUser() user: AuthUser, @Param("workshopId") workshopId: string, @Body() body: CreateSessionDto) { return this.service.createSession(user, workshopId, body); }
  @Post("sessions/:sessionId/start") start(@CurrentUser() user: AuthUser, @Param("sessionId") id: string) { return this.service.startSession(user, id); }
  @Post("sessions/:sessionId/end") end(@CurrentUser() user: AuthUser, @Param("sessionId") id: string) { return this.service.endSession(user, id); }
  @Get("sessions/:sessionId/missions") missionControl(@CurrentUser() user: AuthUser, @Param("sessionId") id: string) { return this.service.missionControl(user, id); }
  @Post("sessions/:sessionId/missions/:missionTemplateId/unlock") unlock(@CurrentUser() user: AuthUser, @Param("sessionId") sessionId: string, @Param("missionTemplateId") missionId: string) { return this.service.unlock(user, sessionId, missionId); }
  @Get("sessions/:sessionId/monitor") monitor(@CurrentUser() user: AuthUser, @Param("sessionId") id: string) { return this.service.monitor(user, id); }
  @Get("workshops/:workshopId/students") students(@CurrentUser() user: AuthUser, @Param("workshopId") id: string) { return this.service.students(user, id); }
  @Get("question-results/:questionResultId") result(@CurrentUser() user: AuthUser, @Param("questionResultId") id: string) { return this.service.questionResult(user, id); }
  @Post("score-adjustments") @ApiBody({ type: ScoreAdjustmentDto }) adjust(@CurrentUser() user: AuthUser, @Body() body: ScoreAdjustmentDto) { return this.service.adjust(user, body); }
  @Post("workshops/:workshopId/exports") export(@CurrentUser() user: AuthUser, @Param("workshopId") id: string) { return this.service.exportCsv(user, id); }
  @Get("exports/:exportId") download(@CurrentUser() user: AuthUser, @Param("exportId") id: string) { return this.service.downloadExport(user, id); }
  @Get("question-bank") questionBank(@CurrentUser() user: AuthUser) { return this.service.questionBank(user); }
}
