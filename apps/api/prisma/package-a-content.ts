import { AnswerMode, ContentStatus, Prisma, PrismaClient, QuestionType, SourceType } from "@prisma/client";
import { createHash } from "node:crypto";

const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const json = (value: unknown) => value as Prisma.InputJsonValue;
type Db = Prisma.TransactionClient;

const TITLES = [
  ["M1", "排放从哪里来？", "Where Does Carbon Come From?"], ["M2", "计算碳足迹", "Build the Carbon Footprint"],
  ["M3", "碳定价拼图", "Carbon Pricing Puzzle"], ["M4", "构建 ETS", "Build an ETS"],
  ["M5", "你的第一次交易", "Your First Carbon Trade"], ["M6", "碳市场挑战", "Carbon Market Challenge"]
] as const;
const retry = { maxIndependentAttempts: 3, factors: [1, 0.9, 0.8], selection: "FIRST_CORRECT" };
const reveal = { afterFailures: 3, factor: 0.5 };

type QuestionDefinition = { stableId: string; screen: string; type: QuestionType; mode?: AnswerMode; prompt: string; answerRule: unknown; baseScore: number; options?: unknown; hint: string; wrong: string; explanation: string; isSimulation?: boolean };

async function cloneMissionOne(tx: Db, baseVersionId: string, targetVersionId: string) {
  const sourceMission = await tx.missionTemplate.findUniqueOrThrow({ where: { contentVersionId_stableId: { contentVersionId: baseVersionId, stableId: "M1" } }, include: { screens: true, questions: true, scoringConfigs: true } });
  const mission = await tx.missionTemplate.create({ data: { contentVersionId: targetVersionId, stableId: "M1", sequenceNo: 1, titleCn: sourceMission.titleCn, titleEn: sourceMission.titleEn, displayConfig: { ...(sourceMission.displayConfig as object), gameplayImplemented: true } } });
  const screenIds = new Map<string, string>();
  for (const source of sourceMission.screens.sort((a, b) => a.sequenceNo - b.sequenceNo)) {
    const screen = await tx.missionScreenTemplate.create({ data: { contentVersionId: targetVersionId, missionTemplateId: mission.id, stableId: source.stableId, sequenceNo: source.sequenceNo, displayConfig: source.displayConfig as Prisma.InputJsonValue, inputConfig: source.inputConfig as Prisma.InputJsonValue, progressionRuleRef: source.progressionRuleRef } });
    screenIds.set(source.id, screen.id);
  }
  for (const source of sourceMission.questions) await tx.questionTemplate.create({ data: {
    contentVersionId: targetVersionId, missionTemplateId: mission.id, screenTemplateId: screenIds.get(source.screenTemplateId)!, stableId: source.stableId,
    questionType: source.questionType, answerMode: source.answerMode, promptCn: source.promptCn, promptEn: source.promptEn,
    options: source.options === null ? Prisma.JsonNull : source.options as Prisma.InputJsonValue, answerRule: source.answerRule as Prisma.InputJsonValue,
    tolerance: source.tolerance, baseScore: source.baseScore, hintConfig: source.hintConfig as Prisma.InputJsonValue,
    feedbackConfig: source.feedbackConfig as Prisma.InputJsonValue, sourceId: source.sourceId, isSimulation: source.isSimulation, difficulty: source.difficulty
  } });
  const scoring = sourceMission.scoringConfigs[0]!;
  await tx.missionScoringConfig.create({ data: { contentVersionId: targetVersionId, missionTemplateId: mission.id, policySchemaVersion: scoring.policySchemaVersion, componentDefinitions: scoring.componentDefinitions as Prisma.InputJsonValue, retryPolicy: scoring.retryPolicy as Prisma.InputJsonValue, assistancePolicy: scoring.assistancePolicy as Prisma.InputJsonValue, revealPolicy: scoring.revealPolicy as Prisma.InputJsonValue, completionPolicy: scoring.completionPolicy as Prisma.InputJsonValue, adjustmentBounds: scoring.adjustmentBounds as Prisma.InputJsonValue, roundingMode: scoring.roundingMode, decimalPlaces: scoring.decimalPlaces, checksum: scoring.checksum, publishedAt: new Date() } });
}

