import { describe, expect, it } from "vitest";
import { assistanceBonus, candidateScore, carbonMarketIq, evaluateAnswer, missionOneScore, proportionalComponent } from "./index.js";
describe("question evaluation", () => {
  it("evaluates exact, nested exact, multi-exact and numeric rules", () => {
    expect(evaluateAnswer({ mode: "EXACT", answer: "Scope 1" }, "Scope 1").correct).toBe(true);
    expect(evaluateAnswer({ mode: "EXACT", answer: { before: "Scope 3", after: "Scope 1" } }, { after: "Scope 1", before: "Scope 3" }).correct).toBe(true);
    expect(evaluateAnswer({ mode: "MULTI_EXACT", answer: ["A", "B"] }, ["B", "A"]).correct).toBe(true);
    expect(evaluateAnswer({ mode: "MULTI_EXACT", answer: ["A", "B"] }, ["A", "A"]).correct).toBe(false);
    expect(evaluateAnswer({ mode: "NUMERIC", answer: 100, tolerance: 0.5 }, 100.4).correct).toBe(true);
  });
  it("applies the supplied versioned retry factors and rejects a fourth independent score", () => { const factors=[1,0.9,0.8]; expect(candidateScore(8, true, 1, factors)).toBe(8); expect(candidateScore(8, true, 2, factors)).toBe(7.2); expect(candidateScore(8, true, 3, factors)).toBe(6.4); expect(candidateScore(8, true, 4, factors)).toBe(0); expect(candidateScore(8, false, 1, factors)).toBe(0); });
});
describe("M1 scoring", () => {
  const policy = { explorationPoints: 3, boundaryRawMax: 21, boundaryWeight: 10, reflectionPoints: 2, assistance: { noHint: 8, hintUsed: 6, reveal: 0 } };
  it("scores a perfect mission as 100", () => { expect(missionOneScore({ explorationComplete: true, q01: 5, cardScores: Array(12).fill(6), boundaryScores: [8, 5, 8], reflectionComplete: true, hintUsed: false, revealUsed: false }, policy)).toBe(100); });
  it("normalizes boundary without intermediate rounding", () => { expect(proportionalComponent(10.5, 21, 10)).toBe(5); expect(proportionalComponent(8, 21, 10)).toBeCloseTo(3.8095238095238093, 12); });
  it("uses the single Hint policy", () => { expect(assistanceBonus(false, false, policy.assistance)).toBe(8); expect(assistanceBonus(true, false, policy.assistance)).toBe(6); });
  it("makes any reveal zero the assistance bonus", () => expect(assistanceBonus(false, true, policy.assistance)).toBe(0));
  it("awards exactly three exploration points", () => {
    const common = { q01: 0, cardScores: Array(12).fill(0), boundaryScores: [0,0,0], reflectionComplete: false, hintUsed: true, revealUsed: false };
    expect(missionOneScore({ ...common, explorationComplete: true }, policy) - missionOneScore({ ...common, explorationComplete: false }, policy)).toBe(3);
  });
  it("permits a completed evidence set to have a low score", () => expect(missionOneScore({ explorationComplete: true, q01: 0, cardScores: Array(12).fill(0), boundaryScores: [0,0,0], reflectionComplete: true, hintUsed: true, revealUsed: true }, policy)).toBe(5));
});
describe("Carbon Market IQ", () => {
  const weights = [0.15, 0.15, 0.15, 0.15, 0.2, 0.2];
  it("uses the final frozen weights", () => expect(carbonMarketIq([85.76, 80, 70, 75, 88, 92], weights)).toBe(82.61));
  it("does not fake missing scores", () => expect(carbonMarketIq([100], weights)).toBeNull());
});
