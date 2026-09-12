import { AnswerMode, ContentStatus, Prisma, PrismaClient, QuestionType, SourceType } from "@prisma/client";
import { createHash } from "node:crypto";

// Historical publisher for the already-published, superseded v5.3-package-b2. Do not alter its frozen payload; publish corrections additively.

const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const json = (value: unknown) => value as Prisma.InputJsonValue;
type Db = Prisma.TransactionClient;

export const packageB2MissionFiveScenario = {
  label: "Training simulation",
  verifiedEmissions: 110000,
  allowances: 100000,
  marketPrice: 54.8,
  bankingEnabled: false,
  projects: [
    { id: "M5-P01", name: "Boiler efficiency controls", capacity: 4000, marginalAbatementCost: 32 },
    { id: "M5-P02", name: "Waste heat recovery", capacity: 6000, marginalAbatementCost: 46 },
    { id: "M5-P03", name: "Fuel switching", capacity: 8000, marginalAbatementCost: 68 }
  ]
} as const;

export const packageB2MissionFiveScreens = [
  { stableId: "M5-S01", titleCn: "了解你的仓位", titleEn: "Know Your Position", body: "Calculate the compliance gap from verified emissions and allowances." },
  { stableId: "M5-S02", titleCn: "比较减排项目", titleEn: "Compare Reduction Projects", body: "Compare finite project capacity and marginal abatement cost with the allowance market price." },
  { stableId: "M5-S03", titleCn: "提交行动", titleEn: "Choose and Submit an Action", body: "Choose an action and quantity, review its projected state, then explicitly submit the decision." },
  { stableId: "M5-S04", titleCn: "解释策略", titleEn: "Explain Your Strategy", body: "Explain how cost, position and compliance influenced your submitted decision." }
] as const;

export const packageB2MissionFiveScoringComponents = [
  { stableId: "COMPLIANCE", weightPoints: 40, normalization: "TABLE", contributions: [{ sourceType: "STRATEGY_DIMENSION", sourceRef: "M5-COMPLIANCE", rawMax: 40 }] },
  { stableId: "COST_LOGIC", weightPoints: 30, normalization: "TABLE", contributions: [{ sourceType: "STRATEGY_DIMENSION", sourceRef: "M5-COST-LOGIC", rawMax: 30 }] },
  { stableId: "POSITION", weightPoints: 20, normalization: "TABLE", contributions: [{ sourceType: "STRATEGY_DIMENSION", sourceRef: "M5-POSITION", rawMax: 20 }] },
  { stableId: "REASONING", weightPoints: 10, normalization: "TABLE", contributions: [{ sourceType: "STRATEGY_DIMENSION", sourceRef: "M5-REASONING", rawMax: 10 }] }
] as const;

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
  for (const scoring of source.scoringConfigs) await tx.missionScoringConfig.create({ data: {
    contentVersionId: targetVersionId, missionTemplateId: mission.id, policySchemaVersion: scoring.policySchemaVersion,
    componentDefinitions: scoring.componentDefinitions as Prisma.InputJsonValue, retryPolicy: scoring.retryPolicy as Prisma.InputJsonValue,
    assistancePolicy: scoring.assistancePolicy as Prisma.InputJsonValue, revealPolicy: scoring.revealPolicy as Prisma.InputJsonValue,
    completionPolicy: scoring.completionPolicy as Prisma.InputJsonValue, adjustmentBounds: scoring.adjustmentBounds as Prisma.InputJsonValue,
    roundingMode: scoring.roundingMode, decimalPlaces: scoring.decimalPlaces, checksum: scoring.checksum, publishedAt: scoring.publishedAt
  } });
}

