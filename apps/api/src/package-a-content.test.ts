import { describe, expect, it } from "vitest";
import { packageAActivities, packageAMissionThreeQuestions, packageAMissionTwoQuestions } from "../prisma/package-a-content";

const answer = (question: { answerRule: unknown }) => (question.answerRule as { answer?: unknown }).answer;

describe("Package A versioned Mission 2 content", () => {
  const questions = packageAMissionTwoQuestions();
  it("contains the five authoritative calculations and percentage tolerance", () => {
    expect(questions.filter((q) => /^M2-Q1[1-5]$/.test(q.stableId)).map((q) => answer(q))).toEqual([250, 53.6, 320, 9, 6]);
    expect(questions.filter((q) => /^M2-Q1[1-5]$/.test(q.stableId)).every((q) => (q.answerRule as { tolerancePercent?: number }).tolerancePercent === 0.5)).toBe(true);
  });
  it("derives canonical Scope totals and identifies Cotton while rejecting hotspot equals easiest", () => {
    const totals = packageAActivities.reduce<Record<string, number>>((sum, item) => ({ ...sum, [item.scope]: (sum[item.scope] ?? 0) + item.result }), {});
    expect(totals).toEqual({ "Scope 1": 53.6, "Scope 2": 250, "Scope 3": 335 });
    expect(Object.values(totals).reduce((sum, value) => sum + value, 0)).toBe(638.6);
    expect(answer(questions.find((q) => q.stableId === "M2-Q16")!)).toBe("Cotton");
    expect(answer(questions.find((q) => q.stableId === "M2-Q17")!)).toBe("No");
  });
  it("labels authored datasets as simulations", () => expect(questions.every((q) => q.isSimulation)).toBe(true));
});

describe("Package A versioned Mission 3 content", () => {
  const questions = packageAMissionThreeQuestions();
  it("contains all authoritative classification keys", () => {
    expect(questions.slice(0, 6).map(answer)).toEqual(["Carbon Tax", "ETS Allowance", "Carbon Credit", "ETS Allowance", "Carbon Credit", "Carbon Tax"]);
    expect(questions.slice(10, 13).map(answer)).toEqual(["Carbon Tax", "ETS Allowance", "Carbon Credit"]);
  });
  it("contains the exact ETS gap, allowance cost and credit cap", () => expect(questions.slice(6, 9).map(answer)).toEqual([20000, 1300000, 6000]));
  it("stores the deterministic strategy inputs and simulation labels", () => {
    const strategy = questions.find((q) => q.stableId === "M3-Q10")!;
    expect(strategy.answerRule).toMatchObject({ mode: "STRATEGY", rubricRef: "M3_LOWEST_COST_COMPLIANCE", rubric: { shortage: 20000, availableReduction: 8000, mac: 40, allowancePrice: 65 } });
    expect(questions.filter((q) => /^M3-Q(0[7-9]|10)$/.test(q.stableId)).every((q) => q.isSimulation)).toBe(true);
  });
});
