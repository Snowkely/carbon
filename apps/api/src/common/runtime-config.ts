import { randomBytes } from "node:crypto";

export type RuntimeEnvironment = "development" | "test" | "production";

export type RuntimeConfig = {
  environment: RuntimeEnvironment;
  port: number;
  databaseUrl: string;
  redisUrl?: string;
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  accessTokenTtl: string;
  refreshTokenTtlDays: number;
  presenceOfflineSeconds: number;
  corsAllowedOrigins: string[];
  healthTimeoutMs: number;
};

const DEVELOPMENT_ACCESS_SECRET = randomBytes(32).toString("hex");
const DEVELOPMENT_REFRESH_SECRET = randomBytes(32).toString("hex");

const required = (env: NodeJS.ProcessEnv, name: string) => {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} must be configured in production`);
  return value;
};

const integer = (value: string | undefined, fallback: number, name: string, minimum: number, maximum: number) => {
  const parsed = value === undefined || value.trim() === "" ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  return parsed;
};

const parseOrigins = (value: string | undefined, production: boolean) => {
  const entries = (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  if (production && entries.length === 0) throw new Error("CORS_ALLOWED_ORIGINS must be configured in production");
  if (entries.includes("*")) throw new Error("CORS_ALLOWED_ORIGINS must not contain a wildcard");
  return entries.map((entry) => {
    let url: URL;
    try { url = new URL(entry); } catch { throw new Error("CORS_ALLOWED_ORIGINS contains an invalid origin"); }
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== entry || url.username || url.password) {
      throw new Error("CORS_ALLOWED_ORIGINS entries must be HTTP(S) origins without paths or credentials");
    }
    return url.origin;
  });
};

export function validateRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const environment = (env.NODE_ENV ?? "development") as RuntimeEnvironment;
  if (!["development", "test", "production"].includes(environment)) throw new Error("NODE_ENV must be development, test, or production");
  const production = environment === "production";
  const jwtAccessSecret = production ? required(env, "JWT_ACCESS_SECRET") : env.JWT_ACCESS_SECRET?.trim() || DEVELOPMENT_ACCESS_SECRET;
  const jwtRefreshSecret = production ? required(env, "JWT_REFRESH_SECRET") : env.JWT_REFRESH_SECRET?.trim() || DEVELOPMENT_REFRESH_SECRET;
  if (production && jwtAccessSecret.length < 32) throw new Error("JWT_ACCESS_SECRET must contain at least 32 characters in production");
  if (production && jwtRefreshSecret.length < 32) throw new Error("JWT_REFRESH_SECRET must contain at least 32 characters in production");
  if (production && jwtAccessSecret === jwtRefreshSecret) throw new Error("JWT access and refresh secrets must be different in production");
  const accessTokenTtl = env.ACCESS_TOKEN_TTL?.trim() || "15m";
  if (!/^\d+[smhd]$/.test(accessTokenTtl)) throw new Error("ACCESS_TOKEN_TTL must use a duration such as 15m or 1h");
  return {
    environment,
    port: integer(env.PORT, 3001, "PORT", 1, 65535),
    databaseUrl: production ? required(env, "DATABASE_URL") : env.DATABASE_URL?.trim() || "",
    redisUrl: env.REDIS_URL?.trim() || undefined,
    jwtAccessSecret,
    jwtRefreshSecret,
    accessTokenTtl,
    refreshTokenTtlDays: integer(env.REFRESH_TOKEN_TTL_DAYS, 7, "REFRESH_TOKEN_TTL_DAYS", 1, 365),
    presenceOfflineSeconds: integer(env.PRESENCE_OFFLINE_SECONDS, 30, "PRESENCE_OFFLINE_SECONDS", 5, 3600),
    corsAllowedOrigins: parseOrigins(env.CORS_ALLOWED_ORIGINS, production),
    healthTimeoutMs: integer(env.HEALTH_TIMEOUT_MS, 1500, "HEALTH_TIMEOUT_MS", 100, 10000)
  };
}

export function corsOriginAllowed(origin: string | undefined, config: RuntimeConfig): boolean {
  if (!origin) return true;
  if (config.environment !== "production" && config.corsAllowedOrigins.length === 0) return true;
  return config.corsAllowedOrigins.includes(origin);
}
