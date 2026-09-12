import { HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { SafeExceptionFilter, sanitizeDiagnostic } from "./safe-exception.filter";

const invoke = (exception: unknown) => {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const host = { switchToHttp: () => ({ getRequest: () => ({ method: "POST", originalUrl: "/v1/test" }), getResponse: () => ({ status }) }) };
  const filter = new SafeExceptionFilter();
  const error = vi.fn();
  (filter as unknown as { logger: { error: typeof error } }).logger = { error };
  filter.catch(exception, host as never);
  return { status, json, error };
};

describe("safe production error boundary", () => {
  it("returns a generic 500 and redacts diagnostics", () => {
    const secret = "postgresql://admin:db-password@private/db Bearer bearer-token password=hunter2 eyJabc.def.ghi";
    const result = invoke(new Error(secret));
    expect(result.status).toHaveBeenCalledWith(500);
    expect(result.json).toHaveBeenCalledWith({ statusCode: 500, message: "Internal server error" });
    const logged = String(result.error.mock.calls[0]?.[0]);
    expect(logged).not.toContain("db-password");
    expect(logged).not.toContain("bearer-token");
    expect(logged).not.toContain("hunter2");
    expect(logged).not.toContain("eyJabc.def.ghi");
  });

  it.each([403, 409])("preserves intentional HTTP %s semantics", (statusCode) => {
    const body = { error: { code: statusCode === 403 ? "FORBIDDEN" : "SESSION_INACTIVE", message: "Expected error" } };
    const result = invoke(new HttpException(body, statusCode));
    expect(result.status).toHaveBeenCalledWith(statusCode);
    expect(result.json).toHaveBeenCalledWith(body);
    expect(result.error).not.toHaveBeenCalled();
  });

  it("preserves the non-sensitive readiness 503 contract", () => {
    const body = { status: "error", database: "ok", redis: "unavailable" };
    const result = invoke(new HttpException(body, 503));
    expect(result.status).toHaveBeenCalledWith(503);
    expect(result.json).toHaveBeenCalledWith(body);
    expect(result.error).not.toHaveBeenCalled();
  });

  it("redacts standalone server diagnostics", () => {
    expect(sanitizeDiagnostic("secret=abc token=def")).toBe("secret=[redacted] token=[redacted]");
  });
});
