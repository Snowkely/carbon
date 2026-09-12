import { describe, expect, it } from "vitest";
import { backToHomeFromMission, missionNavigationKey, resolveMissionOpen, resumeMission, updateMissionScrollPosition } from "./mission-navigation";
import { vi } from "vitest";

describe("Mission navigation", () => {
  it("returns to the Mission Map without changing or completing the active attempt", () => {
    const persistedMissionState = {
      status: "IN_PROGRESS",
      currentScreen: "M1-S02",
      viewedNodes: ["Dyeing"],
      questionAttempts: [{ id: "qa-1", questionId: "M1-Q01" }],
      questionResults: [{ id: "qr-1", status: "FINALIZED" }]
    };
    const before = JSON.stringify(persistedMissionState);

    expect(backToHomeFromMission("mission-attempt-1")).toEqual({
      screen: "home",
      missionAttemptId: "mission-attempt-1"
    });
    expect(JSON.stringify(persistedMissionState)).toBe(before);
    expect(persistedMissionState.status).toBe("IN_PROGRESS");
  });

  it("resolves an IN_PROGRESS Mission to resume rather than start", () => {
    const action = resolveMissionOpen({
      accessState: "ACTIVE_ATTEMPT",
      activeMissionAttemptId: "mission-attempt-1",
      capabilities: { canStartAttempt: false }
    });

    expect(action).toEqual({ kind: "RESUME", missionAttemptId: "mission-attempt-1" });
    expect(action.kind).not.toBe("START");
    expect(resumeMission("mission-attempt-1")).toEqual({ screen: "mission", missionAttemptId: "mission-attempt-1" });
  });

  it("starts only when the Mission has no active attempt and canStartAttempt is true", () => {
    expect(resolveMissionOpen({ accessState: "AVAILABLE", capabilities: { canStartAttempt: true } })).toEqual({ kind: "START" });
    expect(resolveMissionOpen({ accessState: "BLOCKED_SESSION_INACTIVE", capabilities: { canStartAttempt: false } })).toEqual({ kind: "BLOCKED" });
  });

  it("scrolls exactly once when the active screen or question changes", () => {
    const scroll = vi.fn(); let previous: string | null = null;
    const first = missionNavigationKey("ma1", "M3-S01", "M3-Q01");
    previous = updateMissionScrollPosition(previous, first, scroll);
    previous = updateMissionScrollPosition(previous, first, scroll);
    const next = missionNavigationKey("ma1", "M3-S02", "M3-Q02");
    previous = updateMissionScrollPosition(previous, next, scroll);
    previous = updateMissionScrollPosition(previous, next, scroll);
    expect(scroll).toHaveBeenCalledOnce();
  });
});
