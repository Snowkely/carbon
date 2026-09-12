import { AnswerMode, ContentStatus, Prisma, PrismaClient, QuestionType, SourceType } from "@prisma/client";
import { createHash } from "node:crypto";

const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const json = (value: unknown) => value as Prisma.InputJsonValue;
type Db = Prisma.TransactionClient;

const retry = { maxIndependentAttempts: 3, factors: [1, 0.9, 0.8], selection: "FIRST_CORRECT" };
const reveal = { afterFailures: 3, factor: 0.5 };

export const packageB1ProcessOrder = [
  "Set Cap", "Allocate / Auction", "Emit", "MRV", "Trade", "Surrender", "Compliance / Penalty"
] as const;
export const packageB1InitialProcessOrder = [
  "Emit", "Set Cap", "MRV", "Allocate / Auction", "Surrender", "Trade", "Compliance / Penalty"
] as const;

export const packageB1EtsSimulation = {
  cap: 300000,
  companies: [
    { id: "GreenTex", allocation: 100000, verifiedEmissions: 80000 },
    { id: "SteelCo", allocation: 100000, verifiedEmissions: 130000 },
    { id: "PowerCo", allocation: 100000, verifiedEmissions: 90000 }
  ]
} as const;

export const packageB1CanonicalTrades = [
  { seller: "GreenTex", buyer: "SteelCo", quantity: 20000 },
  { seller: "PowerCo", buyer: "SteelCo", quantity: 10000 }
] as const;

export const packageB1MissionScoringComponents = [
  { stableId: "PROCESS", weightPoints: 35, normalization: "PROPORTIONAL", contributions: [{ sourceType: "QUESTION_RESULT", sourceRef: "M4-Q01", rawMax: 21 }] },
  { stableId: "POSITION_CALCULATION", weightPoints: 25, normalization: "PROPORTIONAL", contributions: [2, 3, 4].map((number) => ({ sourceType: "QUESTION_RESULT", sourceRef: `M4-Q0${number}`, rawMax: 5 })) },
  { stableId: "TRADE", weightPoints: 25, normalization: "PROPORTIONAL", contributions: [5, 6].map((number) => ({ sourceType: "QUESTION_RESULT", sourceRef: `M4-Q0${number}`, rawMax: 5 })) },
  { stableId: "COMPLIANCE_REASONING", weightPoints: 15, normalization: "PROPORTIONAL", contributions: [7, 8, 9].map((number) => ({ sourceType: "QUESTION_RESULT", sourceRef: `M4-Q0${number}`, rawMax: 5 })) }
] as const;

export const packageB1MissionFourScreens = [
  { stableId: "M4-S01", titleCn: "流程拼图", titleEn: "Process Puzzle", body: "Build the ETS lifecycle in its exact seven-step order.", isSimulation: false },
  { stableId: "M4-S02", titleCn: "分配与拍卖", titleEn: "Allocation", body: "Set a total cap of 300,000 and allocate 100,000 allowances to each company.", isSimulation: true },
  { stableId: "M4-S03", titleCn: "排放与核查", titleEn: "Emissions / MRV", body: "Record verified emissions: GreenTex 80,000; SteelCo 130,000; PowerCo 90,000.", isSimulation: true },
  { stableId: "M4-S04", titleCn: "持仓", titleEn: "Position", body: "Calculate each signed position as Allowances - Verified Emissions.", isSimulation: true },
  { stableId: "M4-S05", titleCn: "交易", titleEn: "Trade", body: "Move available surplus to SteelCo. Each trade is committed only by Submit Trade.", isSimulation: true },
  { stableId: "M4-S06", titleCn: "上缴与合规", titleEn: "Surrender / Compliance", body: "Surrender allowances, calculate the final gap, and determine compliance status.", isSimulation: true }
] as const;

type QuestionDefinition = { stableId: string; screen: string; type: QuestionType; mode?: AnswerMode; prompt: string; answerRule: unknown; baseScore: number; options?: unknown; hint: string; wrong: string; explanation: string; isSimulation?: boolean };