async function createMissionFive(tx: Db, contentVersionId: string, sourceId: string) {
  const mission = await tx.missionTemplate.create({ data: { contentVersionId, stableId: "M5", sequenceNo: 5, titleCn: "你的第一次碳交易", titleEn: "Your First Carbon Trade", displayConfig: { phase: "IMPLEMENTED", gameplayImplemented: true, screenCount: 4, simulationLabel: "Training simulation" } } });
  const screenIds = new Map<string, string>();
  for (const [index, screen] of packageB2MissionFiveScreens.entries()) {
    const created = await tx.missionScreenTemplate.create({ data: {
      contentVersionId, missionTemplateId: mission.id, stableId: screen.stableId, sequenceNo: index + 1,
      displayConfig: { titleCn: screen.titleCn, titleEn: screen.titleEn, body: screen.body, isSimulation: true, simulationLabel: "Training simulation" },
      inputConfig: screen.stableId === "M5-S01" ? json(packageB2MissionFiveScenario) : {}, progressionRuleRef: "ALL_SCREEN_QUESTIONS_RESOLVED"
    } });
    screenIds.set(screen.stableId, created.id);
  }
  const questions = [
    { stableId: "M5-Q01", screen: "M5-S01", type: QuestionType.NUM, mode: AnswerMode.NUMERIC, prompt: "Training simulation: calculate the compliance gap (Verified Emissions - Allowances).", options: undefined, answerRule: { mode: "NUMERIC", answer: 10000, tolerance: 0 }, baseScore: 5, hint: "Subtract 100,000 allowances from 110,000 verified emissions.", wrong: "Recheck Verified Emissions - Allowances.", explanation: "110,000 - 100,000 = a 10,000 t shortage." },
    { stableId: "M5-Q02", screen: "M5-S02", type: QuestionType.MC, mode: AnswerMode.MULTI_EXACT, prompt: "Training simulation: select the reduction projects whose marginal abatement cost is below the allowance market price of €54.80/t.", options: packageB2MissionFiveScenario.projects.map((project) => ({ label: `${project.name} — ${project.capacity.toLocaleString("en-US")} t at €${project.marginalAbatementCost.toFixed(2)}/t`, value: project.id })), answerRule: { mode: "MULTI_EXACT", answer: ["M5-P01", "M5-P02"] }, baseScore: 10, hint: "Compare each project's marginal abatement cost with €54.80/t.", wrong: "Select every project below the market price, and exclude projects above it.", explanation: "Boiler efficiency (€32/t) and waste heat recovery (€46/t) are cheaper than allowances; fuel switching (€68/t) is not." },
    { stableId: "M5-Q03", screen: "M5-S03", type: QuestionType.DECISION, mode: AnswerMode.STRATEGY, prompt: "Training simulation: choose Reduce, Buy, Sell or Hold; set a quantity; review the projected state; then Submit Decision.", options: ["Reduce", "Buy", "Sell", "Hold"], answerRule: { mode: "STRATEGY", rubricRef: "M5_ACTION_DECISION", rubric: { evidencePoints: 20 } }, baseScore: 20, hint: "Your company starts 10,000 t short. Compare selected project MACs with €54.80/t and consider the compliance effect.", wrong: "Review the projected position and submit a valid action and quantity.", explanation: "The submitted strategy is scored by the versioned Compliance, Cost Logic and Position rubric." },
    { stableId: "M5-Q04", screen: "M5-S04", type: QuestionType.REFLECTION, mode: AnswerMode.STRATEGY, prompt: "Explain how marginal abatement cost versus allowance price, your shortage position, and the compliance effect support your decision.", options: undefined, answerRule: { mode: "STRATEGY", rubricRef: "M5_REASONING_RUBRIC", rubric: { allThree: 10, anyTwo: 5, oneOrNone: 0 } }, baseScore: 10, hint: "Connect all three ideas: MAC versus price, the initial position, and the effect on compliance.", wrong: "Add the missing cost, position or compliance connection.", explanation: "Reasoning receives 10 for all three concepts, 5 for two, and 0 for one or none." }
  ];
  for (const question of questions) await tx.questionTemplate.create({ data: {
    contentVersionId, missionTemplateId: mission.id, screenTemplateId: screenIds.get(question.screen)!, stableId: question.stableId,
    questionType: question.type, answerMode: question.mode, promptCn: question.prompt, promptEn: question.prompt,
    options: question.options === undefined ? Prisma.JsonNull : json(question.options), answerRule: json(question.answerRule), baseScore: question.baseScore,
    hintConfig: { hint: question.hint }, feedbackConfig: { correct: "Decision recorded.", wrong: question.wrong, explanation: question.explanation }, sourceId, isSimulation: true
  } });
  const scoring = { rubricRef: "M5_STRATEGY_RUBRIC_V1", components: packageB2MissionFiveScoringComponents, completion: { minimumScore: null, allQuestionsFinalized: true, requiredActivities: ["POSITION", "PROJECT_SELECTION", "ACTION", "REASONING"], nextMissionAutoUnlock: false } };
  await tx.missionScoringConfig.create({ data: {
    contentVersionId, missionTemplateId: mission.id, policySchemaVersion: "2.2", componentDefinitions: json(scoring.components),
    retryPolicy: { maxIndependentAttempts: 3, strategyIndependentAttempts: 1, factors: [1, 0.9, 0.8], selection: "FIRST_CORRECT" }, assistancePolicy: { type: "NONE", questionScorePenalty: 0 }, revealPolicy: { afterFailures: 3, factor: 0.5 }, completionPolicy: json(scoring.completion),
    adjustmentBounds: { question: "0..v5BaseScore", mission: [0, 100], finalTotal: [0, 100] }, roundingMode: "HALF_UP", decimalPlaces: 2, checksum: sha({ ...scoring, scenario: packageB2MissionFiveScenario }), publishedAt: new Date()
  } });
}

