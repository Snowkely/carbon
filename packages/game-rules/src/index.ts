import type { AnswerRule } from "@carbon/content-schema";
export type Evaluation = { correct: boolean | null; details: Record<string, unknown> };
const normalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, normalize(item)]));
  return value;
};
const canonical = (value: unknown): string => JSON.stringify(normalize(value));
export function evaluateAnswer(rule: AnswerRule, answer: unknown): Evaluation {
  if (rule.mode === "EXACT") return { correct: canonical(answer) === canonical(rule.answer), details: { mode: rule.mode } };
  if (rule.mode === "MULTI_EXACT") {
    if (!Array.isArray(answer)) return { correct: false, details: { mode: rule.mode } };
    const expected = [...rule.answer].sort(); const actual = [...new Set(answer.map(String))].sort();
    return { correct: canonical(actual) === canonical(expected), details: { mode: rule.mode } };
  }
  if (rule.mode === "NUMERIC") { const numeric = typeof answer === "number" ? answer : Number(answer); return { correct: Number.isFinite(numeric) && Math.abs(numeric - rule.answer) <= rule.tolerance, details: { mode: rule.mode, tolerance: rule.tolerance } }; }
  return { correct: null, details: { mode: rule.mode, rubricRef: rule.rubricRef } };
}
export function retryFactor(attemptNumber: number, factors: readonly number[]): number { return factors[attemptNumber - 1] ?? 0; }
export function candidateScore(baseScore: number, correct: boolean, attemptNumber: number, factors: readonly number[]): number { return correct ? baseScore * retryFactor(attemptNumber, factors) : 0; }
export type MissionOnePolicy = { explorationPoints: number; boundaryRawMax: number; boundaryWeight: number; reflectionPoints: number; assistance: { noHint: number; hintUsed: number; reveal: number } };
export function assistanceBonus(hintUsed: boolean, revealUsed: boolean, policy: MissionOnePolicy["assistance"]): number { return revealUsed ? policy.reveal : hintUsed ? policy.hintUsed : policy.noHint; }
export function proportionalComponent(rawEarned: number, rawMax: number, weight: number): number { if (rawMax <= 0) throw new Error("rawMax must be positive"); return Math.max(0, Math.min(weight, (rawEarned / rawMax) * weight)); }
export function missionOneScore(input: { explorationComplete: boolean; q01: number; cardScores: number[]; boundaryScores: number[]; reflectionComplete: boolean; hintUsed: boolean; revealUsed: boolean }, policy: MissionOnePolicy): number {
  const scan = (input.explorationComplete ? policy.explorationPoints : 0) + input.q01;
  const cards = input.cardScores.reduce((sum, value) => sum + value, 0);
  const boundary = proportionalComponent(input.boundaryScores.reduce((sum, value) => sum + value, 0), policy.boundaryRawMax, policy.boundaryWeight);
  const reasoning = (input.reflectionComplete ? policy.reflectionPoints : 0) + assistanceBonus(input.hintUsed, input.revealUsed, policy.assistance);
  return Math.round((scan + cards + boundary + reasoning) * 100) / 100;
}
export function carbonMarketIq(scores: readonly number[], weights: readonly number[]): number | null { if (scores.length !== 6 || weights.length !== 6 || scores.some((score) => !Number.isFinite(score)) || Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 1) > 1e-9) return null; return Math.round(scores.reduce((sum, score, index) => sum + score * (weights[index] ?? 0), 0) * 100) / 100; }
