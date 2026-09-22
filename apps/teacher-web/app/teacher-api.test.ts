import { afterEach, describe, expect, it, vi } from "vitest";
import { refreshTeacherTokens, teacherApiRequest } from "./teacher-api";

const response = (status: number, body: string) => ({ ok: status >= 200 && status < 300, status, text: vi.fn().mockResolvedValue(body) });
afterEach(() => vi.unstubAllGlobals());

describe("Teacher authenticated API", () => {
  it("routes 401 to the confirmation coordinator and preserves 403 as a permission error", async () => {
    const unauthorized = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response(401, "")).mockResolvedValueOnce(response(403, '{"error":{"code":"FORBIDDEN","message":"Viewer only"}}')));
    await expect(teacherApiRequest("http://api", "expired", "/teacher/workshops", {}, unauthorized)).rejects.toMatchObject({ status: 401, unauthorizedHandled: true });
    expect(unauthorized).toHaveBeenCalledOnce();
    await expect(teacherApiRequest("http://api", "valid", "/teacher/workshops", {}, unauthorized)).rejects.toMatchObject({ status: 403, message: "FORBIDDEN: Viewer only" });
    expect(unauthorized).toHaveBeenCalledOnce();
  });

  it("bypasses browser cache only for dynamic GET requests without changing mutations or static content", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, "{}"));
    vi.stubGlobal("fetch", fetchMock);
    await teacherApiRequest("http://api", "valid", "/teacher/dashboard", {}, vi.fn());
    expect(fetchMock).toHaveBeenLastCalledWith("http://api/teacher/dashboard", expect.objectContaining({ cache: "no-store" }));
    await teacherApiRequest("http://api", "valid", "/teacher/workshops", { method: "POST", body: "{}" }, vi.fn());
    expect(fetchMock.mock.calls[1]?.[1]).not.toHaveProperty("cache");
    await teacherApiRequest("http://api", "valid", "/teacher/question-bank", {}, vi.fn());
    expect(fetchMock.mock.calls[2]?.[1]).not.toHaveProperty("cache");
  });

  it("rotates the server-backed refresh session without exposing credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, '{"accessToken":"next-access","refreshToken":"next-refresh"}'));
    vi.stubGlobal("fetch", fetchMock);

    await expect(refreshTeacherTokens("http://api", "current-refresh")).resolves.toEqual({
      accessToken: "next-access",
      refreshToken: "next-refresh"
    });
    expect(fetchMock).toHaveBeenCalledWith("http://api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: "current-refresh" })
    });
  });

  it("surfaces a rejected refresh session as an authentication error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(401, '{"error":{"code":"UNAUTHORIZED","message":"Refresh session expired"}}')));
    await expect(refreshTeacherTokens("http://api", "expired-refresh")).rejects.toMatchObject({
      status: 401,
      message: "UNAUTHORIZED: Refresh session expired"
    });
  });
});
