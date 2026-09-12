import { describe, expect, it, vi } from "vitest";
import { evaluateReadiness, HealthController } from "./health";

describe("health and readiness", () => {
  it("returns a minimal liveness response", () => {
    expect(new HealthController({} as never).healthCheck()).toEqual({ status: "ok" });
  });

  it("reports healthy required dependencies", async () => {
    await expect(evaluateReadiness(vi.fn().mockResolvedValue(1), vi.fn().mockResolvedValue("PONG"), 100)).resolves.toEqual({ status: "ok", database: "ok", redis: "ok" });
  });

  it("accurately reports optional Redis as disabled", async () => {
    await expect(evaluateReadiness(vi.fn().mockResolvedValue(1), null, 100)).resolves.toEqual({ status: "ok", database: "ok", redis: "disabled" });
  });

  it("reflects database failure without leaking its error", async () => {
    const result = await evaluateReadiness(vi.fn().mockRejectedValue(new Error("postgresql://user:password@private/db")), null, 100);
    expect(result).toEqual({ status: "error", database: "unavailable", redis: "disabled" });
    expect(JSON.stringify(result)).not.toContain("password");
  });

  it("reflects Redis failure without leaking its error", async () => {
    const result = await evaluateReadiness(vi.fn().mockResolvedValue(1), vi.fn().mockRejectedValue(new Error("redis://:secret@private")), 100);
    expect(result).toEqual({ status: "error", database: "ok", redis: "unavailable" });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});
