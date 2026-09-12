import { AnswerMode, ContentStatus, Prisma, PrismaClient, QuestionType, SourceType } from "@prisma/client";
import { createHash } from "node:crypto";

const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const json = (value: unknown) => value as Prisma.InputJsonValue;
type Db = Prisma.TransactionClient;

const retry = { maxIndependentAttempts: 3, strategyIndependentAttempts: 1, factors: [1, 0.9, 0.8], selection: "FIRST_CORRECT" };
const reveal = { afterFailures: 3, factor: 0.5 };

export const packageCMissionWeights = { M1: 0.15, M2: 0.15, M3: 0.15, M4: 0.15, M5: 0.2, M6: 0.2 } as const;
export const packageCMissionThreeNormalization = { activeRawMax: 95, targetMax: 100, inactiveComponents: ["BONUS"], bonusStatus: "INACTIVE_UNMAPPED" } as const;
export const packageCMissionSixScenario = { mac: 45, allowancePrice: 75, marginalAdvantage: 30, feasibleReductionCapacityExists: true } as const;
export const packageCMissionSixComponents = [
  { stableId: "ROUND_1_POLICY_SHOCK", weightPoints: 50, normalization: "PROPORTIONAL", contributions: ["M6-Q01", "M6-Q02", "M6-Q03"].map((sourceRef) => ({ sourceType: "QUESTION_RESULT", sourceRef, rawMax: 5 })) },
  { stableId: "ROUND_2_TECHNOLOGY_SHOCK", weightPoints: 25, normalization: "PROPORTIONAL", contributions: ["M6-Q11", "M6-Q12", "M6-Q13", "M6-Q14"].map((sourceRef) => ({ sourceType: "QUESTION_RESULT", sourceRef, rawMax: 5 })) },
  { stableId: "ROUND_3_INTEGRATED", weightPoints: 25, normalization: "PROPORTIONAL", contributions: [{ sourceType: "QUESTION_RESULT", sourceRef: "M6-Q21", rawMax: 5 }, { sourceType: "QUESTION_RESULT", sourceRef: "M6-Q22", rawMax: 5 }, { sourceType: "QUESTION_RESULT", sourceRef: "M6-Q23", rawMax: 20 }] }
] as const;

export const packageCMissionSixScreens = [
  { stableId: "M6-S01", titleCn: "政策冲击 — 收紧总量", titleEn: "Policy Shock — Cap Tightening", body: "Trace how a tighter cap changes allowance supply, scarcity and price pressure." },
  { stableId: "M6-S02", titleCn: "技术冲击 — 低碳突破", titleEn: "Technology Shock — Low-carbon Technology Breakthrough", body: "Trace how lower marginal abatement cost changes abatement, allowance demand and price pressure." },
  { stableId: "M6-S03", titleCn: "技术与价格综合决策", titleEn: "Integrated Technology × Price", body: "Compare MAC €45/tCO2e with an EUA price of €75/tCO2e in this fixed training scenario." }
] as const;

type QuestionDefinition = { stableId: string; screen: string; type: QuestionType; mode?: AnswerMode; prompt: string; answerRule: unknown; baseScore: number; options: unknown; hint: string; wrong: string; explanation: string };
const policyChain = "Cap decreases → Allowance Supply decreases → Scarcity increases → Upward price pressure.";
const technologyChain = "MAC decreases → Abatement increases → Allowance demand decreases → Downward price pressure.";
const strategies = ["Reduce / Invest", "Buy", "Sell", "Hold"] as const;

