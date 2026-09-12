import { HttpException } from "@nestjs/common";
import { AccountType, AnswerMode, AttemptStatus, QuestionResultStatus, ResolutionMode, SessionStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { StudentService } from "./student/student";
import { ScoringService } from "./student/scoring.service";

const student = { userId: "student-1", username: "student.alex", accountType: AccountType.STUDENT };
const scenario = { label: "Training simulation", verifiedEmissions: 110000, allowances: 100000, marketPrice: 64.8, bankingEnabled: false, projects: [
  { id: "M5-P01", name: "Boiler efficiency controls", capacity: 4000, marginalAbatementCost: 32 },
  { id: "M5-P02", name: "Waste heat recovery", capacity: 6000, marginalAbatementCost: 46 },
  { id: "M5-P03", name: "Fuel switching", capacity: 8000, marginalAbatementCost: 68 }
] };
const ownedM5 = { id: "ma5", attemptId: "a5", missionTemplateId: "m5", status: AttemptStatus.IN_PROGRESS, runtimeState: {}, attempt: { participant: { id: "p1", studentId: student.userId, session: { status: SessionStatus.ACTIVE } } }, mission: { stableId: "M5", contentVersionId: "v5.3" }, currentScreen: { id: "m5s3", stableId: "M5-S03" } };
const selectedProjectsResult = { status: QuestionResultStatus.FINALIZED, selectedAttempt: { studentAnswer: ["M5-P01", "M5-P02"], evaluatedResult: { correct: true }, resolutionMode: ResolutionMode.INDEPENDENT } };
const responseCode = (error: unknown) => ((error as HttpException).getResponse() as { error: { code: string } }).error.code;

describe("Mission 5 service authority and immutable evidence", () => {
  it("reviews a projected strategy without creating a QuestionAttempt", async () => {
    const create = vi.fn();
    const prisma: any = {
      missionAttempt: { findFirst: vi.fn().mockResolvedValue(ownedM5) },
      missionScreenTemplate: { findFirst: vi.fn().mockResolvedValue({ inputConfig: scenario }) },
      questionResult: { findFirst: vi.fn().mockResolvedValue(selectedProjectsResult) },
      questionAttempt: { create }
    };
    const result = await new StudentService(prisma, {} as any).previewMissionFive(student, "ma5", { answer: { action: "Reduce", quantity: 10000 } });
    expect(result.projection).toMatchObject({ complianceGap: 0, status: "Compliant", projectedCost: 404000 });
    const purchase = await new StudentService(prisma, {} as any).previewMissionFive(student, "ma5", { answer: { action: "Buy", quantity: 10000 } });
    expect(purchase.projection).toMatchObject({ complianceGap: 0, status: "Compliant", projectedCost: 648000 });
    expect(create).not.toHaveBeenCalled();
  });

  it("server-rejects selling while short before any evidence is written", async () => {
    const create = vi.fn();
    const prisma: any = { missionAttempt: { findFirst: vi.fn().mockResolvedValue(ownedM5) }, missionScreenTemplate: { findFirst: vi.fn().mockResolvedValue({ inputConfig: scenario }) }, questionResult: { findFirst: vi.fn().mockResolvedValue(selectedProjectsResult) }, questionAttempt: { create } };
    await expect(new StudentService(prisma, {} as any).previewMissionFive(student, "ma5", { answer: { action: "Sell", quantity: 1 } })).rejects.toSatisfy((error: unknown) => responseCode(error) === "INVALID_M5_DECISION");
    expect(create).not.toHaveBeenCalled();
  });

  it("creates one immutable strategy attempt only through Submit Decision", async () => {
    const create = vi.fn().mockResolvedValue({ id: "qa-m5" }); const upsert = vi.fn().mockResolvedValue({});
    const tx: any = { questionAttempt: { create }, questionResult: { upsert }, workshopParticipant: { update: vi.fn().mockResolvedValue({}) } };
    const prisma: any = {
      missionAttempt: { findFirst: vi.fn().mockResolvedValue(ownedM5) },
      missionScreenTemplate: { findFirst: vi.fn().mockResolvedValue({ inputConfig: scenario }) },
      questionAttempt: { findUnique: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0) },
      questionResult: { findUnique: vi.fn().mockResolvedValue(null), findFirst: vi.fn().mockResolvedValue(selectedProjectsResult) },
      questionTemplate: { findUnique: vi.fn().mockResolvedValue({ id: "q3", stableId: "M5-Q03", missionTemplateId: "m5", contentVersionId: "v5.3", questionType: "DECISION", answerMode: AnswerMode.STRATEGY, baseScore: 20, promptCn: "Decision", promptEn: "Decision", options: ["Reduce", "Buy", "Sell", "Hold"], answerRule: { mode: "STRATEGY", rubricRef: "M5_ACTION_DECISION", rubric: { evidencePoints: 20 } }, feedbackConfig: { correct: "Recorded", wrong: "Invalid", explanation: "Rubric" } }) },
      missionScoringConfig: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "cfg5", checksum: "e".repeat(64), retryPolicy: { maxIndependentAttempts: 3, strategyIndependentAttempts: 1, factors: [1, .9, .8] }, assistancePolicy: {}, revealPolicy: { afterFailures: 3, factor: .5 } }) },
      $transaction: vi.fn(async (callback: any) => callback(tx))
    };
    expect(create).not.toHaveBeenCalled();
    const result = await new StudentService(prisma, {} as any).submit(student, "ma5", "q3", { clientSubmissionId: "a05c4b12-1e83-4b9f-9c9e-9195e579fc68", answer: { action: "Reduce", quantity: "10000" }, timeSpentMs: 1000 });
    expect(result).toMatchObject({ finalized: true, score: 20 });
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]![0].data).toMatchObject({ studentAnswer: { action: "Reduce", quantity: 10000 }, resolutionMode: ResolutionMode.STRATEGY, candidateSystemScore: 20 });
  });

  it.each([
    ["MAC is below the allowance market price; our shortage position is resolved because reducing emissions closes the compliance gap.", 10, "a15c4b12-1e83-4b9f-9c9e-9195e579fc68"],
    ["Our shortage position requires buying allowances to reach compliance.", 5, "a25c4b12-1e83-4b9f-9c9e-9195e579fc68"],
    ["1", 0, "a35c4b12-1e83-4b9f-9c9e-9195e579fc68"]
  ])("finalizes deterministic M5 reasoning evidence at the configured rubric score", async (answer, expectedScore, clientSubmissionId) => {
    const create = vi.fn().mockResolvedValue({ id: `qa-${expectedScore}` }); const upsert = vi.fn().mockResolvedValue({});
    const tx: any = { questionAttempt: { create }, questionResult: { upsert }, workshopParticipant: { update: vi.fn().mockResolvedValue({}) } };
    const prisma: any = {
      missionAttempt: { findFirst: vi.fn().mockResolvedValue({ ...ownedM5, currentScreen: { id: "m5s4", stableId: "M5-S04" } }) },
      questionAttempt: { findUnique: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0) }, questionResult: { findUnique: vi.fn().mockResolvedValue(null) },
      questionTemplate: { findUnique: vi.fn().mockResolvedValue({ id: "q4", stableId: "M5-Q04", missionTemplateId: "m5", contentVersionId: "v5.3", questionType: "REFLECTION", answerMode: AnswerMode.STRATEGY, baseScore: 10, promptCn: "Reasoning", promptEn: "Reasoning", options: null, answerRule: { mode: "STRATEGY", rubricRef: "M5_REASONING_RUBRIC", rubric: { allThree: 10, anyTwo: 5, oneOrNone: 0 } }, feedbackConfig: { correct: "Decision recorded.", wrong: "Add concepts.", explanation: "Deterministic rubric." } }) },
      missionScoringConfig: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "cfg5", checksum: "e".repeat(64), retryPolicy: { strategyIndependentAttempts: 1, factors: [1,.9,.8] }, assistancePolicy: {}, revealPolicy: { afterFailures: 3, factor: .5 } }) },
      $transaction: vi.fn(async (callback: any) => callback(tx))
    };
    const result = await new StudentService(prisma, {} as any).submit(student, "ma5", "q4", { clientSubmissionId, answer, timeSpentMs: 1000 });
    expect(result).toMatchObject({ finalized: true, score: expectedScore });
    expect(create.mock.calls[0]![0].data).toMatchObject({ studentAnswer: answer, resolutionMode: ResolutionMode.STRATEGY, candidateSystemScore: expectedScore });
  });

  it("resumes committed projects, action, reasoning, projection and rubric without exposing answer rules", async () => {
    const selected = (studentAnswer: unknown, resolutionMode: ResolutionMode = ResolutionMode.STRATEGY) => ({ status: QuestionResultStatus.FINALIZED, systemScore: 10, resolutionMode, selectedAttempt: { studentAnswer, evaluatedResult: { correct: true }, resolutionMode } });
    const screens = [1, 2, 3, 4].map((sequenceNo) => ({ id: `s${sequenceNo}`, stableId: `M5-S0${sequenceNo}`, sequenceNo, displayConfig: { titleEn: `Screen ${sequenceNo}`, isSimulation: true }, inputConfig: sequenceNo === 1 ? scenario : {} }));
    const questions = [
      { id: "q1", stableId: "M5-Q01", questionType: "NUM", answerMode: "NUMERIC", results: [selected(10000, ResolutionMode.INDEPENDENT)] },
      { id: "q2", stableId: "M5-Q02", questionType: "MC", answerMode: "MULTI_EXACT", results: [selected(["M5-P01", "M5-P02"], ResolutionMode.INDEPENDENT)] },
      { id: "q3", stableId: "M5-Q03", questionType: "DECISION", answerMode: "STRATEGY", results: [selected({ action: "Reduce", quantity: 10000 })] },
      { id: "q4", stableId: "M5-Q04", questionType: "REFLECTION", answerMode: "STRATEGY", results: [selected("MAC below price; shortage position; reduction closes the compliance gap.")] }
    ].map((question, index) => ({ ...question, screenTemplateId: screens[index]!.id, promptCn: "Prompt", promptEn: "Prompt", options: null, baseScore: 10, isSimulation: true, attempts: [{ questionAttemptNo: 1 }] }));
    const prisma: any = {
      missionAttempt: { findFirst: vi.fn().mockResolvedValue({ ...ownedM5, currentScreen: screens[3] }) },
      missionScreenTemplate: { findMany: vi.fn().mockResolvedValue(screens) }, questionTemplate: { findMany: vi.fn().mockResolvedValue(questions) },
      missionScoringConfig: { findUniqueOrThrow: vi.fn().mockResolvedValue({ revealPolicy: { afterFailures: 3 } }) }
    };
    const rubric = { total: 100, compliance: 40, costLogic: 30, position: 20, reasoning: 10 };
    const result = await new StudentService(prisma, { calculateMissionFiveBreakdown: vi.fn().mockResolvedValue(rubric) } as any).attempt(student, "ma5");
    expect(result.m5).toMatchObject({ selectedProjectIds: ["M5-P01", "M5-P02"], committedDecision: { action: "Reduce", quantity: 10000 }, reasoning: expect.stringContaining("shortage"), projection: { status: "Compliant", complianceGap: 0 }, rubricBreakdown: rubric });
    expect(JSON.stringify(result)).not.toContain("answerRule");
  });

  it("completes resolved M5 at any rubric score and never creates an M6 unlock", async () => {
    const update = vi.fn().mockResolvedValue({}); const unlock = vi.fn();
    const breakdown = { total: 30, compliance: 0, costLogic: 10, position: 20, reasoning: 0 };
    const prisma: any = { missionAttempt: { findFirst: vi.fn().mockResolvedValue(ownedM5), update }, questionTemplate: { count: vi.fn().mockResolvedValue(4) }, questionResult: { count: vi.fn().mockResolvedValue(4) }, missionScoringConfig: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "cfg5", checksum: "e".repeat(64), componentDefinitions: [], retryPolicy: {}, assistancePolicy: {}, revealPolicy: {}, completionPolicy: { minimumScore: null } }) }, attempt: { update }, workshopParticipant: { update }, missionUnlock: { create: unlock }, $transaction: vi.fn(async (values: any[]) => Promise.all(values)) };
    const scoreBreakdown = { missionStableId: "M5", components: [{ stableId: "COMPLIANCE", earned: 0, maximum: 40, status: "ACTIVE" }, { stableId: "COST_LOGIC", earned: 10, maximum: 30, status: "ACTIVE" }, { stableId: "POSITION", earned: 20, maximum: 20, status: "ACTIVE" }, { stableId: "REASONING", earned: 0, maximum: 10, status: "ACTIVE" }], rawActiveTotal: 30, rawActiveMaximum: 100, normalizedTotal: 30, normalizedMaximum: 100, normalizationApplied: false };
    const result = await new StudentService(prisma, { calculateMissionFiveBreakdown: vi.fn().mockResolvedValue(breakdown), calculateMissionBreakdown: vi.fn().mockResolvedValue(scoreBreakdown) } as any).complete(student, "ma5");
    expect(result).toMatchObject({ status: "COMPLETED", systemScore: 30, rubricBreakdown: breakdown, scoreBreakdown, nextMission: { state: "LOCKED", reason: "WAITING_FOR_TEACHER" } });
    expect(unlock).not.toHaveBeenCalled();
  });
});

