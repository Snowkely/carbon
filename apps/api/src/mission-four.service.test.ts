import { HttpException } from "@nestjs/common";
import { AccountType, AttemptStatus, SessionStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { StudentService } from "./student/student";

const student = { userId: "student-1", username: "student.alex", accountType: AccountType.STUDENT };
const responseCode = (error: unknown) => ((error as HttpException).getResponse() as { error: { code: string } }).error.code;
const ownedM4 = { id: "ma4", attemptId: "a4", missionTemplateId: "m4", status: AttemptStatus.IN_PROGRESS, runtimeState: {}, attempt: { participant: { id: "p1", studentId: student.userId, session: { status: SessionStatus.ACTIVE } } }, mission: { stableId: "M4", contentVersionId: "v5.2" }, currentScreen: { id: "m4s1" } };
const policy = { id: "cfg4", checksum: "d".repeat(64), retryPolicy: { maxIndependentAttempts: 3, factors: [1, .9, .8] }, assistancePolicy: { type: "NONE" }, revealPolicy: { afterFailures: 3, factor: .5 } };

function submissionPrisma(question: any) {
  const create = vi.fn().mockResolvedValue({ id: "qa-m4" });
  const upsert = vi.fn().mockResolvedValue({});
  const tx: any = { questionAttempt: { create }, questionResult: { upsert }, workshopParticipant: { update: vi.fn().mockResolvedValue({}) } };
  const prisma: any = {
    missionAttempt: { findFirst: vi.fn().mockResolvedValue(ownedM4) },
    questionAttempt: { findUnique: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0) },
    questionTemplate: { findUnique: vi.fn().mockResolvedValue(question) },
    questionResult: { findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    missionScoringConfig: { findUniqueOrThrow: vi.fn().mockResolvedValue(policy) },
    missionScreenTemplate: { findFirst: vi.fn().mockResolvedValue({ inputConfig: { cap: 300000, companies: [{ id: "GreenTex", allocation: 100000, verifiedEmissions: 80000 }, { id: "SteelCo", allocation: 100000, verifiedEmissions: 130000 }, { id: "PowerCo", allocation: 100000, verifiedEmissions: 90000 }] } }) },
    $transaction: vi.fn(async (callback: any) => callback(tx))
  };
  return { prisma, create, upsert };
}

describe("Mission 4 service evidence and completion", () => {
  it("returns an unlocked in-progress M4 as resumable only after M3 completion", async () => {
    const missions = [1, 2, 3, 4].map((number) => ({ id: `m${number}`, stableId: `M${number}`, sequenceNo: number, titleCn: `M${number}`, titleEn: `M${number}`, displayConfig: { gameplayImplemented: true } }));
    const prisma: any = {
      workshopParticipant: { findUnique: vi.fn().mockResolvedValue({ id: "p1", studentId: student.userId, session: { id: "s1", status: SessionStatus.ACTIVE, workshop: { contentVersionId: "v5.2" } } }) },
      missionTemplate: { findMany: vi.fn().mockResolvedValue(missions) },
      missionUnlock: { findMany: vi.fn().mockResolvedValue(missions.map((mission) => ({ missionTemplateId: mission.id, unlockSource: mission.stableId === "M1" ? "INITIAL" : "TEACHER" }))) },
      missionAttempt: { findMany: vi.fn().mockResolvedValue([{ id: "ma1", missionTemplateId: "m1", status: AttemptStatus.COMPLETED }, { id: "ma2", missionTemplateId: "m2", status: AttemptStatus.COMPLETED }, { id: "ma3", missionTemplateId: "m3", status: AttemptStatus.COMPLETED }, { id: "ma4", missionTemplateId: "m4", status: AttemptStatus.IN_PROGRESS }]) }
    };
    const result = await new StudentService(prisma, {} as any).missions(student, "s1");
    expect(result[3]).toMatchObject({ missionStableId: "M4", accessState: "ACTIVE_ATTEMPT", activeMissionAttemptId: "ma4", capabilities: { canStartAttempt: false, canContinueAttempt: true, canSubmitAnswer: true } });
  });

  it("creates immutable process evidence only when Submit Order reaches the server", async () => {
    const order = ["Set Cap", "Allocate / Auction", "Emit", "MRV", "Trade", "Surrender", "Compliance / Penalty"];
    const { prisma, create, upsert } = submissionPrisma({ id: "q-order", stableId: "M4-Q01", missionTemplateId: "m4", contentVersionId: "v5.2", questionType: "ORDER", answerMode: "MULTI_EXACT", baseScore: 21, promptCn: "Order", promptEn: "Order", options: order, answerRule: { mode: "MULTI_EXACT", answer: order }, feedbackConfig: { correct: "Correct", wrong: "Try again", explanation: "Exact order" } });
    expect(create).not.toHaveBeenCalled();
    const result = await new StudentService(prisma, {} as any).submit(student, "ma4", "q-order", { clientSubmissionId: "a05c4b12-1e83-4b9f-9c9e-9195e579fc68", answer: order, timeSpentMs: 1000 });
    expect(result).toMatchObject({ correct: true, finalized: true, score: 21 });
    expect(create).toHaveBeenCalledOnce();
    expect(upsert.mock.calls[0]![0].create).toMatchObject({ v5BaseScore: 21, systemScore: 21 });
  });

  it("rejects an oversell before creating QuestionAttempt evidence", async () => {
    const answer = { seller: "GreenTex", buyer: "SteelCo", quantity: 20000 };
    const { prisma, create } = submissionPrisma({ id: "q-trade", stableId: "M4-Q05", missionTemplateId: "m4", contentVersionId: "v5.2", questionType: "DECISION", answerMode: "EXACT", baseScore: 5, promptCn: "Trade", promptEn: "Trade", options: [], answerRule: { mode: "EXACT", answer }, feedbackConfig: {} });
    await expect(new StudentService(prisma, {} as any).submit(student, "ma4", "q-trade", { clientSubmissionId: "a05c4b12-1e83-4b9f-9c9e-9195e579fc68", answer: { ...answer, quantity: 20001 }, timeSpentMs: 1000 })).rejects.toSatisfy((error: unknown) => responseCode(error) === "INVALID_ETS_TRADE");
    expect(create).not.toHaveBeenCalled();
  });

  it("completes all nine M4 activities without creating an M5 unlock", async () => {
    const update = vi.fn().mockResolvedValue({}); const unlock = vi.fn();
    const prisma: any = { missionAttempt: { findFirst: vi.fn().mockResolvedValue(ownedM4), update }, questionTemplate: { count: vi.fn().mockResolvedValue(9) }, questionResult: { count: vi.fn().mockResolvedValue(9) }, missionScoringConfig: { findUniqueOrThrow: vi.fn().mockResolvedValue({ ...policy, componentDefinitions: [], completionPolicy: { minimumScore: null, allQuestionsFinalized: true } }) }, attempt: { update }, workshopParticipant: { update }, missionUnlock: { create: unlock }, $transaction: vi.fn(async (values: any[]) => Promise.all(values)) };
    const result = await new StudentService(prisma, { calculateMission: vi.fn().mockResolvedValue(100) } as any).complete(student, "ma4");
    expect(result).toEqual({ status: "COMPLETED", systemScore: 100, nextMission: { state: "LOCKED", reason: "WAITING_FOR_TEACHER" } });
    expect(unlock).not.toHaveBeenCalled();
  });
});
