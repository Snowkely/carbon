import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateAnswer, scoreMissionSix } from "@carbon/game-rules";
import { packageCMissionSixComponents, packageCMissionSixQuestions, packageCMissionSixScenario, packageCMissionSixScreens, packageCMissionThreeNormalization, packageCMissionWeights } from "../prisma/package-c-content";

describe("Package C immutable content", () => {
  const questions = packageCMissionSixQuestions();
  const byId = (stableId: string) => questions.find((question) => question.stableId === stableId)!;

  it("publishes additively from the B2 hotfix with all six Missions implemented", () => {
    const source = readFileSync(resolve(process.cwd(), "prisma/package-c-content.ts"), "utf8");
    expect(source).toContain('targetCode = "v5.4-package-c"');
    expect(source).toContain('versionCode: "v5.3.1-package-b2-hotfix"');
    expect(source).toContain('implemented: ["M1", "M2", "M3", "M4", "M5", "M6"]');
    expect(source).not.toContain("workshop.update");
  });

  it("contains exactly three fixed M6 rounds and no random selection", () => {
    expect(packageCMissionSixScreens.map((screen) => screen.stableId)).toEqual(["M6-S01", "M6-S02", "M6-S03"]);
    expect(readFileSync(resolve(process.cwd(), "prisma/package-c-content.ts"), "utf8")).not.toMatch(/Math\.random|random event/i);
  });

  it("freezes both complete causal chains", () => {
    expect(["M6-Q01", "M6-Q02", "M6-Q03"].map((id) => (byId(id).answerRule as { answer: string }).answer)).toEqual(["Supply decreases", "Scarcity increases", "Upward price pressure"]);
    expect(["M6-Q11", "M6-Q12", "M6-Q13", "M6-Q14"].map((id) => (byId(id).answerRule as { answer: string }).answer)).toEqual(["MAC decreases", "Abatement increases", "Allowance demand decreases", "Downward price pressure"]);
    expect(byId("M6-Q01").explanation).toContain("Cap decreases → Allowance Supply decreases → Scarcity increases → Upward price pressure");
  });

  it("keeps Q04 required but numerically unmapped", () => {
    expect(byId("M6-Q04")).toMatchObject({ mode: "STRATEGY", baseScore: 0 });
    expect(packageCMissionSixComponents.flatMap((component) => component.contributions).some((entry) => entry.sourceRef === "M6-Q04")).toBe(false);
  });

  it("uses MAC 45, EUA 75, a clean 30/tCO2e difference and deterministic strategy", () => {
    expect(packageCMissionSixScenario).toMatchObject({ mac: 45, allowancePrice: 75, marginalAdvantage: 30, feasibleReductionCapacityExists: true });
    expect(45).toBeLessThan(75);
    expect(75 - 45).toBe(30);
    expect((byId("M6-Q21").answerRule as { answer: string }).answer).toBe("MAC < EUA");
    expect((byId("M6-Q22").answerRule as { answer: string }).answer).toContain("€30/tCO2e advantage");
    expect(evaluateAnswer(byId("M6-Q23").answerRule as any, "Reduce / Invest")).toMatchObject({ correct: true, details: { evidenceScore: 20 } });
  });

  it("normalizes M6 to exact 50/25/25 with no legacy buckets", () => {
    expect(packageCMissionSixComponents.map((component) => component.weightPoints)).toEqual([50, 25, 25]);
    expect(scoreMissionSix(new Map(questions.map((question) => [question.stableId, question.baseScore])))).toEqual({ round1: 50, round2: 25, round3: 25, total: 100 });
    const source = JSON.stringify(packageCMissionSixComponents);
    expect(source).not.toContain("ASSISTANCE");
    expect(source).not.toContain("BONUS");
  });

  it("makes the M3 bonus explicitly inactive and sets exact final weights", () => {
    expect(packageCMissionThreeNormalization).toEqual({ activeRawMax: 95, targetMax: 100, inactiveComponents: ["BONUS"], bonusStatus: "INACTIVE_UNMAPPED" });
    expect(packageCMissionWeights).toEqual({ M1: .15, M2: .15, M3: .15, M4: .15, M5: .2, M6: .2 });
  });
});