export function packageB1MissionFourQuestions(): QuestionDefinition[] {
  return [
    {
      stableId: "M4-Q01", screen: "M4-S01", type: QuestionType.ORDER, mode: AnswerMode.MULTI_EXACT,
      prompt: "Put the seven ETS steps in their exact operating order.", options: packageB1InitialProcessOrder,
      answerRule: { mode: "MULTI_EXACT", answer: packageB1ProcessOrder }, baseScore: 21,
      hint: "A cap and allocation come before emissions; verified emissions come before trading and surrender.",
      wrong: "The ETS process order is not yet exact.", explanation: packageB1ProcessOrder.join(" → ")
    },
    ...packageB1EtsSimulation.companies.map<QuestionDefinition>((company, index) => ({
      stableId: `M4-Q0${index + 2}`, screen: "M4-S04", type: QuestionType.NUM,
      prompt: `Training simulation: calculate ${company.id}'s position (Allowances - Verified Emissions). Include the sign.`,
      answerRule: { mode: "NUMERIC", answer: company.allocation - company.verifiedEmissions, tolerance: 0 }, baseScore: 5,
      hint: "Position = Allowances - Verified Emissions. Keep the positive or negative sign.",
      wrong: "Recheck the subtraction and its sign.",
      explanation: `${company.id}: ${company.allocation.toLocaleString("en-US")} - ${company.verifiedEmissions.toLocaleString("en-US")} = ${(company.allocation - company.verifiedEmissions).toLocaleString("en-US", { signDisplay: "always" })}.`,
      isSimulation: true
    })),
    {
      stableId: "M4-Q05", screen: "M4-S05", type: QuestionType.DECISION,
      prompt: "Training simulation: commit the first trade using seller, buyer and quantity.",
      options: [
        { label: "GreenTex → SteelCo · 20,000", value: packageB1CanonicalTrades[0] },
        { label: "GreenTex → SteelCo · 30,000", value: { seller: "GreenTex", buyer: "SteelCo", quantity: 30000 } },
        { label: "PowerCo → SteelCo · 10,000", value: packageB1CanonicalTrades[1] }
      ], answerRule: { mode: "EXACT", answer: packageB1CanonicalTrades[0] }, baseScore: 5,
      hint: "GreenTex has a 20,000 surplus and SteelCo has a shortage.", wrong: "Choose a seller with enough surplus and transfer the correct quantity to SteelCo.",
      explanation: "GreenTex sells its 20,000 surplus to SteelCo.", isSimulation: true
    },
    {
      stableId: "M4-Q06", screen: "M4-S05", type: QuestionType.DECISION,
      prompt: "Training simulation: after the first committed trade, commit the trade that closes SteelCo's remaining shortage.",
      options: [
        { label: "PowerCo → SteelCo · 10,000", value: packageB1CanonicalTrades[1] },
        { label: "PowerCo → SteelCo · 20,000", value: { seller: "PowerCo", buyer: "SteelCo", quantity: 20000 } },
        { label: "PowerCo → GreenTex · 10,000", value: { seller: "PowerCo", buyer: "GreenTex", quantity: 10000 } }
      ], answerRule: { mode: "EXACT", answer: packageB1CanonicalTrades[1] }, baseScore: 5,
      hint: "After receiving 20,000, SteelCo's shortage is 10,000. PowerCo has exactly 10,000 surplus.", wrong: "Use the updated shortage and current seller surplus.",
      explanation: "PowerCo sells 10,000 to SteelCo, closing the remaining shortage.", isSimulation: true
    },
    {
      stableId: "M4-Q07", screen: "M4-S06", type: QuestionType.NUM,
      prompt: "Training simulation: what are SteelCo's final allowances after both trades?", answerRule: { mode: "NUMERIC", answer: 130000, tolerance: 0 }, baseScore: 5,
      hint: "Add both purchases to SteelCo's initial 100,000 allowances.", wrong: "Use 100,000 + 20,000 + 10,000.", explanation: "SteelCo's final allowances are 130,000.", isSimulation: true
    },
    {
      stableId: "M4-Q08", screen: "M4-S06", type: QuestionType.NUM,
      prompt: "Training simulation: calculate SteelCo's compliance gap (Verified Emissions - Final Allowances).", answerRule: { mode: "NUMERIC", answer: 0, tolerance: 0 }, baseScore: 5,
      hint: "Subtract final allowances of 130,000 from verified emissions of 130,000.", wrong: "Compliance gap = Verified Emissions - Final Allowances.", explanation: "130,000 - 130,000 = 0.", isSimulation: true
    },
    {
      stableId: "M4-Q09", screen: "M4-S06", type: QuestionType.SC,
      prompt: "Training simulation: after surrendering 130,000 allowances for 130,000 verified emissions, what is SteelCo's status?", options: ["Compliant", "Non-compliant"],
      answerRule: { mode: "EXACT", answer: "Compliant" }, baseScore: 5,
      hint: "A zero compliance gap means the obligation is fully covered.", wrong: "Compare final allowances with verified emissions.", explanation: "SteelCo is Compliant because its compliance gap is zero.", isSimulation: true
    }
  ];
}

