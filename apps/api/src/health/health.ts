import { Controller, Get, HttpException, Injectable } from "@nestjs/common";
import Redis from "ioredis";
import { PrismaService } from "../common/prisma.service";
import { validateRuntimeConfig } from "../common/runtime-config";

export type ReadinessResult = {
  status: "ok" | "error";
  database: "ok" | "unavailable";
  redis: "ok" | "unavailable" | "disabled";
};

const timeout = async <T>(operation: Promise<T>, milliseconds: number): Promise<T> => {
  let handle: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => { handle = setTimeout(() => reject(new Error("Readiness check timed out")), milliseconds); })
    ]);
  } finally {
    if (handle) clearTimeout(handle);
  }
};

export async function evaluateReadiness(
  checkDatabase: () => Promise<unknown>,
  checkRedis: (() => Promise<unknown>) | null,
  timeoutMs: number
): Promise<ReadinessResult> {
  const check = async (probe: () => Promise<unknown>): Promise<"ok" | "unavailable"> => {
    try { await timeout(Promise.resolve().then(probe), timeoutMs); return "ok"; } catch { return "unavailable"; }
  };
  const [database, redis] = await Promise.all([
    check(checkDatabase),
    checkRedis ? check(checkRedis) : Promise.resolve("disabled" as const)
  ]);
  return { status: database === "ok" && redis !== "unavailable" ? "ok" : "error", database, redis };
}

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async readiness() {
    const config = validateRuntimeConfig();
    const redisProbe = config.redisUrl ? async () => {
      const client = new Redis(config.redisUrl!, {
        lazyConnect: true,
        connectTimeout: config.healthTimeoutMs,
        commandTimeout: config.healthTimeoutMs,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 0,
        retryStrategy: () => null
      });
      client.on("error", () => undefined);
      try { await client.connect(); await client.ping(); } finally { client.disconnect(); }
    } : null;
    return evaluateReadiness(() => this.prisma.$queryRaw`SELECT 1`, redisProbe, config.healthTimeoutMs);
  }
}

@Controller()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get("health") healthCheck() { return { status: "ok" as const }; }

  @Get("ready") async ready() {
    const result = await this.health.readiness();
    if (result.status === "error") throw new HttpException(result, 503);
    return result;
  }
}
