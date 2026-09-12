import { PrismaClient } from "@prisma/client";
import { publishPackageCContent } from "./package-c-content";

const prisma = new PrismaClient();
publishPackageCContent(prisma)
  .then(async (version) => {
    const [missions, m3, m5, m6, game] = await Promise.all([
      prisma.missionTemplate.findMany({ where: { contentVersionId: version.id }, orderBy: { sequenceNo: "asc" }, select: { stableId: true, displayConfig: true } }),
      prisma.missionScoringConfig.findFirstOrThrow({ where: { contentVersionId: version.id, mission: { stableId: "M3" } }, select: { componentDefinitions: true, completionPolicy: true } }),
      prisma.missionScreenTemplate.findFirstOrThrow({ where: { contentVersionId: version.id, stableId: "M5-S01" }, select: { inputConfig: true } }),
      prisma.missionTemplate.findUniqueOrThrow({ where: { contentVersionId_stableId: { contentVersionId: version.id, stableId: "M6" } }, include: { screens: true, questions: true, scoringConfigs: true } }),
      prisma.gameScoringConfig.findUniqueOrThrow({ where: { contentVersionId: version.id } })
    ]);
    const flags = missions.map((mission) => [mission.stableId, Boolean((mission.displayConfig as { gameplayImplemented?: boolean }).gameplayImplemented)] as const);
    if (flags.length !== 6 || flags.some(([, implemented]) => !implemented)) throw new Error("Package C must publish all six Missions as implemented");
    const normalization = (m3.completionPolicy as { missionScoreNormalization?: { activeRawMax?: number; targetMax?: number; bonusStatus?: string } }).missionScoreNormalization;
    const bonus = (m3.componentDefinitions as Array<{ stableId?: string; mappingStatus?: string }>).find((component) => component.stableId === "BONUS");
    if (normalization?.activeRawMax !== 95 || normalization.targetMax !== 100 || normalization.bonusStatus !== "INACTIVE_UNMAPPED" || bonus?.mappingStatus !== "INACTIVE_UNMAPPED") throw new Error("Package C M3 normalization is invalid");
    if (Number((m5.inputConfig as { marketPrice?: number }).marketPrice) !== 64.8) throw new Error("Package C regressed the corrected M5 market price");
    const weights = game.missionWeights as Record<string, number>;
    if (JSON.stringify(weights) !== JSON.stringify({ M1: .15, M2: .15, M3: .15, M4: .15, M5: .2, M6: .2 })) throw new Error("Package C final weights are invalid");
    if (m6.screens.length !== 3 || m6.questions.length !== 11 || (m6.scoringConfigs[0]?.componentDefinitions as Array<{ weightPoints: number }>).map((component) => component.weightPoints).join("/") !== "50/25/25") throw new Error("Package C M6 fixed-round configuration is invalid");
    console.log(`Published ${version.versionCode} (${version.id}).`);
    console.log(`Gameplay flags: ${flags.map(([id, implemented]) => `${id}=${implemented}`).join(", ")}.`);
    console.log(`Verified M3 active normalization 95→100, M6 50/25/25, M5 €64.80/t, and Final IQ 15/15/15/15/20/20.`);
  })
  .finally(() => prisma.$disconnect());
