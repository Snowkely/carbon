import { ContentStatus, Prisma, PrismaClient, SourceType } from "@prisma/client";
import { createHash } from "node:crypto";

const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const json = (value: unknown) => value as Prisma.InputJsonValue;
type Db = Prisma.TransactionClient;

export const packageB2HotfixMarketPrice = 64.8;
export const packageB2HotfixProjects = [
  { id: "M5-P01", name: "Boiler efficiency controls", capacity: 4000, marginalAbatementCost: 32 },
  { id: "M5-P02", name: "Waste heat recovery", capacity: 6000, marginalAbatementCost: 46 },
  { id: "M5-P03", name: "Fuel switching", capacity: 8000, marginalAbatementCost: 68 }
] as const;
export const packageB2HotfixMissionFiveScenario = {
  label: "Training simulation",
  verifiedEmissions: 110000,
  allowances: 100000,
  marketPrice: packageB2HotfixMarketPrice,
  bankingEnabled: false,
  projects: packageB2HotfixProjects
} as const;

const correctedText = (value: string, oldMarketPrice: number) => value
  .replaceAll(`€${oldMarketPrice.toFixed(2)}`, `€${packageB2HotfixMarketPrice.toFixed(2)}`)
  .replaceAll(`€${oldMarketPrice.toFixed(1)}`, `€${packageB2HotfixMarketPrice.toFixed(1)}`);

async function cloneMission(tx: Db, sourceVersionId: string, targetVersionId: string, stableId: string, hotfixSourceId: string) {
  const source = await tx.missionTemplate.findUniqueOrThrow({ where: { contentVersionId_stableId: { contentVersionId: sourceVersionId, stableId } }, include: { screens: true, questions: true, scoringConfigs: true } });
  const sourceMarketPrice = Number((source.screens.find((screen) => screen.stableId === "M5-S01")?.inputConfig as { marketPrice?: number } | undefined)?.marketPrice);
  const mission = await tx.missionTemplate.create({ data: { contentVersionId: targetVersionId, stableId: source.stableId, sequenceNo: source.sequenceNo, titleCn: source.titleCn, titleEn: source.titleEn, displayConfig: source.displayConfig as Prisma.InputJsonValue } });
  const screenIds = new Map<string, string>();
  for (const sourceScreen of source.screens.sort((left, right) => left.sequenceNo - right.sequenceNo)) {
    const sourceInput = sourceScreen.inputConfig as Record<string, unknown>;
    const inputConfig = sourceScreen.stableId === "M5-S01"
      ? { ...sourceInput, marketPrice: packageB2HotfixMarketPrice }
      : sourceInput;
    const screen = await tx.missionScreenTemplate.create({ data: {
      contentVersionId: targetVersionId, missionTemplateId: mission.id, stableId: sourceScreen.stableId, sequenceNo: sourceScreen.sequenceNo,
      displayConfig: sourceScreen.displayConfig as Prisma.InputJsonValue, inputConfig: json(inputConfig), progressionRuleRef: sourceScreen.progressionRuleRef
    } });
    screenIds.set(sourceScreen.id, screen.id);
  }
  for (const question of source.questions) await tx.questionTemplate.create({ data: {
    contentVersionId: targetVersionId, missionTemplateId: mission.id, screenTemplateId: screenIds.get(question.screenTemplateId)!, stableId: question.stableId,
    questionType: question.questionType, answerMode: question.answerMode,
    promptCn: stableId === "M5" ? correctedText(question.promptCn, sourceMarketPrice) : question.promptCn,
    promptEn: stableId === "M5" ? correctedText(question.promptEn, sourceMarketPrice) : question.promptEn,
    options: question.options === null ? Prisma.JsonNull : question.options as Prisma.InputJsonValue, answerRule: question.answerRule as Prisma.InputJsonValue,
    tolerance: question.tolerance, baseScore: question.baseScore,
    hintConfig: stableId === "M5" ? json(Object.fromEntries(Object.entries(question.hintConfig as Record<string, unknown>).map(([key, value]) => [key, typeof value === "string" ? correctedText(value, sourceMarketPrice) : value]))) : question.hintConfig as Prisma.InputJsonValue,
    feedbackConfig: stableId === "M5" ? json(Object.fromEntries(Object.entries(question.feedbackConfig as Record<string, unknown>).map(([key, value]) => [key, typeof value === "string" ? correctedText(value, sourceMarketPrice) : value]))) : question.feedbackConfig as Prisma.InputJsonValue,
    sourceId: stableId === "M5" ? hotfixSourceId : question.sourceId, isSimulation: question.isSimulation, difficulty: question.difficulty
  } });
  for (const scoring of source.scoringConfigs) await tx.missionScoringConfig.create({ data: {
    contentVersionId: targetVersionId, missionTemplateId: mission.id, policySchemaVersion: scoring.policySchemaVersion,
    componentDefinitions: scoring.componentDefinitions as Prisma.InputJsonValue, retryPolicy: scoring.retryPolicy as Prisma.InputJsonValue,
    assistancePolicy: scoring.assistancePolicy as Prisma.InputJsonValue, revealPolicy: scoring.revealPolicy as Prisma.InputJsonValue,
    completionPolicy: scoring.completionPolicy as Prisma.InputJsonValue, adjustmentBounds: scoring.adjustmentBounds as Prisma.InputJsonValue,
    roundingMode: scoring.roundingMode, decimalPlaces: scoring.decimalPlaces,
    checksum: stableId === "M5" ? sha({ baseChecksum: scoring.checksum, marketPrice: packageB2HotfixMarketPrice }) : scoring.checksum,
    publishedAt: scoring.publishedAt
  } });
}