async function cloneMission(tx: Db, sourceVersionId: string, targetVersionId: string, stableId: string) {
  const source = await tx.missionTemplate.findUniqueOrThrow({ where: { contentVersionId_stableId: { contentVersionId: sourceVersionId, stableId } }, include: { screens: true, questions: true, scoringConfigs: true } });
  const mission = await tx.missionTemplate.create({ data: { contentVersionId: targetVersionId, stableId: source.stableId, sequenceNo: source.sequenceNo, titleCn: source.titleCn, titleEn: source.titleEn, displayConfig: source.displayConfig as Prisma.InputJsonValue } });
  const screenIds = new Map<string, string>();
  for (const sourceScreen of source.screens.sort((left, right) => left.sequenceNo - right.sequenceNo)) {
    const screen = await tx.missionScreenTemplate.create({ data: { contentVersionId: targetVersionId, missionTemplateId: mission.id, stableId: sourceScreen.stableId, sequenceNo: sourceScreen.sequenceNo, displayConfig: sourceScreen.displayConfig as Prisma.InputJsonValue, inputConfig: sourceScreen.inputConfig as Prisma.InputJsonValue, progressionRuleRef: sourceScreen.progressionRuleRef } });
    screenIds.set(sourceScreen.id, screen.id);
  }
  for (const question of source.questions) await tx.questionTemplate.create({ data: {
    contentVersionId: targetVersionId, missionTemplateId: mission.id, screenTemplateId: screenIds.get(question.screenTemplateId)!, stableId: question.stableId,
    questionType: question.questionType, answerMode: question.answerMode, promptCn: question.promptCn, promptEn: question.promptEn,
    options: question.options === null ? Prisma.JsonNull : question.options as Prisma.InputJsonValue, answerRule: question.answerRule as Prisma.InputJsonValue,
    tolerance: question.tolerance, baseScore: question.baseScore, hintConfig: question.hintConfig as Prisma.InputJsonValue, feedbackConfig: question.feedbackConfig as Prisma.InputJsonValue,
    sourceId: question.sourceId, isSimulation: question.isSimulation, difficulty: question.difficulty
  } });
  const scoring = source.scoringConfigs[0]!;
  await tx.missionScoringConfig.create({ data: {
    contentVersionId: targetVersionId, missionTemplateId: mission.id, policySchemaVersion: scoring.policySchemaVersion,
    componentDefinitions: scoring.componentDefinitions as Prisma.InputJsonValue, retryPolicy: scoring.retryPolicy as Prisma.InputJsonValue,
    assistancePolicy: scoring.assistancePolicy as Prisma.InputJsonValue, revealPolicy: scoring.revealPolicy as Prisma.InputJsonValue,
    completionPolicy: scoring.completionPolicy as Prisma.InputJsonValue, adjustmentBounds: scoring.adjustmentBounds as Prisma.InputJsonValue,
    roundingMode: scoring.roundingMode, decimalPlaces: scoring.decimalPlaces, checksum: scoring.checksum, publishedAt: scoring.publishedAt
  } });
}

