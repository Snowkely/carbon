import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileApiError, MobileApiProtocolError, mobileApiRequest, parseMobileApiResponse } from "./mobile-api";

const response = (status: number, body: string) => ({
  ok: status >= 200 && status < 300,
  status,
  text: vi.fn().mockResolvedValue(body)
});

afterEach(() => vi.unstubAllGlobals());

describe("Mobile API response parsing", () => {
  it("parses a 200 JSON response", async () => {
    await expect(parseMobileApiResponse(response(200, '{"activeSession":"session-1"}'))).resolves.toEqual({ activeSession: "session-1" });
  });

  it("treats a 204 empty body as null without attempting raw JSON parsing", async () => {
    const empty = response(204, "");
    await expect(parseMobileApiResponse(empty)).resolves.toBeNull();
    expect(empty.text).toHaveBeenCalledOnce();
  });

  it("permits a contract-declared 200 empty body and otherwise reports a protocol error", async () => {
    await expect(parseMobileApiResponse(response(200, ""), { allowEmptyBody: true })).resolves.toBeNull();
    await expect(parseMobileApiResponse(response(200, ""))).rejects.toMatchObject({
      name: "MobileApiProtocolError",
      message: "Expected JSON response but received an empty body (HTTP 200)",
      status: 200
    });
  });

  it.each([
    [400, '{"error":{"message":"Invalid request"}}', "Invalid request"],
    [404, "", "Request failed (HTTP 404)"],
    [500, '{"message":"Server failed"}', "Server failed"],
    [503, "", "Request failed (HTTP 503)"]
  ])("surfaces HTTP %i failures even when the body is %s", async (status, body, message) => {
    await expect(parseMobileApiResponse(response(status, body), { allowEmptyBody: true })).rejects.toMatchObject({
      name: "MobileApiError",
      message,
      status
    });
  });

  it("surfaces malformed non-empty bodies as a protocol error with the HTTP status", async () => {
    await expect(parseMobileApiResponse(response(502, "upstream unavailable"))).rejects.toBeInstanceOf(MobileApiProtocolError);
    await expect(parseMobileApiResponse(response(200, "{"))).rejects.toMatchObject({ message: "Invalid JSON response (HTTP 200)" });
  });
});

describe("Mobile API requests", () => {
  it("keeps login as a JSON POST and returns its parsed token payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, '{"accessToken":"token","profileRequired":false}'));
    vi.stubGlobal("fetch", fetchMock);

    await expect(mobileApiRequest("http://api.test/v1", "/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "student.alex", password: "Carbon123!" })
    })).resolves.toEqual({ accessToken: "token", profileRequired: false });
    expect(fetchMock).toHaveBeenCalledWith("http://api.test/v1/auth/login", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "Content-Type": "application/json" })
    }));
  });

  it("preserves the HTTP status on request failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(401, '{"error":{"message":"Invalid credentials"}}')));
    await expect(mobileApiRequest("http://api.test/v1", "/auth/login", { method: "POST" })).rejects.toBeInstanceOf(MobileApiError);
  });

  it("notifies the centralized handler for 401 but not 403", async () => {
    const unauthorized = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response(401, "")).mockResolvedValueOnce(response(403, '{"error":{"message":"Forbidden"}}')));
    await expect(mobileApiRequest("http://api.test/v1", "/student/history", { token: "expired", onUnauthorized: unauthorized })).rejects.toMatchObject({ status: 401, unauthorizedHandled: true });
    expect(unauthorized).toHaveBeenCalledOnce();
    await expect(mobileApiRequest("http://api.test/v1", "/student/history", { token: "valid", onUnauthorized: unauthorized })).rejects.toMatchObject({ status: 403, unauthorizedHandled: false });
    expect(unauthorized).toHaveBeenCalledOnce();
  });
});
