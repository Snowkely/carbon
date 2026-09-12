import { describe, expect, it, vi } from "vitest";
import { ScoringService } from "./student/scoring.service";

const missions = ["M1", "M2", "M3", "M4", "M5", "M6"].map((stableId) => ({ id: `ma-${stableId}`, status: "COMPLETED", mission: { stableId, contentVersionId: "v-package-c" } }));

describe("Package C final scoring service", () => {
  it("uses all effective Mission scores and lets Final Total Override win", async () => {
    const prisma: any = {
      attempt: { findUniqueOrThrow: vi.fn().mockResolvedValue({ systemTotalScore: 80, missionAttempts: missions, adjustmentStream: { currentAdjustment: { adjustedScore: 91 } } }) },
      gameScoringConfig: { findUniqueOrThrow: vi.fn().mockResolvedValue({ missionWeights: { M1: .15, M2: .15, M3: .15, M4: .15, M5: .2, M6: .2 } }) }
    };
    const scoring = new ScoringService(prisma);
    vi.spyOn(scoring, "calculateMission").mockImplementation(async (id) => ({ "ma-M1": 100, "ma-M2": 90, "ma-M3": 80, "ma-M4": 70, "ma-M5": 60, "ma-M6": 50 }[id] ?? 0));
    vi.spyOn(scoring, "calculateMissionSixBreakdown").mockResolvedValue({ round1: 25, round2: 12.5, round3: 12.5, total: 50 });
    await expect(scoring.calculateFinalResult("attempt-1")).resolves.toMatchObject({ calculatedScore: 73, effectiveScore: 91, finalOverride: 91, topStrength: "M1", conceptToReview: "M6" });
    await expect(scoring.calculateFinalResult("attempt-1", false)).resolves.toMatchObject({ calculatedScore: 73, effectiveScore: 73, finalOverride: null });
  });

  it("returns unavailable until six authoritative completed Mission scores exist", async () => {
    const prisma: any = { attempt: { findUniqueOrThrow: vi.fn().mockResolvedValue({ systemTotalScore: null, missionAttempts: missions.slice(0, 5), adjustmentStream: null }) } };
    await expect(new ScoringService(prisma).calculateFinalResult("attempt-1")).resolves.toBeNull();
    expect(prisma.attempt.findUniqueOrThrow).toHaveBeenCalledOnce();
  });

  it("normalizes Package C M3 only after effective Question Overrides and below Mission Override", async () => {
    const base: any = { id: "ma-M3", missionTemplateId: "m3", mission: { stableId: "M3", contentVersionId: "v-package-c" }, adjustmentStream: null, questionResults: [
      { systemScore: 5, question: { stableId: "Q1" }, adjustmentStream: { currentAdjustment: { adjustedScore: 4 } } },
      { systemScore: 5, question: { stableId: "Q2" }, adjustmentStream: null }
    ] };
    const prisma: any = {
      missionAttempt: { findUniqueOrThrow: vi.fn().mockResolvedValue(base) },
      missionScoringConfig: { findUniqueOrThrow: vi.fn().mockResolvedValue({ componentDefinitions: [{ weightPoints: 95, normalization: "PROPORTIONAL", contributions: [{ sourceType: "QUESTION_RESULT", sourceRef: "Q1", rawMax: 5 }, { sourceType: "QUESTION_RESULT", sourceRef: "Q2", rawMax: 5 }] }], completionPolicy: { missionScoreNormalization: { activeRawMax: 95, targetMax: 100 } } }) }
    };
    const scoring = new ScoringService(prisma);
    expect(await scoring.calculateMission("ma-M3", false)).toBe(100);
    expect(await scoring.calculateMission("ma-M3", true)).toBe(90);
    base.adjustmentStream = { currentAdjustment: { adjustedScore: 77 } };
    expect(await scoring.calculateMission("ma-M3", true)).toBe(77);
  });
});
