import { Injectable } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { missionOneScore } from "@carbon/game-rules";

type RuntimeState = { viewedNodes?: string[]; reflection?: string; hintUsed?: boolean; revealUsed?: boolean };

@Injectable()
export class ScoringService {
  constructor(private readonly prisma: PrismaService) {}

  async calculateMissionOne(missionAttemptId: string, effective = false, includeMissionOverride = true): Promise<number> {
    const missionAttempt = await this.prisma.missionAttempt.findUniqueOrThrow({
      where: { id: missionAttemptId },
      include: {
        mission: true,
        adjustmentStream: { include: { currentAdjustment: true } },
        questionResults: {
          where: { status: "FINALIZED" },
          include: { question: true, adjustmentStream: { include: { currentAdjustment: true } } }
        }
      }
    });
    if (effective && includeMissionOverride && missionAttempt.adjustmentStream?.currentAdjustment) return Number(missionAttempt.adjustmentStream.currentAdjustment.adjustedScore);
    const [config, valueChainScreen] = await Promise.all([
      this.prisma.missionScoringConfig.findUniqueOrThrow({ where: { contentVersionId_missionTemplateId: { contentVersionId: missionAttempt.mission.contentVersionId, missionTemplateId: missionAttempt.missionTemplateId } } }),
      this.prisma.missionScreenTemplate.findFirstOrThrow({ where: { missionTemplateId: missionAttempt.missionTemplateId, stableId: "M1-S02" } })
    ]);
    const components = config.componentDefinitions as Array<{ stableId?: string; weightPoints?: number; contributions?: Array<{ sourceType?: string; sourceRef?: string; rawMax?: number }> }>;
    const scan = components.find((component) => component.stableId === "SCAN");
    const cards = components.find((component) => component.stableId === "CARDS");
    const boundary = components.find((component) => component.stableId === "BOUNDARY");
    const reasoning = components.find((component) => component.stableId === "REASONING_ASSISTANCE");
    const assistance = config.assistancePolicy as { noHint?: number; hintUsed?: number; reveal?: number };
    const policy = {
      explorationPoints: Number(scan?.contributions?.find((item) => item.sourceType === "ACTIVITY_COMPLETION")?.rawMax ?? 0),
      boundaryRawMax: Number(boundary?.contributions?.reduce((sum, item) => sum + Number(item.rawMax ?? 0), 0) ?? 0),
      boundaryWeight: Number(boundary?.weightPoints ?? 0),
      reflectionPoints: Number(reasoning?.contributions?.find((item) => item.sourceType === "ACTIVITY_COMPLETION")?.rawMax ?? 0),
      assistance: { noHint: Number(assistance.noHint), hintUsed: Number(assistance.hintUsed), reveal: Number(assistance.reveal) }
    };
    const scoreById = new Map(missionAttempt.questionResults.map((result) => [result.question.stableId, effective && result.adjustmentStream?.currentAdjustment ? Number(result.adjustmentStream.currentAdjustment.adjustedScore) : Number(result.systemScore ?? 0)]));
    const state = (missionAttempt.runtimeState ?? {}) as RuntimeState;
    const questionRefs = (component: typeof scan) => component?.contributions?.filter((item) => item.sourceType === "QUESTION_RESULT").map((item) => item.sourceRef!).filter(Boolean) ?? [];
    const q01Ref = questionRefs(scan)[0];
    const explorationRequired = Number((valueChainScreen.inputConfig as { nodesRequired?: number }).nodesRequired);
    return missionOneScore({
      explorationComplete: (state.viewedNodes?.length ?? 0) >= explorationRequired,
      q01: q01Ref ? scoreById.get(q01Ref) ?? 0 : 0,
      cardScores: questionRefs(cards).map((id) => scoreById.get(id) ?? 0),
      boundaryScores: questionRefs(boundary).map((id) => scoreById.get(id) ?? 0),
      reflectionComplete: Boolean(state.reflection?.trim()),
      hintUsed: state.hintUsed ?? false,
      revealUsed: state.revealUsed ?? false
    }, policy);
  }
}
