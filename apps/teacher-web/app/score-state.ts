export type TeacherRole = "OWNER" | "INSTRUCTOR" | "VIEWER";
export type ScoreLevel = "QUESTION" | "MISSION" | "FINAL_TOTAL";

export type AdjustmentTarget = {
  level: ScoreLevel;
  id: string;
  systemScore: number;
  maximum: number;
  expectedAdjustmentId: string | null;
  label: string;
};

export type GradebookSelection = {
  missionAttemptId: string;
  questionResultId: string | null;
};

export function canAdjustScores(role: string | null): boolean {
  return role === "OWNER" || role === "INSTRUCTOR";
}

export function canAdjustScoresOnPage(gradebook: boolean, role: string | null): boolean {
  return gradebook && canAdjustScores(role);
}

export function scorePagePolicy(gradebook: boolean, role: string | null) {
  const canCreateAdjustments = canAdjustScoresOnPage(gradebook, role);
  return {
    readOnly: !gradebook,
    canAdjustQuestion: canCreateAdjustments,
    canAdjustMission: canCreateAdjustments,
    canAdjustFinalTotal: canCreateAdjustments,
    showFinalScoreSection: true
  };
}

export function navigateToGradebook(
  setSelection: (selection: GradebookSelection) => void,
  setView: (view: "Gradebook") => void,
  selection: GradebookSelection
): void {
  setSelection(selection);
  setView("Gradebook");
}

export function friendlyMissionStatus(status: string): string {
  if (status === "COMPLETED") return "Completed";
  if (status === "IN_PROGRESS") return "In progress";
  return "Not started";
}

export function friendlyQuestionResolution(status: string, mode?: string | null): string {
  if (status !== "FINALIZED") return "Pending";
  if (mode === "INDEPENDENT") return "Resolved independently";
  if (mode === "REVEALED") return "Revealed";
  return "Resolved";
}

export function friendlyAttemptMode(mode?: string | null): string {
  if (mode === "INDEPENDENT") return "Independent attempt";
  if (mode === "REVEALED") return "Reveal";
  return mode ? "Submitted" : "—";
}

export function currentOverride(stream: any): number | null {
  return stream?.currentAdjustment ? Number(stream.currentAdjustment.adjustedScore) : null;
}

export function effectiveQuestionScore(result: any): number | null {
  const override = currentOverride(result.adjustmentStream);
  if (override !== null) return override;
  return result.systemScore === null || result.systemScore === undefined ? null : Number(result.systemScore);
}

export function effectiveMissionScore(mission: any): number | null {
  const missionOverride = currentOverride(mission.adjustmentStream);
  if (missionOverride !== null) return missionOverride;
  if (mission.questionAdjustedScore !== null && mission.questionAdjustedScore !== undefined) return Number(mission.questionAdjustedScore);
  return mission.systemScore === null || mission.systemScore === undefined ? null : Number(mission.systemScore);
}

export function effectiveFinalScore(attempt: any): number | null {
  const finalOverride = currentOverride(attempt.adjustmentStream);
  if (finalOverride !== null) return finalOverride;
  if (attempt.calculatedFinalScore !== null && attempt.calculatedFinalScore !== undefined) return Number(attempt.calculatedFinalScore);
  return attempt.systemTotalScore === null || attempt.systemTotalScore === undefined ? null : Number(attempt.systemTotalScore);
}

export function findQuestionResult(questionResults: any[], questionResultId: string): any | null {
  return questionResults.find((result) => result.id === questionResultId) ?? null;
}

export const SCORE_PRECEDENCE_LABELS = [
  "Final total override",
  "Mission override",
  "Question override",
  "System score"
] as const;

export function adjustmentLevelLabel(level: ScoreLevel): string {
  if (level === "QUESTION") return "Question";
  if (level === "MISSION") return "Mission";
  return "Final Total";
}

export function adjustmentInputLabel(level: ScoreLevel): string {
  if (level === "MISSION") return "Adjusted Mission Score";
  if (level === "FINAL_TOTAL") return "Adjusted Final Total";
  return "Adjusted score";
}
