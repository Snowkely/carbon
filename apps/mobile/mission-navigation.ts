export type MissionOpenCandidate = {
  accessState: string;
  activeMissionAttemptId?: string;
  capabilities: { canStartAttempt: boolean };
};

export type MissionOpenAction =
  | { kind: "START" }
  | { kind: "RESUME"; missionAttemptId: string }
  | { kind: "BLOCKED" };

export type MissionNavigationTarget = {
  screen: "home" | "mission";
  missionAttemptId: string;
};

export function resolveMissionOpen(mission: MissionOpenCandidate): MissionOpenAction {
  if (mission.accessState === "ACTIVE_ATTEMPT" && mission.activeMissionAttemptId) {
    return { kind: "RESUME", missionAttemptId: mission.activeMissionAttemptId };
  }
  if (mission.capabilities.canStartAttempt) return { kind: "START" };
  return { kind: "BLOCKED" };
}

export function backToHomeFromMission(missionAttemptId: string): MissionNavigationTarget {
  return { screen: "home", missionAttemptId };
}

export function resumeMission(missionAttemptId: string): MissionNavigationTarget {
  return { screen: "mission", missionAttemptId };
}

export function missionNavigationKey(missionAttemptId: string, screenStableId?: string | null, questionStableId?: string | null): string | null {
  return screenStableId ? [missionAttemptId, screenStableId, questionStableId ?? ""].join(":") : null;
}

export function updateMissionScrollPosition(previousKey: string | null, nextKey: string | null, scrollToTop: () => void): string | null {
  if (previousKey && nextKey && previousKey !== nextKey) scrollToTop();
  return nextKey ?? previousKey;
}
