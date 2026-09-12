import { describe, expect, it } from "vitest";
import { corsOriginAllowed, validateRuntimeConfig } from "./runtime-config";

const productionEnv = (): NodeJS.ProcessEnv => ({
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://configured-by-secret-store/db",
  JWT_ACCESS_SECRET: "access-secret-with-at-least-32-characters",
  JWT_REFRESH_SECRET: "different-refresh-secret-with-32-characters",
  CORS_ALLOWED_ORIGINS: "https://teacher.example.test"
});

describe("production runtime configuration", () => {
  it("accepts complete production configuration without exposing values", () => {
    const config = validateRuntimeConfig(productionEnv());
    expect(config.environment).toBe("production");
    expect(config.corsAllowedOrigins).toEqual(["https://teacher.example.test"]);
  });

  it("fails safely when the production JWT secret is absent", () => {
    const env = productionEnv(); delete env.JWT_ACCESS_SECRET;
    expect(() => validateRuntimeConfig(env)).toThrow("JWT_ACCESS_SECRET must be configured");
  });

  it("rejects weak, shared or wildcard production security configuration", () => {
    expect(() => validateRuntimeConfig({ ...productionEnv(), JWT_ACCESS_SECRET: "weak" })).toThrow("at least 32");
    const shared = "shared-secret-with-at-least-32-characters";
    expect(() => validateRuntimeConfig({ ...productionEnv(), JWT_ACCESS_SECRET: shared, JWT_REFRESH_SECRET: shared })).toThrow("must be different");
    expect(() => validateRuntimeConfig({ ...productionEnv(), CORS_ALLOWED_ORIGINS: "*" })).toThrow("wildcard");
  });

  it("keeps development usable without production secrets", () => {
    const config = validateRuntimeConfig({ NODE_ENV: "development" });
    expect(config.port).toBe(3001);
    expect(config.jwtAccessSecret).toHaveLength(64);
    expect(config.jwtRefreshSecret).toHaveLength(64);
    expect(config.jwtAccessSecret).not.toBe(config.jwtRefreshSecret);
    expect(config.corsAllowedOrigins).toEqual([]);
    expect(corsOriginAllowed("http://192.168.1.103:8081", config)).toBe(true);
  });

  it("allows configured production and native origins but rejects other browsers", () => {
    const config = validateRuntimeConfig(productionEnv());
    expect(corsOriginAllowed("https://teacher.example.test", config)).toBe(true);
    expect(corsOriginAllowed("https://untrusted.example.test", config)).toBe(false);
    expect(corsOriginAllowed(undefined, config)).toBe(true);
  });
});
