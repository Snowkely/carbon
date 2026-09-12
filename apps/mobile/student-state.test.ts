import { describe, expect, it, vi } from "vitest";
import { backToStudentHome, buildFeedbackResponses, emptyFeedbackDraft, fetchStudentHomeState, initializeStudentRuntime, isFeedbackComplete, missionPresentation, normalizeHistoryPayload, screenAfterLogin, userFacingError } from "./student-state";

describe("Student runtime authentication", () => {
  it("always initializes a fresh app runtime at Login without restoring prior navigation", () => {
    expect(initializeStudentRuntime()).toEqual({ token: null, screen: "login" });
  });

  it("enters Home only after login and can then reload a persisted active MissionAttempt", async () => {
    expect(screenAfterLogin(false)).toBe("home");
    expect(screenAfterLogin(true)).toBe("profile");
    const state = await fetchStudentHomeState(vi.fn(async (path: string) => path.endsWith("/active")
      ? [{ id: "session-1", workshopName: "Climate Lab" }]
      : [{ missionTemplateId: "m1", missionStableId: "M1", titleCn: "边界侦探", titleEn: "Boundary Detective", progressState: "IN_PROGRESS", accessState: "ACTIVE_ATTEMPT", activeMissionAttemptId: "ma-existing", capabilities: { canStartAttempt: false } }]));
    expect(missionPresentation(state.missions[0]!)).toEqual({ kind: "ACTION", label: "CONTINUE" });
    expect(state.missions[0]?.activeMissionAttemptId).toBe("ma-existing");
  });
});

describe("Student home refresh", () => {
  it("reloads the active Session and current Mission availability using GET-only requests", async () => {
    let available = false;
    const request = vi.fn(async (path: string, options?: RequestInit, _responseContract?: { allowEmptyBody?: boolean }) => {
      expect(options?.method).toBeUndefined();
      if (path === "/student/sessions/active") return [{ id: "session-1", workshopName: "Climate Lab" }];
      if (path.endsWith("/final-result")) return null;
      return [{ missionTemplateId: "m2", accessState: available ? "AVAILABLE" : "BLOCKED_SESSION_UNLOCK", progressState: "NOT_STARTED", capabilities: { canStartAttempt: false } }];
    });

    const before = await fetchStudentHomeState(request);
    available = true;
    const after = await fetchStudentHomeState(request);

    expect(before.missions[0]?.accessState).toBe("BLOCKED_SESSION_UNLOCK");
    expect(after.missions[0]?.accessState).toBe("AVAILABLE");
    expect(after.session).toEqual({ id: "session-1", workshopName: "Climate Lab" });
    expect(after.finalResult).toBeNull();
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      "/student/sessions/active", "/student/sessions/session-1/missions",
      "/student/sessions/session-1/final-result",
      "/student/sessions/active", "/student/sessions/session-1/missions",
      "/student/sessions/session-1/final-result"
    ]);
    expect(request.mock.calls.some(([path]) => String(path).includes("/attempts"))).toBe(false);
    expect(request.mock.calls.filter(([path]) => String(path).endsWith("/active")).every((call) => call[2]?.allowEmptyBody)).toBe(true);
    expect(request.mock.calls.filter(([path]) => String(path).endsWith("/final-result")).every((call) => call[2]?.allowEmptyBody)).toBe(true);
  });

  it("clears stale Workshop and Mission state when there is no active Session", async () => {
    await expect(fetchStudentHomeState(vi.fn().mockResolvedValue([]))).resolves.toEqual({ session: null, missions: [], finalResult: null });
  });

  it("treats an empty active-Session response as the normal Waiting state", async () => {
    await expect(fetchStudentHomeState(vi.fn().mockResolvedValue(null))).resolves.toEqual({ session: null, missions: [], finalResult: null });
  });

  it("keeps the matching Session and Mission Map when the nullable final result has an empty response", async () => {
    const request = vi.fn(async (path: string) => {
      if (path.endsWith("/active")) return [{ id: "session-1", workshopName: "Climate Lab" }];
      if (path.endsWith("/missions")) return [{ missionTemplateId: "m1", missionStableId: "M1", accessState: "AVAILABLE", progressState: "NOT_STARTED", capabilities: { canStartAttempt: true } }];
      return null;
    });

    await expect(fetchStudentHomeState(request)).resolves.toMatchObject({
      session: { id: "session-1", workshopName: "Climate Lab" },
      missions: [{ missionStableId: "M1", accessState: "AVAILABLE" }],
      finalResult: null
    });
  });

  it("propagates request failures for visible UI handling", async () => {
    const failure = new Error("Server unavailable");
    await expect(fetchStudentHomeState(vi.fn().mockRejectedValue(failure))).rejects.toBe(failure);
    expect(userFacingError(failure)).toBe("Server unavailable");
    expect(userFacingError(null)).toBe("Please check your connection and try again.");
  });
});

describe("History and Feedback state", () => {
  it("normalizes empty or malformed History payloads without crashing", () => {
    expect(normalizeHistoryPayload(undefined)).toEqual([]);
    expect(normalizeHistoryPayload({ error: "bad response" })).toEqual([]);
    expect(normalizeHistoryPayload([{ id: "attempt-1" }, null])).toEqual([{ id: "attempt-1" }]);
  });

  it("keeps Feedback validation and response mapping intact", () => {
    const draft = { selected: { "FB-Q01": "Good", "FB-Q02": "Other", "FB-Q03": "Yes" }, other: "More time", suggestion: "Longer workshop" };
    expect(isFeedbackComplete(emptyFeedbackDraft())).toBe(false);
    expect(isFeedbackComplete({ ...draft, other: " " })).toBe(false);
    expect(isFeedbackComplete(draft)).toBe(true);
    expect(buildFeedbackResponses([{ stableId: "FB-Q02" }, { stableId: "FB-Q04" }], draft)).toEqual([
      { questionStableId: "FB-Q02", selectedOption: "Other", otherText: "More time" },
      { questionStableId: "FB-Q04", textResponse: "Longer workshop" }
    ]);
  });

  it("uses application-level Home navigation without a submit side effect", () => {
    const submit = vi.fn();
    expect(backToStudentHome()).toBe("home");
    expect(submit).not.toHaveBeenCalled();
  });
});
