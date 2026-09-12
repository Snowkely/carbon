import { Injectable } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { configuredMissionBreakdown, configuredMissionScore, missionOneBreakdown, normalizeActiveMissionScore, scoreMissionFive, scoreMissionSix, summarizeCarbonMarketIq, type MissionFiveDecision, type MissionFiveScenario } from "@carbon/game-rules";
import type { MissionScoreBreakdownDto } from "@carbon/contracts";

type RuntimeState = { viewedNodes?: string[]; reflection?: string; hintUsed?: boolean; revealUsed?: boolean };

@Injectable()
export class ScoringService {
  constructor(private readonly prisma: PrismaService) {}

  async calculateMission(missionAttemptId: string, effective = false, includeMissionOverride = true): Promise<number> {
    const missionAttempt = await this.prisma.missionAttempt.findUniqueOrThrow({
      where: { id: missionAttemptId },
      include: { mission: true, adjustmentStream: { include: { currentAdjustment: true } }, questionResults: { where: { status: "FINALIZED" }, include: { question: true, adjustmentStream: { include: { currentAdjustment: true } } } } }
    });
    if (missionAttempt.mission.stableId === "M1") return this.calculateMissionOne(missionAttemptId, effective, includeMissionOverride);
    if (effective && includeMissionOverride && missionAttempt.adjustmentStream?.currentAdjustment) return Number(missionAttempt.adjustmentStream.currentAdjustment.adjustedScore);
    if (missionAttempt.mission.stableId === "M5") return (await this.calculateMissionFiveBreakdown(missionAttemptId)).total;
    const config = await this.prisma.missionScoringConfig.findUniqueOrThrow({ where: { contentVersionId_missionTemplateId: { contentVersionId: missionAttempt.mission.contentVersionId, missionTemplateId: missionAttempt.missionTemplateId } } });
    const scores = new Map(missionAttempt.questionResults.map((result) => [result.question.stableId, effective && result.adjustmentStream?.currentAdjustment ? Number(result.adjustmentStream.currentAdjustment.adjustedScore) : Number(result.systemScore ?? 0)]));
    if (missionAttempt.mission.stableId === "M6") return scoreMissionSix(scores).total;
    const configured = configuredMissionScore(config.componentDefinitions as Parameters<typeof configuredMissionScore>[0], scores);
    const normalization = (config.completionPolicy as { missionScoreNormalization?: { activeRawMax?: number; targetMax?: number } }).missionScoreNormalization;
    return missionAttempt.mission.stableId === "M3" && normalization?.targetMax === 100
      ? normalizeActiveMissionScore(configured, Number(normalization.activeRawMax))
      : configured;
  }

  async calculateMissionSixBreakdown(missionAttemptId: string, effective = false) {
    const result = await this.prisma.missionAttempt.findUniqueOrThrow({
      where: { id: missionAttemptId },
      include: { mission: true, questionResults: { where: { status: "FINALIZED" }, include: { question: true, adjustmentStream: { include: { currentAdjustment: true } } } } }
    });
    if (result.mission.stableId !== "M6") throw new Error("Mission 6 breakdown requested for a different Mission");
    const scores = new Map(result.questionResults.map((questionResult) => [questionResult.question.stableId, effective && questionResult.adjustmentStream?.currentAdjustment ? Number(questionResult.adjustmentStream.currentAdjustment.adjustedScore) : Number(questionResult.systemScore ?? 0)]));
    return scoreMissionSix(scores);
  }

