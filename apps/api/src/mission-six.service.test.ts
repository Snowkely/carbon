import { HttpException } from "@nestjs/common";
import { AccountType, AttemptStatus, SessionStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { StudentService } from "./student/student";

const student = { userId: "student-1", username: "student.alex", accountType: AccountType.STUDENT };
const responseCode = (error: unknown) => ((error as HttpException).getResponse() as { error: { code: string } }).error.code;
const ownedM6 = { id: "ma6", attemptId: "course-1", missionTemplateId: "m6", status: AttemptStatus.IN_PROGRESS, runtimeState: {}, attempt: { participant: { id: "p1", studentId: student.userId, session: { status: SessionStatus.ACTIVE } } }, mission: { stableId: "M6", contentVersionId: "package-c" }, currentScreen: { id: "m6s3" } };
const config = { id: "cfg6", checksum: "6".repeat(64), componentDefinitions: [], retryPolicy: {}, assistancePolicy: { type: "NONE" }, revealPolicy: {}, completionPolicy: { allQuestionsFinalized: true, nonNumericRequiredEvidence: ["M6-Q04"] } };

describe("Mission 6 service integration", () => {
  it("reuses the one in-progress course Attempt so six Mission scores can form one final result", async () => {
    const createAttempt = vi.fn(); const createMissionAttempt = vi.fn().mockResolvedValue({ id: "ma6", attemptId: "course-1" });
    const prisma: any = { missionTemplate: { findUnique: vi.fn().mockResolvedValue({ id: "m6", stableId: "M6", displayConfig: { gameplayImplemented: true } }) }, missionScreenTemplate: { findFirstOrThrow: vi.fn().mockResolvedValue({ id: "m6s1" }) }, $transaction: vi.fn(async (callback: any) => callback({ attempt: { findFirst: vi.fn().mockResolvedValue({ id: "course-1" }), count: vi.fn(), create: createAttempt }, missionAttempt: { create: createMissionAttempt } })) };
    const service: any = new StudentService(prisma, {} as any);
    vi.spyOn(service, "ownedParticipant").mockResolvedValue({ id: "p1" });
    vi.spyOn(service, "missions").mockResolvedValue([{ missionTemplateId: "m6", capabilities: { canStartAttempt: true } }]);
    await expect(service.startAttempt(student, "s1", "m6")).resolves.toMatchObject({ attemptId: "course-1" });
    expect(createAttempt).not.toHaveBeenCalled();
    expect(createMissionAttempt).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ attemptId: "course-1", missionTemplateId: "m6" }) }));
  });

  it("keeps an unlocked M6 blocked until M5 is complete, then resumes its existing attempt", async () => {
    const missions = [1, 2, 3, 4, 5, 6].map((n) => ({ id: `m${n}`, stableId: `M${n}`, sequenceNo: n, titleCn: `M${n}`, titleEn: `M${n}`, displayConfig: { gameplayImplemented: true } }));
    const attempts: Array<{ id: string; missionTemplateId: string; status: AttemptStatus }> = [1, 2, 3, 4].map((n) => ({ id: `ma${n}`, missionTemplateId: `m${n}`, status: AttemptStatus.COMPLETED }));
    const prisma: any = { workshopParticipant: { findUnique: vi.fn().mockResolvedValue({ id: "p1", session: { status: SessionStatus.ACTIVE, workshop: { contentVersionId: "package-c" } } }) }, missionTemplate: { findMany: vi.fn().mockResolvedValue(missions) }, missionUnlock: { findMany: vi.fn().mockResolvedValue(missions.map((mission) => ({ missionTemplateId: mission.id, unlockSource: mission.stableId === "M1" ? "INITIAL" : "TEACHER" }))) }, missionAttempt: { findMany: vi.fn(async () => attempts) } };
    const service = new StudentService(prisma, {} as any);
    expect((await service.missions(student, "s1"))[5]).toMatchObject({ accessState: "BLOCKED_PREREQUISITE", capabilities: { canStartAttempt: false } });
    attempts.push({ id: "ma5", missionTemplateId: "m5", status: AttemptStatus.COMPLETED });
    expect((await service.missions(student, "s1"))[5]).toMatchObject({ accessState: "AVAILABLE", capabilities: { canStartAttempt: true } });
    attempts.push({ id: "ma6", missionTemplateId: "m6", status: AttemptStatus.IN_PROGRESS });
    expect((await service.missions(student, "s1"))[5]).toMatchObject({ accessState: "ACTIVE_ATTEMPT", activeMissionAttemptId: "ma6", capabilities: { canContinueAttempt: true } });
  });

  it("requires Q04 along with all other round evidence", async () => {
    const prisma: any = { missionAttempt: { findFirst: vi.fn().mockResolvedValue(ownedM6) }, questionTemplate: { count: vi.fn().mockResolvedValue(11) }, questionResult: { count: vi.fn().mockResolvedValue(10) } };
    await expect(new StudentService(prisma, {} as any).complete(student, "ma6")).rejects.toSatisfy((error: unknown) => responseCode(error) === "MISSION_NOT_COMPLETABLE");
  });

  it("completes M6, calculates the final result, closes the course Attempt, and creates no unlock", async () => {
    const missionUpdate = vi.fn().mockResolvedValue({}); const attemptUpdate = vi.fn().mockResolvedValue({}); const unlock = vi.fn();
    const finalResult = { calculatedScore: 100, effectiveScore: 100, level: "Carbon Market Navigator", topStrength: "M1", conceptToReview: "M1", missionScores: { M1: 100, M2: 100, M3: 100, M4: 100, M5: 100, M6: 100 }, weights: { M1: .15, M2: .15, M3: .15, M4: .15, M5: .2, M6: .2 }, m6RoundBreakdown: { round1: 50, round2: 25, round3: 25, total: 100 } };
    const prisma: any = { missionAttempt: { findFirst: vi.fn().mockResolvedValue(ownedM6), update: missionUpdate }, questionTemplate: { count: vi.fn().mockResolvedValue(11) }, questionResult: { count: vi.fn().mockResolvedValue(11) }, missionScoringConfig: { findUniqueOrThrow: vi.fn().mockResolvedValue(config) }, attempt: { update: attemptUpdate }, workshopParticipant: { update: vi.fn() }, missionUnlock: { create: unlock }, $transaction: vi.fn(async (values: any[]) => Promise.all(values)) };
    const scoring: any = { calculateMissionSixBreakdown: vi.fn().mockResolvedValue(finalResult.m6RoundBreakdown), calculateFinalResult: vi.fn().mockResolvedValue(finalResult) };
    const result = await new StudentService(prisma, scoring).complete(student, "ma6");
    expect(result).toMatchObject({ status: "COMPLETED", systemScore: 100, roundBreakdown: { round1: 50, round2: 25, round3: 25, total: 100 }, finalResult: { calculatedScore: 100 }, nextMission: { state: "NONE" } });
    expect(attemptUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: AttemptStatus.COMPLETED, systemTotalScore: 100 }) }));
    expect(unlock).not.toHaveBeenCalled();
  });
});
