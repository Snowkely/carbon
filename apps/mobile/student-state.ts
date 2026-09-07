export type StudentSession = { id: string; workshopName: string };

export type StudentMission = {
  missionTemplateId: string;
  missionStableId: string;
  titleCn: string;
  titleEn: string;
  progressState: string;
  accessState: string;
  reason?: string;
  activeMissionAttemptId?: string;
  capabilities: { canStartAttempt: boolean; canContinueAttempt?: boolean };
};

export type StudentHomeState = { session: StudentSession | null; missions: StudentMission[] };
export type StudentRequest = (path: string, options?: RequestInit) => Promise<unknown>;

export type StudentScreen = "login" | "profile" | "home" | "mission" | "history" | "feedback";

export function initializeStudentRuntime(): { token: null; screen: "login" } {
  return { token: null, screen: "login" };
}

export function screenAfterLogin(profileRequired: boolean): "profile" | "home" {
  return profileRequired ? "profile" : "home";
}

export async function fetchStudentHomeState(request: StudentRequest): Promise<StudentHomeState> {
  const activeResponse = await request("/student/sessions/active");
  const activeSessions = Array.isArray(activeResponse) ? activeResponse as StudentSession[] : [];
  const session = activeSessions[0] ?? null;
  if (!session) return { session: null, missions: [] };
  const missionResponse = await request(`/student/sessions/${session.id}/missions`);
  return { session, missions: Array.isArray(missionResponse) ? missionResponse as StudentMission[] : [] };
}

export function userFacingError(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : "Please check your connection and try again.";
}

export type MissionPresentation =
  | { kind: "ACTION"; label: "START" | "CONTINUE" }
  | { kind: "STATUS"; label: "LOCKED" | "UNCOMPLETED" | "COMING SOON" | "COMPLETED"; tone: "locked" | "neutral" | "comingSoon" | "completed" };

export function missionPresentation(mission: StudentMission): MissionPresentation {
  if (mission.progressState === "COMPLETED") return { kind: "STATUS", label: "COMPLETED", tone: "completed" };
  if (mission.accessState === "ACTIVE_ATTEMPT") return mission.capabilities.canContinueAttempt === false
    ? { kind: "STATUS", label: "COMING SOON", tone: "comingSoon" }
    : { kind: "ACTION", label: "CONTINUE" };
  if (mission.accessState === "AVAILABLE" && mission.progressState === "NOT_STARTED") return mission.capabilities.canStartAttempt
    ? { kind: "ACTION", label: "START" }
    : { kind: "STATUS", label: "COMING SOON", tone: "comingSoon" };
  if (mission.accessState === "BLOCKED_PREREQUISITE") return { kind: "STATUS", label: "UNCOMPLETED", tone: "neutral" };
  return { kind: "STATUS", label: "LOCKED", tone: "locked" };
}

export type HistoryMissionAttempt = {
  id: string;
  status?: string | null;
  systemScore?: number | null;
  completedAt?: string | null;
  mission?: { stableId?: string | null; titleEn?: string | null; titleCn?: string | null } | null;
};

export type HistoryItem = {
  id: string;
  attemptNo?: number | null;
  status?: string | null;
  systemTotalScore?: number | null;
  startedAt?: string | null;
  completedAt?: string | null;
  session?: { id?: string; status?: string | null; workshop?: { id?: string; name?: string | null } | null } | null;
  missionAttempts?: HistoryMissionAttempt[] | null;
};

export function normalizeHistoryPayload(payload: unknown): HistoryItem[] {
  return Array.isArray(payload) ? payload.filter((item): item is HistoryItem => Boolean(item && typeof item === "object" && "id" in item)) : [];
}

export function displayStatus(status?: string | null): string {
  return status ? status.replaceAll("_", " ") : "STATUS UNAVAILABLE";
}

export function displayDate(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
}

export type FeedbackDraft = { selected: Record<string, string>; other: string; suggestion: string };
export const emptyFeedbackDraft = (): FeedbackDraft => ({ selected: {}, other: "", suggestion: "" });

export function isFeedbackComplete(draft: FeedbackDraft): boolean {
  return ["FB-Q01", "FB-Q02", "FB-Q03"].every((id) => Boolean(draft.selected[id]))
    && (draft.selected["FB-Q02"] !== "Other" || Boolean(draft.other.trim()));
}

export function buildFeedbackResponses(questions: Array<{ stableId: string }>, draft: FeedbackDraft) {
  return questions.map((question) => question.stableId === "FB-Q04"
    ? { questionStableId: question.stableId, textResponse: draft.suggestion }
    : { questionStableId: question.stableId, selectedOption: draft.selected[question.stableId], ...(question.stableId === "FB-Q02" && draft.selected[question.stableId] === "Other" ? { otherText: draft.other } : {}) });
}

export function backToStudentHome(): "home" {
  return "home";
}