export function packageCMissionSixQuestions(): QuestionDefinition[] {
  return [
    { stableId: "M6-Q01", screen: "M6-S01", type: QuestionType.SC, prompt: "Cap Tightening: what happens to allowance supply?", options: ["Supply decreases", "Supply increases", "Supply is unchanged"], answerRule: { mode: "EXACT", answer: "Supply decreases" }, baseScore: 5, hint: "A tighter cap places fewer allowances into the market.", wrong: "Follow the first link from a lower cap.", explanation: policyChain },
    { stableId: "M6-Q02", screen: "M6-S01", type: QuestionType.SC, prompt: "When allowance supply decreases, what happens to scarcity?", options: ["Scarcity increases", "Scarcity decreases", "Scarcity is unchanged"], answerRule: { mode: "EXACT", answer: "Scarcity increases" }, baseScore: 5, hint: "Compare available allowances with compliance demand.", wrong: "Fewer available allowances create greater scarcity.", explanation: policyChain },
    { stableId: "M6-Q03", screen: "M6-S01", type: QuestionType.SC, prompt: "What price pressure follows increased scarcity?", options: ["Upward price pressure", "Downward price pressure", "No price pressure"], answerRule: { mode: "EXACT", answer: "Upward price pressure" }, baseScore: 5, hint: "Describe pressure, not a guaranteed future price.", wrong: "Greater scarcity creates upward price pressure.", explanation: policyChain },
    { stableId: "M6-Q04", screen: "M6-S01", type: QuestionType.DECISION, mode: AnswerMode.STRATEGY, prompt: "For the configured training firm with a shortage and feasible abatement, choose a response to the cap tightening.", options: strategies, answerRule: { mode: "STRATEGY", rubricRef: "M6_POLICY_SHOCK_STRATEGY", rubric: { options: strategies, preferredOption: "Reduce / Invest", evidencePoints: 0, allowancePosition: "SHORTAGE", feasibleReductionCapacityExists: true } }, baseScore: 0, hint: "Review the firm's shortage and feasible abatement in this configured scenario.", wrong: "For this configured scenario, Reduce / Invest best addresses the shortage while preserving flexibility.", explanation: policyChain },
    { stableId: "M6-Q11", screen: "M6-S02", type: QuestionType.SC, prompt: "After a low-carbon technology breakthrough, what happens to MAC?", options: ["MAC decreases", "MAC increases", "MAC is unchanged"], answerRule: { mode: "EXACT", answer: "MAC decreases" }, baseScore: 5, hint: "The breakthrough makes abatement less costly at the margin.", wrong: "A technology breakthrough lowers MAC in this event.", explanation: technologyChain },
    { stableId: "M6-Q12", screen: "M6-S02", type: QuestionType.SC, prompt: "When MAC decreases, what happens to abatement?", options: ["Abatement increases", "Abatement decreases", "Abatement is unchanged"], answerRule: { mode: "EXACT", answer: "Abatement increases" }, baseScore: 5, hint: "Lower-cost abatement makes more reductions economic.", wrong: "Lower MAC increases abatement in this scenario.", explanation: technologyChain },
    { stableId: "M6-Q13", screen: "M6-S02", type: QuestionType.SC, prompt: "When abatement increases, what happens to allowance demand?", options: ["Allowance demand decreases", "Allowance demand increases", "Allowance demand is unchanged"], answerRule: { mode: "EXACT", answer: "Allowance demand decreases" }, baseScore: 5, hint: "More internal reductions mean fewer allowances are needed.", wrong: "Greater abatement reduces allowance demand.", explanation: technologyChain },
    { stableId: "M6-Q14", screen: "M6-S02", type: QuestionType.SC, prompt: "What price pressure follows lower allowance demand?", options: ["Downward price pressure", "Upward price pressure", "No price pressure"], answerRule: { mode: "EXACT", answer: "Downward price pressure" }, baseScore: 5, hint: "Describe pressure, not a guaranteed future price.", wrong: "Lower demand creates downward price pressure.", explanation: technologyChain },
    { stableId: "M6-Q21", screen: "M6-S03", type: QuestionType.SC, prompt: "Compare MAC €45/tCO2e with EUA €75/tCO2e.", options: ["MAC < EUA", "MAC = EUA", "MAC > EUA"], answerRule: { mode: "EXACT", answer: "MAC < EUA" }, baseScore: 5, hint: "Compare 45 with 75.", wrong: "€45 is lower than €75.", explanation: "MAC €45 < EUA €75 in this configured training scenario." },
    { stableId: "M6-Q22", screen: "M6-S03", type: QuestionType.SC, prompt: "What is the economic implication and marginal advantage?", options: ["Internal abatement is economically more attractive at the margin — €30/tCO2e advantage", "Buying is economically more attractive — €30/tCO2e advantage", "There is no marginal advantage"], answerRule: { mode: "EXACT", answer: "Internal abatement is economically more attractive at the margin — €30/tCO2e advantage" }, baseScore: 5, hint: "Calculate €75 − €45 and identify the lower marginal cost.", wrong: "The lower marginal option has a €30/tCO2e advantage.", explanation: "€75 − €45 = €30/tCO2e. Internal abatement is economically more attractive at the margin in this configured scenario." },
    { stableId: "M6-Q23", screen: "M6-S03", type: QuestionType.DECISION, mode: AnswerMode.STRATEGY, prompt: "With feasible reduction capacity and MAC €45 below EUA €75, choose the strongest Economic Logic response for this training scenario.", options: strategies, answerRule: { mode: "STRATEGY", rubricRef: "M6_INTEGRATED_STRATEGY", rubric: { options: strategies, preferredOption: "Reduce / Invest", evidencePoints: 20, mac: 45, allowancePrice: 75, feasibleReductionCapacityExists: true } }, baseScore: 20, hint: "Compare the marginal abatement cost with the allowance price.", wrong: "In this configured scenario, feasible internal reduction costs less at the margin.", explanation: "Reduce / Invest has the strongest Economic Logic here because feasible internal abatement at €45/tCO2e is €30/tCO2e below the €75 allowance price." }
  ];
}

