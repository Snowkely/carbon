import { describe, expect, it, vi } from "vitest";
import { TeacherApiError } from "./teacher-api";
import { clearTeacherAccessToken, parseTeacherRoute, persistTeacherTokens, readTeacherAccessToken, readTeacherRefreshToken, restoreTeacherSession, teacherRoutePath } from "./teacher-session";
import { createSingleFlightRefresh } from "./teacher-refresh";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); })
  };
}

describe("Teacher browser session restoration", () => {
  it("persists the access token without storing credentials and verifies it on reload", async () => {
    const storage = memoryStorage();
    persistTeacherTokens(storage, { accessToken: "access-token", refreshToken: "refresh-token" });
    const verify = vi.fn().mockResolvedValue({ id: "teacher-1" });
    const refresh = vi.fn();
    await expect(restoreTeacherSession(storage, verify, refresh)).resolves.toEqual({ accessToken: "access-token", refreshToken: "refresh-token" });
    expect(verify).toHaveBeenCalledWith("access-token");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("rotates an expired access token through the existing refresh session", async () => {
    const storage = memoryStorage();
    persistTeacherTokens(storage, { accessToken: "expired-access", refreshToken: "old-refresh" });
    const verify = vi.fn().mockRejectedValueOnce(new TeacherApiError("expired", 401)).mockResolvedValueOnce({ id: "teacher-1" });
    const refresh = vi.fn().mockResolvedValue({ accessToken: "new-access", refreshToken: "new-refresh" });
    await expect(restoreTeacherSession(storage, verify, refresh)).resolves.toEqual({ accessToken: "new-access", refreshToken: "new-refresh" });
    expect(refresh).toHaveBeenCalledWith("old-refresh");
    expect(readTeacherAccessToken(storage)).toBe("new-access");
    expect(readTeacherRefreshToken(storage)).toBe("new-refresh");
  });

  it("clears an expired or disabled account when refresh is rejected", async () => {
    const storage = memoryStorage();
    persistTeacherTokens(storage, { accessToken: "invalid-token", refreshToken: "invalid-refresh" });
    await expect(restoreTeacherSession(storage, async () => { throw new TeacherApiError("invalid", 401); }, async () => { throw new TeacherApiError("disabled", 401); })).resolves.toBeNull();
    expect(readTeacherAccessToken(storage)).toBeNull();
    expect(readTeacherRefreshToken(storage)).toBeNull();
  });

  it("clears a restored session that is forbidden by the account endpoint", async () => {
    const storage = memoryStorage();
    persistTeacherTokens(storage, { accessToken: "invalid-token", refreshToken: "refresh-token" });
    const refresh = vi.fn();
    await expect(restoreTeacherSession(storage, async () => { throw new TeacherApiError("forbidden", 403); }, refresh)).resolves.toBeNull();
    expect(refresh).not.toHaveBeenCalled();
    expect(readTeacherAccessToken(storage)).toBeNull();
  });

  it("keeps a session available for retry when verification fails because of the network", async () => {
    const storage = memoryStorage();
    persistTeacherTokens(storage, { accessToken: "access-token", refreshToken: "refresh-token" });
    await expect(restoreTeacherSession(storage, async () => { throw new Error("offline"); }, vi.fn())).rejects.toThrow("offline");
    expect(readTeacherAccessToken(storage)).toBe("access-token");
  });

  it("clears persisted authentication on logout", () => {
    const storage = memoryStorage();
    persistTeacherTokens(storage, { accessToken: "access-token", refreshToken: "refresh-token" });
    clearTeacherAccessToken(storage);
    expect(readTeacherAccessToken(storage)).toBeNull();
    expect(readTeacherRefreshToken(storage)).toBeNull();
  });
});

describe("Teacher route restoration", () => {
  it("restores a Workshop page after F5", () => {
    expect(parseTeacherRoute("/workshops/workshop-1")).toEqual({ view: "Workshops", workshopId: "workshop-1", sessionId: null });
    expect(teacherRoutePath("Workshops", "workshop-1")).toBe("/workshops/workshop-1");
  });

  it("restores a Live Monitor page after F5", () => {
    expect(parseTeacherRoute("/sessions/session-1/monitor")).toEqual({ view: "Live Monitor", workshopId: null, sessionId: "session-1" });
    expect(teacherRoutePath("Live Monitor", null, "session-1")).toBe("/sessions/session-1/monitor");
  });

  it("keeps Students and Gradebook tied to the selected Workshop", () => {
    expect(parseTeacherRoute("/workshops/workshop-1/students").view).toBe("Students");
    expect(parseTeacherRoute("/workshops/workshop-1/gradebook").view).toBe("Gradebook");
  });
});

describe("Teacher manual refresh", () => {
  it("deduplicates overlapping manual refresh and polling calls, then allows the next poll", async () => {
    let finish!: () => void;
    const task = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const refresh = createSingleFlightRefresh(task);
    const manual = refresh();
    const repeatedClick = refresh();
    const poll = refresh();
    await Promise.resolve();
    expect(task).toHaveBeenCalledOnce();
    expect(repeatedClick).toBe(manual);
    expect(poll).toBe(manual);
    finish();
    await manual;
    const nextPoll = refresh();
    await Promise.resolve();
    expect(task).toHaveBeenCalledTimes(2);
    finish();
    await nextPoll;
  });
});
