import { z } from "zod";

export const accountTypeSchema = z.enum(["STUDENT", "TEACHER"]);
export const workshopRoleSchema = z.enum(["OWNER", "INSTRUCTOR", "VIEWER"]);
export const progressStateSchema = z.enum(["NOT_STARTED", "IN_PROGRESS", "COMPLETED"]);
export const accessStateSchema = z.enum(["AVAILABLE", "BLOCKED_SESSION_INACTIVE", "BLOCKED_SESSION_UNLOCK", "BLOCKED_PREREQUISITE", "ACTIVE_ATTEMPT", "COMPLETED_READ_ONLY"]);
export const loginSchema = z.object({ username: z.string().trim().min(3).max(80), password: z.string().min(8).max(128) });
export const registerSchema = loginSchema.extend({ accountType: accountTypeSchema });
export const profileSchema = z.object({ name: z.string().trim().min(1).max(150), studentId: z.string().trim().min(1).max(100), schoolId: z.string().uuid(), classId: z.string().uuid() });
export const answerSubmissionSchema = z.object({ clientSubmissionId: z.string().uuid(), answer: z.unknown(), timeSpentMs: z.number().int().min(0).max(86_400_000) }).strict();
export const reflectionSchema = z.object({ response: z.string().transform((value) => value.trim()).pipe(z.string().min(1).max(4000)) });
export const scoreAdjustmentStreamVersionSchema = z.number().int().nonnegative().safe();
export const feedbackResponseSchema = z.object({
  questionStableId: z.enum(["FB-Q01", "FB-Q02", "FB-Q03", "FB-Q04"]),
  selectedOption: z.string().max(300).optional(),
  otherText: z.string().max(2000).optional(),
  textResponse: z.string().max(4000).optional()
}).strict();
export const feedbackSubmissionSchema = z.object({ responses: z.array(feedbackResponseSchema).length(4) }).strict().superRefine((value, context) => {
  const byId = new Map(value.responses.map((response) => [response.questionStableId, response]));
  for (const stableId of ["FB-Q01", "FB-Q02", "FB-Q03", "FB-Q04"] as const) if (!byId.has(stableId)) context.addIssue({ code: z.ZodIssueCode.custom, message: `${stableId} is required`, path: ["responses"] });
  for (const stableId of ["FB-Q01", "FB-Q02", "FB-Q03"] as const) if (!byId.get(stableId)?.selectedOption) context.addIssue({ code: z.ZodIssueCode.custom, message: `${stableId} requires one selected option`, path: ["responses"] });
  for (const stableId of ["FB-Q01", "FB-Q02", "FB-Q03"] as const) if (byId.get(stableId)?.textResponse) context.addIssue({ code: z.ZodIssueCode.custom, message: `${stableId} is single choice`, path: ["responses"] });
  const q2 = byId.get("FB-Q02");
  if (q2?.selectedOption === "Other" && !q2.otherText?.trim()) context.addIssue({ code: z.ZodIssueCode.custom, message: "FB-Q02 Other requires non-empty otherText", path: ["responses"] });
  for (const response of value.responses) if (response.otherText?.trim() && !(response.questionStableId === "FB-Q02" && response.selectedOption === "Other")) context.addIssue({ code: z.ZodIssueCode.custom, message: "otherText is valid only for FB-Q02 Other", path: ["responses"] });
  const q4 = byId.get("FB-Q04");
  if (q4?.selectedOption || q4?.otherText) context.addIssue({ code: z.ZodIssueCode.custom, message: "FB-Q04 is open text", path: ["responses"] });
});
export type AccountType = z.infer<typeof accountTypeSchema>;
export type WorkshopRole = z.infer<typeof workshopRoleSchema>;
export type ProgressState = z.infer<typeof progressStateSchema>;
export type AccessState = z.infer<typeof accessStateSchema>;
export type ScoreAdjustmentStreamVersion = z.infer<typeof scoreAdjustmentStreamVersionSchema>;
export type FeedbackSubmissionInput = z.infer<typeof feedbackSubmissionSchema>;
export interface ApiErrorBody { error: { code: string; message: string; requestId?: string; details?: Record<string, unknown> }; }
export interface MissionAccessDto {
  missionTemplateId: string; missionStableId: string; titleCn: string; titleEn: string;
  sessionUnlock: { state: "LOCKED_FOR_SESSION" | "UNLOCKED_FOR_SESSION"; source?: "INITIAL" | "TEACHER" };
  progressState: ProgressState; accessState: AccessState; reason?: string;
  activeMissionAttemptId?: string;
  capabilities: { canStartAttempt: boolean; canContinueAttempt: boolean; canSubmitAnswer: boolean };
}
export interface SafeQuestionDto { questionTemplateId: string; stableId: string; type: string; promptCn: string; promptEn: string; options: unknown; baseScore: number; attemptsUsed: number; revealAvailable: boolean; finalized: boolean; }

export type MissionScoreComponentStatus = "ACTIVE" | "INACTIVE_UNMAPPED";
export interface MissionScoreComponentDto {
  stableId: string;
  earned: number | null;
  maximum: number;
  status: MissionScoreComponentStatus;
}
export interface MissionScoreBreakdownDto {
  missionStableId: string;
  components: MissionScoreComponentDto[];
  rawActiveTotal: number;
  rawActiveMaximum: number;
  normalizedTotal: number;
  normalizedMaximum: 100;
  normalizationApplied: boolean;
}

const missionScoreComponentLabels: Record<string, string> = {
  SCAN: "Scan", CARDS: "Cards", BOUNDARY: "Boundary", REASONING_ASSISTANCE: "Reasoning / Low-hint",
  UNIT_MATCHING: "Unit", FACTOR_MATCHING: "Factor", CALCULATION: "Calculation", HOTSPOT_REASONING: "Hotspot",
  COMPANY_COMPARISON: "Company Comparison", INTENSITY_REASONING: "Intensity", CONCEPT: "Concept", CASES: "Cases",
  MISCONCEPTION_CHALLENGE: "Misconception", BONUS: "Bonus", PROCESS: "Process", POSITION_CALCULATION: "Position",
  TRADE: "Trade", COMPLIANCE_REASONING: "Compliance", COMPLIANCE: "Compliance", COST_LOGIC: "Cost Logic",
  POSITION: "Position", REASONING: "Reasoning", ROUND_1_POLICY_SHOCK: "Round 1 Policy Shock",
  ROUND_2_TECHNOLOGY_SHOCK: "Round 2 Technology Shock", ROUND_3_INTEGRATED: "Round 3 Integrated"
};
export function missionScoreComponentLabel(stableId: string): string {
  return missionScoreComponentLabels[stableId] ?? stableId.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export type UnauthorizedCoordinator = {
  notify(showConfirmation: (confirm: () => void) => void, onConfirmed: () => void | Promise<void>): boolean;
  reset(): void;
};
export function createUnauthorizedCoordinator(): UnauthorizedCoordinator {
  let state: "READY" | "PROMPTING" | "CONFIRMED" = "READY";
  return {
    notify(showConfirmation, onConfirmed) {
      if (state !== "READY") return false;
      state = "PROMPTING";
      showConfirmation(() => {
        if (state !== "PROMPTING") return;
        state = "CONFIRMED";
        void onConfirmed();
      });
      return true;
    },
    reset() { state = "READY"; }
  };
}
