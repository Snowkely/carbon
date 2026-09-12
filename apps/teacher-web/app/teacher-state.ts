export type TeacherMissionControlItem = {
  missionTemplateId: string;
  stableId: string;
  unlockState: string;
  gameplayImplemented?: boolean;
};

const PACKAGE_C_GAMEPLAY_IMPLEMENTED: Readonly<Record<string, boolean>> = {
  M1: true,
  M2: true,
  M3: true,
  M4: true,
  M5: true,
  M6: true
};

export function initializeTeacherRuntime(): { token: null } {
  return { token: null };
}

export function teacherMissionPresentation(mission: TeacherMissionControlItem, sessionStatus: string) {
  const teacherUnlockable = /^M[2-6]$/.test(mission.stableId);
  const canUnlock = teacherUnlockable && mission.unlockState === "LOCKED_FOR_SESSION" && sessionStatus === "ACTIVE";
  const isUnlocked = mission.unlockState === "UNLOCKED_FOR_SESSION";
  const gameplayDeferred = !(mission.gameplayImplemented ?? PACKAGE_C_GAMEPLAY_IMPLEMENTED[mission.stableId] ?? false);
  return {
    unlockStatusLabel: isUnlocked ? "Unlocked" : "Locked",
    unlockStatusTone: isUnlocked ? "unlocked" : "locked",
    canUnlock,
    unlockLabel: canUnlock ? `Unlock ${mission.stableId}` : null,
    gameplayDeferred,
    gameplayStatusLabel: gameplayDeferred ? "Coming soon" : null
  };
}

export function teacherMissionUnlockMessage(stableId: string): string {
  return `Mission ${stableId.replace(/^M/, "")} unlocked.`;
}

export async function fetchTeacherDashboard<T extends { status: string }>(request: (path: string) => Promise<T[]>): Promise<T[]> {
  const workshops = await request("/teacher/dashboard");
  return workshops.filter((workshop) => workshop.status !== "ARCHIVED");
}

export function unlockTeacherMission(request: (path: string, options?: RequestInit) => Promise<unknown>, sessionId: string, missionTemplateId: string) {
  return request(`/teacher/sessions/${sessionId}/missions/${missionTemplateId}/unlock`, { method: "POST" });
}

export function rosterLoadPresentation(loading: boolean, error: string | null, rowCount: number) {
  return {
    showLoading: loading,
    showError: !loading && Boolean(error),
    showData: !loading && !error,
    showEmpty: !loading && !error && rowCount === 0
  };
}
