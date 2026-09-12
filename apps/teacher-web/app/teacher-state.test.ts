import { describe, expect, it, vi } from "vitest";
import { fetchTeacherDashboard, initializeTeacherRuntime, rosterLoadPresentation, teacherMissionPresentation, teacherMissionUnlockMessage, unlockTeacherMission } from "./teacher-state";

describe("Teacher Mission Control presentation", () => {
  it.each(["M2", "M3", "M4", "M5", "M6"])("offers a Session unlock for locked %s", (stableId) => {
    expect(teacherMissionPresentation({ missionTemplateId: stableId.toLowerCase(), stableId, unlockState: "LOCKED_FOR_SESSION" }, "ACTIVE")).toMatchObject({ canUnlock: true, unlockLabel: `Unlock ${stableId}` });
  });

  it("keeps M1 manual unlock disabled", () => {
    expect(teacherMissionPresentation({ missionTemplateId: "m1", stableId: "M1", unlockState: "LOCKED_FOR_SESSION" }, "ACTIVE")).toMatchObject({ canUnlock: false, unlockLabel: null });
  });

  it("does not label implemented M1 as Coming soon", () => {
    expect(teacherMissionPresentation({ missionTemplateId: "m1", stableId: "M1", unlockState: "UNLOCKED_FOR_SESSION" }, "ACTIVE")).toMatchObject({ gameplayDeferred: false, gameplayStatusLabel: null });
  });

  it.each(["M6"])("allows an explicit historical content flag to label %s as Coming soon", (stableId) => {
    expect(teacherMissionPresentation({ missionTemplateId: stableId.toLowerCase(), stableId, unlockState: "UNLOCKED_FOR_SESSION", gameplayImplemented: false }, "ACTIVE")).toMatchObject({
      unlockStatusLabel: "Unlocked",
      canUnlock: false,
      gameplayDeferred: true,
      gameplayStatusLabel: "Coming soon"
    });
  });

  it.each(["M1", "M2", "M3", "M4", "M5"])("does not label implemented %s as Coming soon", (stableId) => {
    expect(teacherMissionPresentation({ missionTemplateId: stableId.toLowerCase(), stableId, unlockState: "UNLOCKED_FOR_SESSION", gameplayImplemented: true }, "ACTIVE")).toMatchObject({ gameplayDeferred: false, gameplayStatusLabel: null });
  });

  it("shows friendly Unlocked without Coming soon after M3 is unlocked", () => {
    expect(teacherMissionPresentation({ missionTemplateId: "m3", stableId: "M3", unlockState: "UNLOCKED_FOR_SESSION" }, "ACTIVE")).toEqual({
      unlockStatusLabel: "Unlocked",
      unlockStatusTone: "unlocked",
      canUnlock: false,
      unlockLabel: null,
      gameplayDeferred: false,
      gameplayStatusLabel: null
    });
  });

  it("maps raw locked state to a friendly Locked label without exposing the enum", () => {
    const presentation = teacherMissionPresentation({ missionTemplateId: "m2", stableId: "M2", unlockState: "LOCKED_FOR_SESSION" }, "ACTIVE");
    expect(presentation).toMatchObject({ unlockStatusLabel: "Locked", unlockStatusTone: "locked", gameplayStatusLabel: null });
    expect(JSON.stringify(presentation)).not.toContain("LOCKED_FOR_SESSION");
  });

  it("uses a concise unlock confirmation", () => {
    expect(teacherMissionUnlockMessage("M3")).toBe("Mission 3 unlocked.");
  });

  it("uses the generic Mission unlock endpoint for M3", async () => {
    const request = vi.fn().mockResolvedValue({ unlockState: "UNLOCKED_FOR_SESSION" });
    await unlockTeacherMission(request, "session-1", "m3");
    expect(request).toHaveBeenCalledWith("/teacher/sessions/session-1/missions/m3/unlock", { method: "POST" });
  });

  it("keeps M2 on the same generic Session unlock endpoint", async () => {
    const request = vi.fn().mockResolvedValue({ unlockState: "UNLOCKED_FOR_SESSION" });
    await unlockTeacherMission(request, "session-1", "m2");
    expect(request).toHaveBeenCalledWith("/teacher/sessions/session-1/missions/m2/unlock", { method: "POST" });
  });
});

describe("Teacher fresh runtime authentication", () => {
  it("always initializes a fresh Teacher application session at Login", () => {
    expect(initializeTeacherRuntime()).toEqual({ token: null });
  });

  it("reloads the real Workshop and ACTIVE Session after login", async () => {
    const serverState = [{ id: "w1", status: "READY", sessions: [{ id: "s1", status: "ACTIVE" }] }];
    const request = vi.fn().mockResolvedValue(serverState);
    const result = await fetchTeacherDashboard(request);
    expect(request).toHaveBeenCalledWith("/teacher/dashboard");
    expect(result).toEqual(serverState);
  });
});

describe("Students and Gradebook load presentation", () => {
  it("shows only the error state after a failed request", () => {
    expect(rosterLoadPresentation(false, "REQUEST_FAILED: Request failed", 0)).toEqual({ showLoading: false, showError: true, showData: false, showEmpty: false });
  });

  it("shows the empty state only after a successful empty response", () => {
    expect(rosterLoadPresentation(false, null, 0)).toEqual({ showLoading: false, showError: false, showData: true, showEmpty: true });
  });

  it("keeps loading distinct from both error and empty states", () => {
    expect(rosterLoadPresentation(true, null, 0)).toEqual({ showLoading: true, showError: false, showData: false, showEmpty: false });
  });
});