async function cloneMission(tx: Db, sourceVersionId: string, targetVersionId: string, stableId: string) {
  const source = await tx.missionTemplate.findUniqueOrThrow({ where: { contentVersionId_stableId: { contentVersionId: sourceVersionId, stableId } }, include: { screens: true, questions: true, scoringConfigs: true } });
  const mission = await tx.missionTemplate.create({ data: { contentVersionId: targetVersionId, stableId: source.stableId, sequenceNo: source.sequenceNo, titleCn: source.titleCn, titleEn: source.titleEn, displayConfig: source.displayConfig as Prisma.InputJsonValue } });
  const screenIds = new Map<string, string>();
  for (const sourceScreen of source.screens.sort((a, b) => a.sequenceNo - b.sequenceNo)) {
    const screen = await tx.missionScreenTemplate.create({ data: { contentVersionId: targetVersionId, missionTemplateId: mission.id, stableId: sourceScreen.stableId, sequenceNo: sourceScreen.sequenceNo, displayConfig: sourceScreen.displayConfig as Prisma.InputJsonValue, inputConfig: sourceScreen.inputConfig as Prisma.InputJsonValue, progressionRuleRef: sourceScreen.progressionRuleRef } });
    screenIds.set(sourceScreen.id, screen.id);
  }
  for (const question of source.questions) await tx.questionTemplate.create({ data: { contentVersionId: targetVersionId, missionTemplateId: mission.id, screenTemplateId: screenIds.get(question.screenTemplateId)!, stableId: question.stableId, questionType: question.questionType, answerMode: question.answerMode, promptCn: question.promptCn, promptEn: question.promptEn, options: question.options === null ? Prisma.JsonNull : question.options as Prisma.InputJsonValue, answerRule: question.answerRule as Prisma.InputJsonValue, tolerance: question.tolerance, baseScore: question.baseScore, hintConfig: question.hintConfig as Prisma.InputJsonValue, feedbackConfig: question.feedbackConfig as Prisma.InputJsonValue, sourceId: question.sourceId, isSimulation: question.isSimulation, difficulty: question.difficulty } });
  const scoring = source.scoringConfigs[0]!;
  const components = stableId === "M3"
    ? (scoring.componentDefinitions as Array<Record<string, unknown>>).map((component) => component.stableId === "BONUS" ? { ...component, mappingStatus: "INACTIVE_UNMAPPED" } : component)
    : scoring.componentDefinitions;
  const completion = stableId === "M3" ? { ...(scoring.completionPolicy as Record<string, unknown>), missionScoreNormalization: packageCMissionThreeNormalization } : scoring.completionPolicy;
  await tx.missionScoringConfig.create({ data: { contentVersionId: targetVersionId, missionTemplateId: mission.id, policySchemaVersion: stableId === "M3" ? "2.3" : scoring.policySchemaVersion, componentDefinitions: components as Prisma.InputJsonValue, retryPolicy: scoring.retryPolicy as Prisma.InputJsonValue, assistancePolicy: scoring.assistancePolicy as Prisma.InputJsonValue, revealPolicy: scoring.revealPolicy as Prisma.InputJsonValue, completionPolicy: json(completion), adjustmentBounds: scoring.adjustmentBounds as Prisma.InputJsonValue, roundingMode: scoring.roundingMode, decimalPlaces: scoring.decimalPlaces, checksum: stableId === "M3" ? sha({ baseChecksum: scoring.checksum, components, normalization: packageCMissionThreeNormalization }) : scoring.checksum, publishedAt: new Date() } });
}