export async function publishPackageB2HotfixContent(prisma: PrismaClient) {
  const targetCode = "v5.3.1-package-b2-hotfix";
  const existing = await prisma.gameContentVersion.findUnique({ where: { versionCode: targetCode } });
  if (existing) return existing;
  return prisma.$transaction(async (tx) => {
    const base = await tx.gameContentVersion.findUniqueOrThrow({ where: { versionCode: "v5.3-package-b2" }, include: { gameScoring: true } });
    if (base.status !== ContentStatus.PUBLISHED) throw new Error("v5.3-package-b2 must be published before its corrective hotfix");
    const payload = { code: targetCode, base: base.versionCode, correction: { mission: "M5", marketPrice: packageB2HotfixMarketPrice }, implemented: ["M1", "M2", "M3", "M4", "M5"] };
    const version = await tx.gameContentVersion.create({ data: { versionCode: targetCode, status: ContentStatus.DRAFT, schemaVersion: "2.2.1", checksum: sha(payload) } });
    const source = await tx.contentSource.upsert({ where: { id: "00000000-0000-4000-8000-000000000051" }, update: {}, create: { id: "00000000-0000-4000-8000-000000000051", sourceType: SourceType.SIMULATION, name: "Carbon Trader I Package B2 M5 market-price corrective hotfix" } });
    for (const stableId of ["M1", "M2", "M3", "M4", "M5", "M6"]) await cloneMission(tx, base.id, version.id, stableId, source.id);
    const game = base.gameScoring!;
    await tx.gameScoringConfig.create({ data: { contentVersionId: version.id, policySchemaVersion: game.policySchemaVersion, scoreScaleMin: game.scoreScaleMin, scoreScaleMax: game.scoreScaleMax, missionWeights: game.missionWeights as Prisma.InputJsonValue, levelBands: game.levelBands as Prisma.InputJsonValue, roundingMode: game.roundingMode, decimalPlaces: game.decimalPlaces, checksum: game.checksum, publishedAt: new Date() } });
    return tx.gameContentVersion.update({ where: { id: version.id }, data: { status: ContentStatus.PUBLISHED, publishedAt: new Date() } });
  });
}