  async calculateMissionBreakdown(missionAttemptId: string, effective = false): Promise<MissionScoreBreakdownDto> {
    const missionAttempt = await this.prisma.missionAttempt.findUniqueOrThrow({
      where: { id: missionAttemptId },
      include: { mission: true, questionResults: { where: { status: "FINALIZED" }, include: { question: true, adjustmentStream: { include: { currentAdjustment: true } } } } }
    });
    const stableId = missionAttempt.mission.stableId;
    const config = await this.prisma.missionScoringConfig.findUniqueOrThrow({ where: { contentVersionId_missionTemplateId: { contentVersionId: missionAttempt.mission.contentVersionId, missionTemplateId: missionAttempt.missionTemplateId } } });
    const definitions = config.componentDefinitions as Array<{ stableId?: string; weightPoints?: number; normalization?: "PROPORTIONAL" | "DIRECT" | "TABLE"; mappingStatus?: "ACTIVE" | "INACTIVE_UNMAPPED"; contributions?: Array<{ sourceType?: string; sourceRef?: string; rawMax?: number }> }>;
    const maximumFor = (id: string, fallback: number) => Number(definitions.find((component) => component.stableId === id)?.weightPoints ?? fallback);
    let components: MissionScoreBreakdownDto["components"];
    let rawActiveTotal: number;
    if (stableId === "M1") {
      const result = await this.calculateMissionOneBreakdown(missionAttemptId, effective);
      components = [
        { stableId: "SCAN", earned: result.scan, maximum: maximumFor("SCAN", 8), status: "ACTIVE" },
        { stableId: "CARDS", earned: result.cards, maximum: maximumFor("CARDS", 72), status: "ACTIVE" },
        { stableId: "BOUNDARY", earned: result.boundary, maximum: maximumFor("BOUNDARY", 10), status: "ACTIVE" },
        { stableId: "REASONING_ASSISTANCE", earned: result.reasoning, maximum: maximumFor("REASONING_ASSISTANCE", 10), status: "ACTIVE" }
      ];
      rawActiveTotal = result.total;
    } else if (stableId === "M5") {
      const result = await this.calculateMissionFiveBreakdown(missionAttemptId);
      components = [
        { stableId: "COMPLIANCE", earned: result.compliance, maximum: maximumFor("COMPLIANCE", 40), status: "ACTIVE" },
        { stableId: "COST_LOGIC", earned: result.costLogic, maximum: maximumFor("COST_LOGIC", 30), status: "ACTIVE" },
        { stableId: "POSITION", earned: result.position, maximum: maximumFor("POSITION", 20), status: "ACTIVE" },
        { stableId: "REASONING", earned: result.reasoning, maximum: maximumFor("REASONING", 10), status: "ACTIVE" }
      ];
      rawActiveTotal = result.total;
    } else if (stableId === "M6") {
      const result = await this.calculateMissionSixBreakdown(missionAttemptId, effective);
      components = [
        { stableId: "ROUND_1_POLICY_SHOCK", earned: result.round1, maximum: maximumFor("ROUND_1_POLICY_SHOCK", 50), status: "ACTIVE" },
        { stableId: "ROUND_2_TECHNOLOGY_SHOCK", earned: result.round2, maximum: maximumFor("ROUND_2_TECHNOLOGY_SHOCK", 25), status: "ACTIVE" },
        { stableId: "ROUND_3_INTEGRATED", earned: result.round3, maximum: maximumFor("ROUND_3_INTEGRATED", 25), status: "ACTIVE" }
      ];
      rawActiveTotal = result.total;
    } else {
      const scores = new Map(missionAttempt.questionResults.map((result) => [result.question.stableId, effective && result.adjustmentStream?.currentAdjustment ? Number(result.adjustmentStream.currentAdjustment.adjustedScore) : Number(result.systemScore ?? 0)]));
      const result = configuredMissionBreakdown(definitions, scores);
      components = result.components;
      rawActiveTotal = result.total;
    }
    const activeMaximum = components.filter((component) => component.status === "ACTIVE").reduce((sum, component) => sum + component.maximum, 0);
    const normalization = (config.completionPolicy as { missionScoreNormalization?: { activeRawMax?: number; targetMax?: number } }).missionScoreNormalization;
    const normalizedTotal = stableId === "M3" && normalization?.targetMax === 100 ? normalizeActiveMissionScore(rawActiveTotal, Number(normalization.activeRawMax)) : rawActiveTotal;
    return { missionStableId: stableId, components, rawActiveTotal, rawActiveMaximum: activeMaximum, normalizedTotal, normalizedMaximum: 100, normalizationApplied: stableId === "M3" && normalization?.targetMax === 100 };
  }

