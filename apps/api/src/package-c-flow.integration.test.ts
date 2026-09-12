import { AccountType, AttemptStatus, ScoreTargetLevel, SessionStatus, WorkshopRole } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { StudentService } from "./student/student";
import { ScoringService } from "./student/scoring.service";
import { TeacherService } from "./teacher/teacher";

const teacher = { userId: "teacher-1", username: "teacher.demo", accountType: AccountType.TEACHER };
const student = { userId: "student-1", username: "student.alex", accountType: AccountType.STUDENT };

describe("Package C full manual course chain", () => {
  it("progresses M1 through M6 only through Teacher unlocks, calculates Final IQ, then appends a Final override", async () => {
    const missions = [1, 2, 3, 4, 5, 6].map((n) => ({ id: `m${n}`, stableId: `M${n}`, sequenceNo: n, titleCn: `M${n}`, titleEn: `Mission ${n}`, contentVersionId: "package-c", displayConfig: { gameplayImplemented: true } }));
    const unlocks: Array<{ missionTemplateId: string; unlockSource: "INITIAL" | "TEACHER" }> = [{ missionTemplateId: "m1", unlockSource: "INITIAL" }];
    const attempts: Array<{ id: string; missionTemplateId: string; status: AttemptStatus }> = [];
    const prisma: any = {
      workshopParticipant: { findUnique: vi.fn().mockResolvedValue({ id: "p1", session: { id: "s1", status: SessionStatus.ACTIVE, workshop: { contentVersionId: "package-c" } } }) },
      workshopSession: { findUnique: vi.fn().mockResolvedValue({ id: "s1", workshopId: "w1", status: SessionStatus.ACTIVE, workshop: { contentVersionId: "package-c" } }) },
      workshopTeacher: { findUnique: vi.fn().mockResolvedValue({ role: WorkshopRole.OWNER }) },
      missionTemplate: { findMany: vi.fn().mockResolvedValue(missions), findUnique: vi.fn(async ({ where }: any) => missions.find((mission) => mission.id === where.id)) },
      missionUnlock: { findMany: vi.fn(async () => unlocks), upsert: vi.fn(async ({ create }: any) => { const row = { missionTemplateId: create.missionTemplateId, unlockSource: "TEACHER" as const }; unlocks.push(row); return row; }) },
      missionAttempt: { findMany: vi.fn(async () => attempts) }
    };
    const studentService = new StudentService(prisma, {} as any);
    const teacherService = new TeacherService(prisma, {} as any);
    expect((await studentService.missions(student, "s1"))[0]).toMatchObject({ accessState: "AVAILABLE" });
    for (let number = 1; number <= 6; number += 1) {
      attempts.push({ id: `ma${number}`, missionTemplateId: `m${number}`, status: AttemptStatus.COMPLETED });
      if (number < 6) {
        expect((await studentService.missions(student, "s1"))[number]).toMatchObject({ accessState: "BLOCKED_SESSION_UNLOCK" });
        await teacherService.unlock(teacher, "s1", `m${number + 1}`);
        expect((await studentService.missions(student, "s1"))[number]).toMatchObject({ accessState: "AVAILABLE" });
      }
    }
    expect(unlocks.map((unlock) => unlock.missionTemplateId)).toEqual(["m1", "m2", "m3", "m4", "m5", "m6"]);

    const completedMissions = missions.map((mission) => ({ id: `ma-${mission.stableId}`, status: AttemptStatus.COMPLETED, mission }));
    const scoringPrisma: any = { attempt: { findUniqueOrThrow: vi.fn().mockResolvedValue({ systemTotalScore: 100, missionAttempts: completedMissions, adjustmentStream: null }) }, gameScoringConfig: { findUniqueOrThrow: vi.fn().mockResolvedValue({ missionWeights: { M1: .15, M2: .15, M3: .15, M4: .15, M5: .2, M6: .2 } }) } };
    const scoring = new ScoringService(scoringPrisma);
    vi.spyOn(scoring, "calculateMission").mockResolvedValue(100);
    vi.spyOn(scoring, "calculateMissionSixBreakdown").mockResolvedValue({ round1: 50, round2: 25, round3: 25, total: 100 });
    await expect(scoring.calculateFinalResult("course-1")).resolves.toMatchObject({ calculatedScore: 100, effectiveScore: 100 });

    const createdAdjustment = { id: "adjustment-final-1", adjustedScore: 96 };
    const adjustmentTx: any = { scoreAdjustmentStream: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "stream-final-1" }), update: vi.fn() }, scoreAdjustment: { create: vi.fn().mockResolvedValue(createdAdjustment) }, $queryRaw: vi.fn().mockResolvedValue([{ id: "stream-final-1", currentAdjustmentId: null }]) };
    const adjustmentPrisma: any = { attempt: { findUnique: vi.fn().mockResolvedValue({ id: "course-1", systemTotalScore: 100, participant: { session: { workshopId: "w1" } } }) }, workshopTeacher: { findUnique: vi.fn().mockResolvedValue({ role: WorkshopRole.OWNER }) }, $transaction: vi.fn(async (callback: any) => callback(adjustmentTx)) };
    const adjusted = await new TeacherService(adjustmentPrisma, { calculateFinalResult: vi.fn().mockResolvedValue({ calculatedScore: 100 }) } as any).adjust(teacher, { targetLevel: ScoreTargetLevel.FINAL_TOTAL, targetId: "course-1", adjustedScore: 96, reason: "Reviewed complete course evidence", expectedSupersedesAdjustmentId: null });
    expect(adjusted.adjustment).toEqual(createdAdjustment);
    expect(adjustmentTx.scoreAdjustment.create).toHaveBeenCalledWith({ data: expect.objectContaining({ originalSystemScore: 100, adjustedScore: 96, reason: "Reviewed complete course evidence", adjustedByTeacherId: teacher.userId }) });
  });
});