async function createMission(tx: Db, contentVersionId: string, stableId: "M2" | "M3", screens: Array<{ stableId: string; titleCn: string; titleEn: string; body: string; isSimulation?: boolean; inputConfig?: unknown }>, questions: QuestionDefinition[], sourceIds: { internal: string; simulation: string }, scoring: { components: unknown; completion: unknown; assistance?: unknown; retry?: unknown }) {
  const title = TITLES.find(([id]) => id === stableId)!;
  const mission = await tx.missionTemplate.create({ data: { contentVersionId, stableId, sequenceNo: Number(stableId.slice(1)), titleCn: title[1], titleEn: title[2], displayConfig: { phase: "IMPLEMENTED", gameplayImplemented: true, screenCount: screens.length } } });
  const screenMap = new Map<string, string>();
  for (const [index, definition] of screens.entries()) {
    const screen = await tx.missionScreenTemplate.create({ data: { contentVersionId, missionTemplateId: mission.id, stableId: definition.stableId, sequenceNo: index + 1, displayConfig: { titleCn: definition.titleCn, titleEn: definition.titleEn, body: definition.body, isSimulation: Boolean(definition.isSimulation) }, inputConfig: json(definition.inputConfig ?? {}), progressionRuleRef: "ALL_SCREEN_QUESTIONS_RESOLVED" } });
    screenMap.set(definition.stableId, screen.id);
  }
  for (const question of questions) await tx.questionTemplate.create({ data: { contentVersionId, missionTemplateId: mission.id, screenTemplateId: screenMap.get(question.screen)!, stableId: question.stableId, questionType: question.type, answerMode: question.mode ?? (question.type === QuestionType.NUM ? AnswerMode.NUMERIC : AnswerMode.EXACT), promptCn: question.prompt, promptEn: question.prompt, options: question.options === undefined ? Prisma.JsonNull : json(question.options), answerRule: json(question.answerRule), baseScore: question.baseScore, hintConfig: { hint: question.hint }, feedbackConfig: { correct: "Correct.", wrong: question.wrong, explanation: question.explanation }, sourceId: question.isSimulation ? sourceIds.simulation : sourceIds.internal, isSimulation: Boolean(question.isSimulation) } });
  await tx.missionScoringConfig.create({ data: { contentVersionId, missionTemplateId: mission.id, policySchemaVersion: "2.0", componentDefinitions: json(scoring.components), retryPolicy: json(scoring.retry ?? retry), assistancePolicy: json(scoring.assistance ?? { type: "NONE", questionScorePenalty: 0 }), revealPolicy: json(reveal), completionPolicy: json(scoring.completion), adjustmentBounds: { question: "0..v5BaseScore", mission: [0, 100], finalTotal: [0, 100] }, roundingMode: "HALF_UP", decimalPlaces: 2, checksum: sha(scoring), publishedAt: new Date() } });
}

export const packageAActivities = [
  { label: "500,000 kWh purchased electricity", factor: "0.50 kgCO2e/kWh", unit: "kgCO2e/kWh", result: 250, scope: "Scope 2", divisor: 1000 },
  { label: "20,000 L diesel", factor: "2.68 kgCO2e/L", unit: "kgCO2e/L", result: 53.6, scope: "Scope 1", divisor: 1000 },
  { label: "100 t cotton", factor: "3.20 tCO2e/t", unit: "tCO2e/t", result: 320, scope: "Scope 3", divisor: 1 },
  { label: "50 short-haul flights", factor: "0.18 tCO2e/flight", unit: "tCO2e/flight", result: 9, scope: "Scope 3", divisor: 1 },
  { label: "10 t waste to landfill", factor: "0.60 tCO2e/t", unit: "tCO2e/t", result: 6, scope: "Scope 3", divisor: 1 }
] as const;
const activities = packageAActivities;