  async calculateFinalResult(attemptId: string, includeFinalOverride = true) {
    const attempt = await this.prisma.attempt.findUniqueOrThrow({
      where: { id: attemptId },
      include: { adjustmentStream: { include: { currentAdjustment: true } }, missionAttempts: { where: { status: "COMPLETED" }, include: { mission: true } } }
    });
    const byMission = new Map(attempt.missionAttempts.map((missionAttempt) => [missionAttempt.mission.stableId, missionAttempt]));
    const orderedIds = ["M1", "M2", "M3", "M4", "M5", "M6"] as const;
    if (!orderedIds.every((stableId) => byMission.has(stableId))) return null;
    const missionScores = Object.fromEntries(await Promise.all(orderedIds.map(async (stableId) => [stableId, await this.calculateMission(byMission.get(stableId)!.id, true)] as const)));
    const contentVersionId = byMission.get("M1")!.mission.contentVersionId;
    const game = await this.prisma.gameScoringConfig.findUniqueOrThrow({ where: { contentVersionId } });
    const weights = game.missionWeights as Record<string, number>;
    const summary = summarizeCarbonMarketIq(missionScores, weights);
    if (!summary) return null;
    const finalOverride = includeFinalOverride && attempt.adjustmentStream?.currentAdjustment ? Number(attempt.adjustmentStream.currentAdjustment.adjustedScore) : null;
    const m6RoundBreakdown = await this.calculateMissionSixBreakdown(byMission.get("M6")!.id, true);
    return {
      ...summary,
      systemScore: attempt.systemTotalScore === null ? summary.calculatedScore : Number(attempt.systemTotalScore),
      effectiveScore: finalOverride ?? summary.calculatedScore,
      finalOverride,
      missionScores,
      weights,
      m6RoundBreakdown
    };
  }

  async calculateMissionFiveBreakdown(missionAttemptId: string) {
    const missionAttempt = await this.prisma.missionAttempt.findUniqueOrThrow({
      where: { id: missionAttemptId },
      include: {
        mission: true,
        questionResults: {
          where: { status: "FINALIZED", question: { stableId: { in: ["M5-Q02", "M5-Q03", "M5-Q04"] } } },
          include: { question: { select: { stableId: true } }, selectedAttempt: { select: { studentAnswer: true, evaluatedResult: true, resolutionMode: true } } }
        }
      }
    });
    if (missionAttempt.mission.stableId !== "M5") throw new Error("Mission 5 rubric requested for a different Mission");
    const screen = await this.prisma.missionScreenTemplate.findFirstOrThrow({ where: { missionTemplateId: missionAttempt.missionTemplateId, stableId: "M5-S01" } });
    const answerFor = (stableId: string): unknown => {
      const selected = missionAttempt.questionResults.find((result) => result.question.stableId === stableId)?.selectedAttempt;
      if (!selected) throw new Error(`${stableId} must be finalized before Mission 5 scoring`);
      return selected.resolutionMode === "REVEALED" ? (selected.evaluatedResult as { answer?: unknown } | null)?.answer : selected.studentAnswer;
    };
    const selectedProjects = answerFor("M5-Q02");
    const decision = answerFor("M5-Q03");
    const reasoning = answerFor("M5-Q04");
    if (!Array.isArray(selectedProjects) || !decision || typeof decision !== "object" || typeof reasoning !== "string") throw new Error("Mission 5 selected evidence is invalid");
    return scoreMissionFive(screen.inputConfig as unknown as MissionFiveScenario, selectedProjects.map(String), decision as MissionFiveDecision, reasoning);
  }

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
    return (await this.calculateMissionOneBreakdown(missionAttemptId, effective)).total;
  }

  async calculateMissionOneBreakdown(missionAttemptId: string, effective = false) {
    const missionAttempt = await this.prisma.missionAttempt.findUniqueOrThrow({
      where: { id: missionAttemptId },
      include: { mission: true, questionResults: { where: { status: "FINALIZED" }, include: { question: true, adjustmentStream: { include: { currentAdjustment: true } } } } }
    });
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
    return missionOneBreakdown({
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