async function createMissionSix(tx: Db, contentVersionId: string, sourceId: string) {
  const mission = await tx.missionTemplate.create({ data: { contentVersionId, stableId: "M6", sequenceNo: 6, titleCn: "碳市场挑战", titleEn: "Carbon Market Challenge", displayConfig: { phase: "IMPLEMENTED", gameplayImplemented: true, screenCount: 3, fixedRounds: true } } });
  const screenIds = new Map<string, string>();
  for (const [index, screen] of packageCMissionSixScreens.entries()) {
    const created = await tx.missionScreenTemplate.create({ data: { contentVersionId, missionTemplateId: mission.id, stableId: screen.stableId, sequenceNo: index + 1, displayConfig: { titleCn: screen.titleCn, titleEn: screen.titleEn, body: screen.body, isSimulation: true }, inputConfig: screen.stableId === "M6-S03" ? json({ label: "Training simulation", ...packageCMissionSixScenario }) : json({ label: "Training simulation", event: screen.titleEn }), progressionRuleRef: "ALL_SCREEN_QUESTIONS_RESOLVED" } });
    screenIds.set(screen.stableId, created.id);
  }
  for (const question of packageCMissionSixQuestions()) await tx.questionTemplate.create({ data: { contentVersionId, missionTemplateId: mission.id, screenTemplateId: screenIds.get(question.screen)!, stableId: question.stableId, questionType: question.type, answerMode: question.mode ?? AnswerMode.EXACT, promptCn: question.prompt, promptEn: question.prompt, options: json(question.options), answerRule: json(question.answerRule), baseScore: question.baseScore, hintConfig: { hint: question.hint }, feedbackConfig: { correct: "Correct.", wrong: question.wrong, explanation: question.explanation }, sourceId, isSimulation: true } });
  const completion = { minimumScore: null, allQuestionsFinalized: true, requiredQuestions: packageCMissionSixQuestions().map((question) => question.stableId), nonNumericRequiredEvidence: ["M6-Q04"], roundWeights: { round1: 50, round2: 25, round3: 25 }, oldV3ScoringInactive: true };
  await tx.missionScoringConfig.create({ data: { contentVersionId, missionTemplateId: mission.id, policySchemaVersion: "2.3", componentDefinitions: json(packageCMissionSixComponents), retryPolicy: json(retry), assistancePolicy: { type: "NONE", questionScorePenalty: 0, missionWideBonus: 0 }, revealPolicy: json(reveal), completionPolicy: json(completion), adjustmentBounds: { question: "0..v5BaseScore", mission: [0, 100], finalTotal: [0, 100] }, roundingMode: "HALF_UP", decimalPlaces: 2, checksum: sha({ components: packageCMissionSixComponents, completion }), publishedAt: new Date() } });
}

export async function publishPackageCContent(prisma: PrismaClient) {
  const targetCode = "v5.4-package-c";
  const existing = await prisma.gameContentVersion.findUnique({ where: { versionCode: targetCode } });
  if (existing) return existing;
  return prisma.$transaction(async (tx) => {
    const base = await tx.gameContentVersion.findUniqueOrThrow({ where: { versionCode: "v5.3.1-package-b2-hotfix" } });
    if (base.status !== ContentStatus.PUBLISHED) throw new Error("v5.3.1-package-b2-hotfix must be published before Package C");
    const payload = { code: targetCode, base: base.versionCode, implemented: ["M1", "M2", "M3", "M4", "M5", "M6"], m3: packageCMissionThreeNormalization, m6: packageCMissionSixComponents, weights: packageCMissionWeights };
    const version = await tx.gameContentVersion.create({ data: { versionCode: targetCode, status: ContentStatus.DRAFT, schemaVersion: "2.3", checksum: sha(payload) } });
    for (const stableId of ["M1", "M2", "M3", "M4", "M5"]) await cloneMission(tx, base.id, version.id, stableId);
    const source = await tx.contentSource.upsert({ where: { id: "00000000-0000-4000-8000-000000000061" }, update: {}, create: { id: "00000000-0000-4000-8000-000000000061", sourceType: SourceType.SIMULATION, name: "Carbon Trader I Package C fixed Mission 6 training rounds" } });
    await createMissionSix(tx, version.id, source.id);
    const gamePayload = { weights: packageCMissionWeights, bands: [[90, "Carbon Market Navigator"], [80, "Carbon Trader"], [70, "Carbon Explorer"], [60, "Carbon Learner"], [0, "Review recommended before Level II"]] };
    await tx.gameScoringConfig.create({ data: { contentVersionId: version.id, policySchemaVersion: "2.3", scoreScaleMin: 0, scoreScaleMax: 100, missionWeights: json(packageCMissionWeights), levelBands: json(gamePayload.bands), roundingMode: "HALF_UP", decimalPlaces: 2, checksum: sha(gamePayload), publishedAt: new Date() } });
    return tx.gameContentVersion.update({ where: { id: version.id }, data: { status: ContentStatus.PUBLISHED, publishedAt: new Date() } });
  });
}