export function packageAMissionTwoQuestions(): QuestionDefinition[] {
  const unitOptions = ["kgCO2e/kWh", "kgCO2e/L", "tCO2e/t", "tCO2e/flight"];
  const factorOptions = packageAActivities.map((item) => item.factor);
  const questions: QuestionDefinition[] = [];
  activities.forEach((a, i) => questions.push({ stableId: `M2-Q${String(i + 1).padStart(2, "0")}`, screen: "M2-S02", type: QuestionType.SC, prompt: `${a.label}: select the compatible emission-factor unit.`, answerRule: { mode: "EXACT", answer: a.unit }, baseScore: 1, options: unitOptions, hint: "Cancel the activity unit against the factor denominator.", wrong: "The activity unit and factor denominator do not match.", explanation: `The compatible unit is ${a.unit}.`, isSimulation: true }));
  activities.forEach((a, i) => questions.push({ stableId: `M2-Q${String(i + 6).padStart(2, "0")}`, screen: "M2-S03", type: QuestionType.SC, prompt: `${a.label}: match the configured emission factor.`, answerRule: { mode: "EXACT", answer: a.factor }, baseScore: 1, options: factorOptions, hint: "Match the activity and denominator unit.", wrong: "That factor belongs to a different activity or unit.", explanation: `This simulation uses ${a.factor}.`, isSimulation: true }));
  activities.forEach((a, i) => questions.push({ stableId: `M2-Q${i + 11}`, screen: "M2-S04", type: QuestionType.NUM, prompt: `${a.label} × ${a.factor}${a.divisor === 1000 ? " ÷ 1,000" : ""} = ? tCO2e`, answerRule: { mode: "NUMERIC", answer: a.result, tolerancePercent: 0.5 }, baseScore: 4, hint: "Use E = Activity Data × Emission Factor and convert kg to tonnes where required.", wrong: a.divisor === 1000 ? "Check the kg-to-tonnes conversion: divide by 1,000." : "Check the multiplication and units.", explanation: `The result is ${a.result} tCO2e.`, isSimulation: true }));
  questions.push(
    { stableId: "M2-Q16", screen: "M2-S06", type: QuestionType.SC, prompt: "Which activity is the largest emission source?", answerRule: { mode: "EXACT", answer: "Cotton" }, baseScore: 5, options: ["Cotton", "Purchased electricity", "Diesel", "Flights", "Waste"], hint: "Compare the calculated tCO2e values.", wrong: "Compare 320, 250, 53.6, 9 and 6 tCO2e.", explanation: "Cotton is the hotspot at 320 tCO2e.", isSimulation: true },
    { stableId: "M2-Q17", screen: "M2-S06", type: QuestionType.SC, prompt: "Does the largest footprint always mean it is easiest or cheapest to reduce?", answerRule: { mode: "EXACT", answer: "No" }, baseScore: 5, options: ["Yes", "No"], hint: "A hotspot measures emissions, not abatement cost.", wrong: "Hotspot and marginal abatement cost are different concepts.", explanation: "No. A hotspot does not establish cost or feasibility.", isSimulation: true }
  );
  activities.forEach((a, i) => questions.push({ stableId: `M2-Q${i + 18}`, screen: "M2-S05", type: QuestionType.DRAG, prompt: `${a.result} tCO2e from ${a.label}: classify the Scope.`, answerRule: { mode: "EXACT", answer: a.scope }, baseScore: 1, options: { destinations: ["Scope 1", "Scope 2", "Scope 3"] }, hint: "Use ownership/control, purchased energy, then value chain.", wrong: "Apply the Scope boundary rule.", explanation: `${a.label} is ${a.scope}.`, isSimulation: true }));
  questions.push(
    { stableId: "M2-Q23", screen: "M2-S07", type: QuestionType.SC, prompt: "When is a carbon-intensity comparison meaningful?", answerRule: { mode: "EXACT", answer: "Comparable boundary, denominator and business context" }, baseScore: 5, options: ["Comparable boundary, denominator and business context", "Whenever absolute emissions are available", "Whenever one company is larger"], hint: "Check the denominator and business context.", wrong: "Absolute emissions alone do not make unlike companies comparable.", explanation: "Boundary, denominator and business context must be comparable.", isSimulation: true },
    { stableId: "M2-Q24", screen: "M2-S07", type: QuestionType.SC, prompt: "Training simulation: GreenThread emits 638.6 t for 100,000 garments; FactoryCo emits 900 t for 200,000 garments. Which has lower intensity?", answerRule: { mode: "EXACT", answer: "FactoryCo" }, baseScore: 5, options: ["GreenThread", "FactoryCo", "Cannot compare"], hint: "Divide emissions by garments.", wrong: "Use emissions per garment, not absolute emissions.", explanation: "FactoryCo is 4.5 kg/garment versus GreenThread at 6.386 kg/garment.", isSimulation: true },
    { stableId: "M2-Q25", screen: "M2-S07", type: QuestionType.NUM, prompt: "Training simulation: calculate GreenThread intensity in kgCO2e per garment (638.6 t / 100,000 garments).", answerRule: { mode: "NUMERIC", answer: 6.386, tolerancePercent: 0.5 }, baseScore: 5, hint: "Convert tonnes to kilograms, then divide by output.", wrong: "Check the tonnes conversion and denominator.", explanation: "638,600 kg ÷ 100,000 = 6.386 kgCO2e/garment.", isSimulation: true }
  );
  return questions;
}
const m2Questions = packageAMissionTwoQuestions;

