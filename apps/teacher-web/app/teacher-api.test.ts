import { afterEach, describe, expect, it, vi } from "vitest";
import { teacherApiRequest } from "./teacher-api";

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
});
