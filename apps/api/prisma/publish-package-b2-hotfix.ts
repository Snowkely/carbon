import { PrismaClient } from "@prisma/client";
import { publishPackageB2HotfixContent } from "./package-b2-hotfix-content";

const prisma = new PrismaClient();
publishPackageB2HotfixContent(prisma)
  .then(async (version) => {
    const [corrected, historical, missions, questions] = await Promise.all([
      prisma.missionScreenTemplate.findFirstOrThrow({ where: { contentVersionId: version.id, stableId: "M5-S01" }, select: { inputConfig: true } }),
      prisma.missionScreenTemplate.findFirstOrThrow({ where: { contentVersion: { versionCode: "v5.3-package-b2" }, stableId: "M5-S01" }, select: { inputConfig: true } })
      , prisma.missionTemplate.findMany({ where: { contentVersionId: version.id }, orderBy: { sequenceNo: "asc" }, select: { stableId: true, displayConfig: true } })
      , prisma.questionTemplate.findMany({ where: { contentVersionId: version.id, mission: { stableId: "M5" } }, select: { promptCn: true, promptEn: true, hintConfig: true, feedbackConfig: true } })
    ]);
    const missionFlags = missions.map((mission) => [mission.stableId, Boolean((mission.displayConfig as { gameplayImplemented?: boolean }).gameplayImplemented)] as const);
    if (missionFlags.slice(0, 5).some(([, implemented]) => !implemented) || missionFlags[5]?.[1] !== false) throw new Error("Corrected version Mission implementation flags are invalid");
    const supersededPrice = Number((historical.inputConfig as { marketPrice: number }).marketPrice);
    if (JSON.stringify({ corrected, questions }).includes(String(supersededPrice))) throw new Error("Corrected M5 content still contains the superseded market price");
    console.log(`Published ${version.versionCode} (${version.id}) with M5 market price €${Number((corrected.inputConfig as { marketPrice: number }).marketPrice).toFixed(2)}/t.`);
    console.log(`Gameplay flags: ${missionFlags.map(([stableId, implemented]) => `${stableId}=${implemented}`).join(", ")}.`);
    console.log(`Historical v5.3-package-b2 remains pinned at €${Number((historical.inputConfig as { marketPrice: number }).marketPrice).toFixed(2)}/t; existing Workshop references were not changed.`);
  })
  .finally(() => prisma.$disconnect());
