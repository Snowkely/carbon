import { afterEach, describe, expect, it, vi } from "vitest";
import { clearStudentTokens, persistStudentTokens, readStudentTokens, restoreStudentSession } from "./student-session";

const response = (status: number, body: string) => ({ ok: status >= 200 && status < 300, status, text: vi.fn().mockResolvedValue(body) });
const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn(async (key: string) => values.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { values.delete(key); })
  };
};

afterEach(() => vi.unstubAllGlobals());

describe("Student browser session restoration", () => {
  it("restores a valid login after browser reload without storing a password", async () => {
    const storage = memoryStorage();
    await persistStudentTokens(storage, { accessToken: "access", refreshToken: "refresh" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(200, '{"id":"student-1"}')));
    await expect(restoreStudentSession(storage, "https://classroom.example/v1")).resolves.toEqual({
      tokens: { accessToken: "access", refreshToken: "refresh" },
      profileRequired: false
    });
    expect(Array.from((storage.setItem.mock.calls as string[][]).flat())).not.toContain("password");
  });

  it("restores an incomplete profile to profile setup", async () => {
    const storage = memoryStorage();
    await persistStudentTokens(storage, { accessToken: "access", refreshToken: "refresh" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(200, "null")));
    await expect(restoreStudentSession(storage, "https://classroom.example/v1")).resolves.toMatchObject({ profileRequired: true });
  });

  it("rotates an expired access token through the existing refresh session", async () => {
    const storage = memoryStorage();
    await persistStudentTokens(storage, { accessToken: "expired", refreshToken: "refresh" });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(401, '{"message":"expired"}'))
      .mockResolvedValueOnce(response(200, '{"accessToken":"next-access","refreshToken":"next-refresh"}'))
      .mockResolvedValueOnce(response(200, '{"id":"student-1"}'));
    vi.stubGlobal("fetch", fetchMock);
    await expect(restoreStudentSession(storage, "https://classroom.example/v1")).resolves.toMatchObject({ tokens: { accessToken: "next-access", refreshToken: "next-refresh" } });
    await expect(readStudentTokens(storage)).resolves.toEqual({ accessToken: "next-access", refreshToken: "next-refresh" });
  });

  it("clears invalid credentials and logout clears both tokens", async () => {
    const storage = memoryStorage();
    await persistStudentTokens(storage, { accessToken: "expired", refreshToken: "expired-refresh" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(401, '{"message":"expired"}')));
    await expect(restoreStudentSession(storage, "https://classroom.example/v1")).resolves.toBeNull();
    await expect(readStudentTokens(storage)).resolves.toBeNull();
    await persistStudentTokens(storage, { accessToken: "access", refreshToken: "refresh" });
    await clearStudentTokens(storage);
    await expect(readStudentTokens(storage)).resolves.toBeNull();
  });

  it("does not treat a 403 permission response as an expired login", async () => {
    const storage = memoryStorage();
    await persistStudentTokens(storage, { accessToken: "access", refreshToken: "refresh" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(403, '{"message":"Forbidden"}')));
    await expect(restoreStudentSession(storage, "https://classroom.example/v1")).rejects.toMatchObject({ status: 403 });
    await expect(readStudentTokens(storage)).resolves.toEqual({ accessToken: "access", refreshToken: "refresh" });
  });
});
