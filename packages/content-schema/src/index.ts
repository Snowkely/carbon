import { z } from "zod";
export const questionTypeSchema = z.enum(["TAP", "DRAG", "ORDER", "SC", "MC", "NUM", "SLIDER", "DECISION", "REFLECTION"]);
export const answerModeSchema = z.enum(["EXACT", "MULTI_EXACT", "NUMERIC", "STRATEGY"]);
export const answerRuleSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("EXACT"), answer: z.union([z.string(), z.array(z.string()), z.record(z.unknown())]) }),
  z.object({ mode: z.literal("MULTI_EXACT"), answer: z.array(z.string()) }),
  z.object({ mode: z.literal("NUMERIC"), answer: z.number(), tolerance: z.number().nonnegative().optional(), tolerancePercent: z.number().nonnegative().optional() }),
  z.object({ mode: z.literal("STRATEGY"), rubricRef: z.string(), rubric: z.record(z.unknown()) })
]);
export const retryPolicySchema = z.object({ maxIndependentAttempts: z.number().int().positive(), factors: z.array(z.number().min(0).max(1)).min(1), selection: z.literal("FIRST_CORRECT") });
export const assistancePolicySchema = z.object({ noHint: z.number().nonnegative(), hintUsed: z.number().nonnegative(), reveal: z.number().nonnegative() });
export const revealPolicySchema = z.object({ afterFailures: z.number().int().positive(), factor: z.number().min(0).max(1) });
export const missionComponentSchema = z.object({ stableId: z.string(), weightPoints: z.number().positive(), normalization: z.enum(["PROPORTIONAL", "DIRECT", "TABLE"]), contributions: z.array(z.object({ sourceType: z.enum(["QUESTION_RESULT", "ACTIVITY_COMPLETION", "STRATEGY_DIMENSION", "BONUS_RULE"]), sourceRef: z.string(), rawMax: z.number().positive() })) });
export type AnswerRule = z.infer<typeof answerRuleSchema>;
export type RetryPolicy = z.infer<typeof retryPolicySchema>;