describe("Mission 5 override precedence", () => {
  const results = [
    { question: { stableId: "M5-Q02" }, selectedAttempt: { studentAnswer: ["M5-P01", "M5-P02"], evaluatedResult: {}, resolutionMode: "INDEPENDENT" }, adjustmentStream: { currentAdjustment: { adjustedScore: 0 } }, systemScore: 10 },
    { question: { stableId: "M5-Q03" }, selectedAttempt: { studentAnswer: { action: "Reduce", quantity: 10000 }, evaluatedResult: {}, resolutionMode: "STRATEGY" }, adjustmentStream: { currentAdjustment: { adjustedScore: 0 } }, systemScore: 20 },
    { question: { stableId: "M5-Q04" }, selectedAttempt: { studentAnswer: "MAC is lower than market price; our shortage position is resolved because reduction closes the compliance gap.", evaluatedResult: {}, resolutionMode: "STRATEGY" }, adjustmentStream: { currentAdjustment: { adjustedScore: 0 } }, systemScore: 10 }
  ];
  it("does not let Question Overrides rewrite the strategy rubric, while Mission Override still wins", async () => {
    const missionAttempt = { id: "ma5", missionTemplateId: "m5", mission: { stableId: "M5", contentVersionId: "v5.3" }, adjustmentStream: null, questionResults: results };
    const prisma: any = { missionAttempt: { findUniqueOrThrow: vi.fn().mockResolvedValue(missionAttempt) }, missionScreenTemplate: { findFirstOrThrow: vi.fn().mockResolvedValue({ inputConfig: scenario }) } };
    expect(await new ScoringService(prisma).calculateMission("ma5", true, false)).toBe(100);
    prisma.missionAttempt.findUniqueOrThrow.mockResolvedValue({ ...missionAttempt, adjustmentStream: { currentAdjustment: { adjustedScore: 77 } } });
    expect(await new ScoringService(prisma).calculateMission("ma5", true, true)).toBe(77);
  });

  it("scores an existing Mobile string quantity and generates the 40/30/20/10 completion DTO", async () => {
    const existingResults = results.map((result) => result.question.stableId === "M5-Q03" ? { ...result, selectedAttempt: { ...result.selectedAttempt, studentAnswer: { action: "Reduce", quantity: "10000" } } } : result);
    const missionAttempt = { id: "ma5", missionTemplateId: "m5", mission: { stableId: "M5", contentVersionId: "v5.3" }, adjustmentStream: null, questionResults: existingResults };
    const definitions = [["COMPLIANCE",40],["COST_LOGIC",30],["POSITION",20],["REASONING",10]].map(([stableId,weightPoints]) => ({ stableId, weightPoints, normalization:"TABLE", contributions:[{sourceType:"STRATEGY_DIMENSION",sourceRef:stableId,rawMax:weightPoints}] }));
    const prisma: any = { missionAttempt: { findUniqueOrThrow: vi.fn().mockResolvedValue(missionAttempt) }, missionScreenTemplate: { findFirstOrThrow: vi.fn().mockResolvedValue({ inputConfig: scenario }) }, missionScoringConfig: { findUniqueOrThrow: vi.fn().mockResolvedValue({ componentDefinitions: definitions, completionPolicy: {} }) } };
    const scoring = new ScoringService(prisma);
    await expect(scoring.calculateMissionFiveBreakdown("ma5")).resolves.toMatchObject({ compliance:40,costLogic:30,position:20,reasoning:10,total:100 });
    await expect(scoring.calculateMissionBreakdown("ma5")).resolves.toMatchObject({ missionStableId:"M5",normalizedTotal:100,components:[{stableId:"COMPLIANCE",earned:40,maximum:40},{stableId:"COST_LOGIC",earned:30,maximum:30},{stableId:"POSITION",earned:20,maximum:20},{stableId:"REASONING",earned:10,maximum:10}] });
  });
});