async function createMissionFour(tx: Db, contentVersionId: string, sourceId: string) {
  const mission = await tx.missionTemplate.create({ data: { contentVersionId, stableId: "M4", sequenceNo: 4, titleCn: "构建 ETS", titleEn: "Build an ETS", displayConfig: { phase: "IMPLEMENTED", gameplayImplemented: true, screenCount: packageB1MissionFourScreens.length } } });
  const screenIds = new Map<string, string>();
  for (const [index, screen] of packageB1MissionFourScreens.entries()) {
    const created = await tx.missionScreenTemplate.create({ data: {
      contentVersionId, missionTemplateId: mission.id, stableId: screen.stableId, sequenceNo: index + 1,
      displayConfig: { titleCn: screen.titleCn, titleEn: screen.titleEn, body: screen.body, isSimulation: screen.isSimulation },
      inputConfig: screen.stableId === "M4-S02" || screen.stableId === "M4-S03" ? json(packageB1EtsSimulation) : {}, progressionRuleRef: "ALL_SCREEN_QUESTIONS_RESOLVED"
    } });
    screenIds.set(screen.stableId, created.id);
  }
  for (const question of packageB1MissionFourQuestions()) await tx.questionTemplate.create({ data: {
    contentVersionId, missionTemplateId: mission.id, screenTemplateId: screenIds.get(question.screen)!, stableId: question.stableId,
    questionType: question.type, answerMode: question.mode ?? (question.type === QuestionType.NUM ? AnswerMode.NUMERIC : AnswerMode.EXACT),
    promptCn: question.prompt, promptEn: question.prompt, options: question.options === undefined ? Prisma.JsonNull : json(question.options), answerRule: json(question.answerRule),
    baseScore: question.baseScore, hintConfig: { hint: question.hint }, feedbackConfig: { correct: "Correct.", wrong: question.wrong, explanation: question.explanation }, sourceId, isSimulation: Boolean(question.isSimulation)
  } });
  const scoring = {
    components: packageB1MissionScoringComponents,
    completion: { minimumScore: null, allQuestionsFinalized: true, requiredActivities: ["PROCESS", "POSITION_CALCULATION", "TRADE", "COMPLIANCE_REASONING"] }
  };
  await tx.missionScoringConfig.create({ data: {
    contentVersionId, missionTemplateId: mission.id, policySchemaVersion: "2.1", componentDefinitions: json(scoring.components), retryPolicy: json(retry),
    assistancePolicy: { type: "NONE", questionScorePenalty: 0 }, revealPolicy: json(reveal), completionPolicy: json(scoring.completion),
    adjustmentBounds: { question: "0..v5BaseScore", mission: [0, 100], finalTotal: [0, 100] }, roundingMode: "HALF_UP", decimalPlaces: 2,
    checksum: sha(scoring), publishedAt: new Date()
  } });
}

export async function publishPackageB1Content(prisma: PrismaClient) {
  const targetCode = "v5.2-package-b1";
  const existing = await prisma.gameContentVersion.findUnique({ where: { versionCode: targetCode } });
  if (existing) return existing.status === ContentStatus.PUBLISHED
    ? existing
    : prisma.gameContentVersion.update({ where: { id: existing.id }, data: { status: ContentStatus.PUBLISHED, publishedAt: existing.publishedAt ?? new Date() } });
  return prisma.$transaction(async (tx) => {
    const base = await tx.gameContentVersion.findUniqueOrThrow({ where: { versionCode: "v5.1-package-a" }, include: { gameScoring: true } });
    const payload = { code: targetCode, base: base.versionCode, implemented: ["M1", "M2", "M3", "M4"], scoring: "package-b1-2026-09-10" };
    const version = await tx.gameContentVersion.create({ data: { versionCode: targetCode, status: ContentStatus.DRAFT, schemaVersion: "2.1", checksum: sha(payload) } });
    for (const stableId of ["M1", "M2", "M3"]) await cloneMission(tx, base.id, version.id, stableId);
    const simulation = await tx.contentSource.upsert({ where: { id: "00000000-0000-4000-8000-000000000004" }, update: {}, create: { id: "00000000-0000-4000-8000-000000000004", sourceType: SourceType.SIMULATION, name: "Carbon Trader I Package B1 ETS training simulation" } });
    await createMissionFour(tx, version.id, simulation.id);
    for (const [stableId, titleCn, titleEn] of [["M5", "你的第一次交易", "Your First Carbon Trade"], ["M6", "碳市场挑战", "Carbon Market Challenge"]] as const) await tx.missionTemplate.create({ data: { contentVersionId: version.id, stableId, sequenceNo: Number(stableId.slice(1)), titleCn, titleEn, displayConfig: { phase: "LOCKED_PLACEHOLDER", gameplayImplemented: false } } });
    const game = base.gameScoring!;
    await tx.gameScoringConfig.create({ data: { contentVersionId: version.id, policySchemaVersion: game.policySchemaVersion, scoreScaleMin: game.scoreScaleMin, scoreScaleMax: game.scoreScaleMax, missionWeights: game.missionWeights as Prisma.InputJsonValue, levelBands: game.levelBands as Prisma.InputJsonValue, roundingMode: game.roundingMode, decimalPlaces: game.decimalPlaces, checksum: game.checksum, publishedAt: new Date() } });
    return tx.gameContentVersion.update({ where: { id: version.id }, data: { status: ContentStatus.PUBLISHED, publishedAt: new Date() } });
  });
}