export async function publishPackageB2Content(prisma: PrismaClient) {
  const targetCode = "v5.3-package-b2";
  const existing = await prisma.gameContentVersion.findUnique({ where: { versionCode: targetCode } });
  if (existing) return existing;
  return prisma.$transaction(async (tx) => {
    const base = await tx.gameContentVersion.findUniqueOrThrow({ where: { versionCode: "v5.2-package-b1" }, include: { gameScoring: true } });
    if (base.status !== ContentStatus.PUBLISHED) throw new Error("v5.2-package-b1 must be published before Package B2");
    const payload = { code: targetCode, base: base.versionCode, implemented: ["M1", "M2", "M3", "M4", "M5"], scoring: "package-b2-2026-09-11" };
    const version = await tx.gameContentVersion.create({ data: { versionCode: targetCode, status: ContentStatus.DRAFT, schemaVersion: "2.2", checksum: sha(payload) } });
    for (const stableId of ["M1", "M2", "M3", "M4"]) await cloneMission(tx, base.id, version.id, stableId);
    const simulation = await tx.contentSource.upsert({ where: { id: "00000000-0000-4000-8000-000000000005" }, update: {}, create: { id: "00000000-0000-4000-8000-000000000005", sourceType: SourceType.SIMULATION, name: "Carbon Trader I Package B2 first-trade training simulation" } });
    await createMissionFive(tx, version.id, simulation.id);
    const baseM6 = await tx.missionTemplate.findUniqueOrThrow({ where: { contentVersionId_stableId: { contentVersionId: base.id, stableId: "M6" } } });
    await tx.missionTemplate.create({ data: { contentVersionId: version.id, stableId: "M6", sequenceNo: 6, titleCn: baseM6.titleCn, titleEn: baseM6.titleEn, displayConfig: { phase: "LOCKED_PLACEHOLDER", gameplayImplemented: false } } });
    const game = base.gameScoring!;
    await tx.gameScoringConfig.create({ data: { contentVersionId: version.id, policySchemaVersion: game.policySchemaVersion, scoreScaleMin: game.scoreScaleMin, scoreScaleMax: game.scoreScaleMax, missionWeights: game.missionWeights as Prisma.InputJsonValue, levelBands: game.levelBands as Prisma.InputJsonValue, roundingMode: game.roundingMode, decimalPlaces: game.decimalPlaces, checksum: game.checksum, publishedAt: new Date() } });
    return tx.gameContentVersion.update({ where: { id: version.id }, data: { status: ContentStatus.PUBLISHED, publishedAt: new Date() } });
  });
}