function m3Questions(): QuestionDefinition[] {
  const tools = ["Carbon Tax", "ETS Allowance", "Carbon Credit"];
  const concepts = [["Government sets a fixed charge for each tonne of emissions.", "Carbon Tax"], ["Government sets a total emissions cap and creates tradable allowances.", "ETS Allowance"], ["Company purchases verified reductions/removals from an eligible project.", "Carbon Credit"], ["A company must surrender one unit for each tonne under a cap.", "ETS Allowance"], ["A project outside the capped sector issues verified units.", "Carbon Credit"], ["Policy sets price certainty but not a fixed emissions quantity.", "Carbon Tax"]] as const;
  const questions = concepts.map<QuestionDefinition>(([prompt, answer], i) => ({ stableId: `M3-Q${String(i + 1).padStart(2, "0")}`, screen: "M3-S03", type: QuestionType.SC, prompt, answerRule: { mode: "EXACT", answer }, baseScore: 5, options: tools, hint: "Identify a fixed price, cap unit or project unit.", wrong: "Distinguish taxes, allowances and credits.", explanation: `The correct tool is ${answer}.` }));
  questions.push(
    { stableId: "M3-Q07", screen: "M3-S04", type: QuestionType.NUM, prompt: "Training simulation: emissions 120,000 tCO2e; allowances 100,000. What is the shortage?", answerRule: { mode: "NUMERIC", answer: 20000, tolerance: 0 }, baseScore: 5, hint: "Gap = E - A.", wrong: "Subtract allowances from emissions.", explanation: "The shortage is 20,000 tCO2e.", isSimulation: true },
    { stableId: "M3-Q08", screen: "M3-S04", type: QuestionType.NUM, prompt: "Training simulation: what does a 20,000 t shortage cost at €65/t?", answerRule: { mode: "NUMERIC", answer: 1300000, tolerance: 0 }, baseScore: 5, hint: "Multiply shortage by price.", wrong: "Use 20,000 × €65.", explanation: "The cost is €1,300,000.", isSimulation: true },
    { stableId: "M3-Q09", screen: "M3-S05", type: QuestionType.NUM, prompt: "Training simulation rule: eligible credits are capped at 5% of 120,000 t. What is the maximum?", answerRule: { mode: "NUMERIC", answer: 6000, tolerance: 0 }, baseScore: 5, hint: "Calculate 0.05 × 120,000.", wrong: "Apply this simulation's 5% cap.", explanation: "The simulation maximum is 6,000 credits.", isSimulation: true },
    { stableId: "M3-Q10", screen: "M3-S06", type: QuestionType.DECISION, mode: AnswerMode.STRATEGY, prompt: "Training simulation: shortage 20,000 t; feasible reduction 8,000 t at MAC €40/t; allowances €65/t. Choose the lowest-cost strategy.", answerRule: { mode: "STRATEGY", rubricRef: "M3_LOWEST_COST_COMPLIANCE", rubric: { shortage: 20000, availableReduction: 8000, mac: 40, allowancePrice: 65 } }, baseScore: 10, options: [{ label: "Reduce 8,000; Buy 12,000", value: { reduce: 8000, buy: 12000 } }, { label: "Reduce 0; Buy 20,000", value: { reduce: 0, buy: 20000 } }, { label: "Reduce 8,000; Buy 20,000", value: { reduce: 8000, buy: 20000 } }], hint: "Compare MAC and allowance price, then respect capacity.", wrong: "Use cheaper feasible reduction first, then buy the remainder.", explanation: "Reduce 8,000 and buy 12,000.", isSimulation: true }
  );
  const finalQuiz = [["Which tool gives government direct price certainty per tonne?", "Carbon Tax"], ["Which tool requires capped firms to surrender units for covered emissions?", "ETS Allowance"], ["Which tool comes from eligible verified projects and may be scheme-limited?", "Carbon Credit"]] as const;
  finalQuiz.forEach(([prompt, answer], i) => questions.push({ stableId: `M3-Q${i + 11}`, screen: "M3-S07", type: QuestionType.SC, prompt, answerRule: { mode: "EXACT", answer }, baseScore: 5, options: tools, hint: "Return to the defining mechanisms.", wrong: "Distinguish taxes, allowances and credits.", explanation: `The answer is ${answer}.` }));
  return questions;
}
export const packageAMissionThreeQuestions = m3Questions;

export async function publishPackageAContent(prisma: PrismaClient) {
  const targetCode = "v5.1-package-a";
  const existing = await prisma.gameContentVersion.findUnique({ where: { versionCode: targetCode } });
  if (existing) return prisma.$transaction(async (tx) => {
    await tx.gameContentVersion.updateMany({ where: { status: ContentStatus.PUBLISHED, id: { not: existing.id } }, data: { status: ContentStatus.ARCHIVED } });
    return tx.gameContentVersion.update({ where: { id: existing.id }, data: { status: ContentStatus.PUBLISHED, publishedAt: existing.publishedAt ?? new Date() } });
  });
  return prisma.$transaction(async (tx) => {
    const base = await tx.gameContentVersion.findUniqueOrThrow({ where: { versionCode: "v5.0-phase1-final" }, include: { gameScoring: true } });
    const payload = { code: targetCode, base: base.versionCode, implemented: ["M1", "M2", "M3"], scoring: "package-a-2026-09-07" };
    const version = await tx.gameContentVersion.create({ data: { versionCode: targetCode, status: ContentStatus.DRAFT, schemaVersion: "2.0", checksum: sha(payload) } });
    const internal = await tx.contentSource.upsert({ where: { id: "00000000-0000-4000-8000-000000000002" }, update: {}, create: { id: "00000000-0000-4000-8000-000000000002", sourceType: SourceType.INTERNAL, name: "Carbon Trader I v5 authoritative content" } });
    const simulation = await tx.contentSource.upsert({ where: { id: "00000000-0000-4000-8000-000000000003" }, update: {}, create: { id: "00000000-0000-4000-8000-000000000003", sourceType: SourceType.SIMULATION, name: "Carbon Trader I Package A training simulations" } });
    await cloneMissionOne(tx, base.id, version.id);
    await createMission(tx, version.id, "M2", [
      { stableId: "M2-S01", titleCn: "任务介绍", titleEn: "Mission Intro", body: "Build a footprint with Activity Data × Emission Factor." }, { stableId: "M2-S02", titleCn: "单位匹配", titleEn: "Unit Match", body: "Match activity units to compatible factor units.", isSimulation: true }, { stableId: "M2-S03", titleCn: "排放因子匹配", titleEn: "Emission Factor Match", body: "Match the configured simulation factors.", isSimulation: true },
      { stableId: "M2-S04", titleCn: "排放计算器", titleEn: "Calculator", body: "E = Activity Data × Emission Factor. Convert kg to tonnes where needed.", isSimulation: true, inputConfig: { activities: [{ activityData: 500000, emissionFactor: .5, divisor: 1000, scope: "Scope 2" }, { activityData: 20000, emissionFactor: 2.68, divisor: 1000, scope: "Scope 1" }, { activityData: 100, emissionFactor: 3.2, scope: "Scope 3" }, { activityData: 50, emissionFactor: .18, scope: "Scope 3" }, { activityData: 10, emissionFactor: .6, scope: "Scope 3" }] } },
      { stableId: "M2-S05", titleCn: "范围堆叠", titleEn: "Scope Stack", body: "Classify calculated blocks and inspect the footprint.", isSimulation: true }, { stableId: "M2-S06", titleCn: "热点", titleEn: "Hotspot", body: "Find the largest source and separate hotspot from abatement cost.", isSimulation: true }, { stableId: "M2-S07", titleCn: "企业比较与强度", titleEn: "Company Compare / Carbon Intensity", body: "Compare emissions per relevant output only in comparable contexts.", isSimulation: true }
    ], m2Questions(), { internal: internal.id, simulation: simulation.id }, { components: [
      { stableId: "UNIT_MATCHING", weightPoints: 15, normalization: "PROPORTIONAL", contributions: [1,2,3,4,5].map((n) => ({ sourceType: "QUESTION_RESULT", sourceRef: `M2-Q0${n}`, rawMax: 1 })) },
      { stableId: "FACTOR_MATCHING", weightPoints: 20, normalization: "PROPORTIONAL", contributions: [6,7,8,9,10].map((n) => ({ sourceType: "QUESTION_RESULT", sourceRef: `M2-Q${String(n).padStart(2,"0")}`, rawMax: 1 })) },
      { stableId: "CALCULATION", weightPoints: 25, normalization: "PROPORTIONAL", contributions: [...[11,12,13,14,15].map((n) => ({ sourceType: "QUESTION_RESULT", sourceRef: `M2-Q${n}`, rawMax: 4 })), ...[18,19,20,21,22].map((n) => ({ sourceType: "QUESTION_RESULT", sourceRef: `M2-Q${n}`, rawMax: 1 }))] },
      { stableId: "HOTSPOT_REASONING", weightPoints: 15, normalization: "PROPORTIONAL", contributions: [16,17].map((n) => ({ sourceType: "QUESTION_RESULT", sourceRef: `M2-Q${n}`, rawMax: 5 })) },
      { stableId: "COMPANY_COMPARISON", weightPoints: 15, normalization: "PROPORTIONAL", contributions: [23,24].map((n) => ({ sourceType: "QUESTION_RESULT", sourceRef: `M2-Q${n}`, rawMax: 5 })) },
      { stableId: "INTENSITY_REASONING", weightPoints: 10, normalization: "PROPORTIONAL", contributions: [{ sourceType: "QUESTION_RESULT", sourceRef: "M2-Q25", rawMax: 5 }] }
    ], completion: { minimumScore: null, allQuestionsFinalized: true } });
    await createMission(tx, version.id, "M3", [
      { stableId: "M3-S01", titleCn: "任务介绍", titleEn: "Mission Intro", body: "Distinguish Carbon Tax, ETS Allowance and Carbon Credit." }, { stableId: "M3-S02", titleCn: "定价工具", titleEn: "Pricing Tools", body: "Tax fixes a price; ETS creates capped allowances; credits come from eligible verified projects." }, { stableId: "M3-S03", titleCn: "概念匹配", titleEn: "Concept Match", body: "Classify each policy mechanism." }, { stableId: "M3-S04", titleCn: "ETS 缺口与成本", titleEn: "ETS Gap & Cost", body: "Calculate shortage and allowance cost.", isSimulation: true }, { stableId: "M3-S05", titleCn: "信用资格", titleEn: "Credit Eligibility", body: "Apply this scenario's scheme-specific credit cap.", isSimulation: true }, { stableId: "M3-S06", titleCn: "最低成本合规", titleEn: "Lowest-cost Compliance", body: "Compare MAC with allowance price and feasible capacity.", isSimulation: true }, { stableId: "M3-S07", titleCn: "最终辨析", titleEn: "Final Distinction Quiz", body: "Confirm the distinctions among the three tools." }
    ], m3Questions(), { internal: internal.id, simulation: simulation.id }, { components: [
      { stableId: "CONCEPT", weightPoints: 45, normalization: "PROPORTIONAL", contributions: [1,2,3,4,5,6].map((n) => ({ sourceType: "QUESTION_RESULT", sourceRef: `M3-Q0${n}`, rawMax: 5 })) },
      { stableId: "CASES", weightPoints: 35, normalization: "PROPORTIONAL", contributions: [...[7,8,9].map((n) => ({ sourceType: "QUESTION_RESULT", sourceRef: `M3-Q0${n}`, rawMax: 5 })), { sourceType: "QUESTION_RESULT", sourceRef: "M3-Q10", rawMax: 10 }] },
      { stableId: "MISCONCEPTION_CHALLENGE", weightPoints: 15, normalization: "PROPORTIONAL", contributions: [11,12,13].map((n) => ({ sourceType: "QUESTION_RESULT", sourceRef: `M3-Q${n}`, rawMax: 5 })) },
      { stableId: "BONUS", weightPoints: 5, normalization: "TABLE", contributions: [], mappingStatus: "UNRESOLVED_SOURCE_RULE" }
    ], completion: { minimumScore: null, allQuestionsFinalized: true }, retry: { ...retry, strategyIndependentAttempts: 1 }, assistance: { type: "NONE", questionScorePenalty: 0, missionBonus: null } });
    for (const stableId of ["M4", "M5", "M6"] as const) { const title = TITLES.find(([id]) => id === stableId)!; await tx.missionTemplate.create({ data: { contentVersionId: version.id, stableId, sequenceNo: Number(stableId.slice(1)), titleCn: title[1], titleEn: title[2], displayConfig: { phase: "LOCKED_PLACEHOLDER", gameplayImplemented: false } } }); }
    const game = base.gameScoring!;
    await tx.gameScoringConfig.create({ data: { contentVersionId: version.id, policySchemaVersion: game.policySchemaVersion, scoreScaleMin: game.scoreScaleMin, scoreScaleMax: game.scoreScaleMax, missionWeights: game.missionWeights as Prisma.InputJsonValue, levelBands: game.levelBands as Prisma.InputJsonValue, roundingMode: game.roundingMode, decimalPlaces: game.decimalPlaces, checksum: game.checksum, publishedAt: new Date() } });
    await tx.gameContentVersion.updateMany({ where: { status: ContentStatus.PUBLISHED }, data: { status: ContentStatus.ARCHIVED } });
    return tx.gameContentVersion.update({ where: { id: version.id }, data: { status: ContentStatus.PUBLISHED, publishedAt: new Date() } });
  });
}
