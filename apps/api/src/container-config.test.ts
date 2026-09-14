import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "../..");
const compose = readFileSync(resolve(root, "docker-compose.production.yml"), "utf8");
const dockerignore = readFileSync(resolve(root, ".dockerignore"), "utf8");
const apiDockerfile = readFileSync(resolve(root, "deploy/docker/api.Dockerfile"), "utf8");
const teacherDockerfile = readFileSync(resolve(root, "deploy/docker/teacher-web.Dockerfile"), "utf8");
const nginx = readFileSync(resolve(root, "deploy/nginx/nginx.conf"), "utf8");

describe("production container configuration", () => {
  it("excludes local secrets, dependencies, Git metadata, and database dumps from build contexts", () => {
    expect(dockerignore).toMatch(/^\.env\.\*$/m);
    expect(dockerignore).toMatch(/^backups$/m);
    expect(dockerignore).toMatch(/^\*\*\/\*\.dump$/m);
    expect(dockerignore).toMatch(/^\.git$/m);
    expect(dockerignore).toMatch(/^\*\*\/node_modules$/m);
  });

  it("builds both applications in multiple stages and runs them as non-root", () => {
    for (const dockerfile of [apiDockerfile, teacherDockerfile]) {
      expect(dockerfile.match(/^FROM /gm)?.length).toBeGreaterThanOrEqual(3);
      expect(dockerfile).toContain("pnpm install --frozen-lockfile");
      expect(dockerfile).toContain("USER node");
      expect(dockerfile).toContain("NODE_ENV=production");
    }
    expect(apiDockerfile).toContain('CMD ["node", "dist/src/main.js"]');
    expect(teacherDockerfile).toContain('CMD ["node", "apps/teacher-web/server.js"]');
  });

  it("runs controlled production migrations before the API", () => {
    expect(compose).toContain('["./node_modules/.bin/prisma", "migrate", "deploy"');
    expect(compose).toMatch(/migrate:\s+condition: service_completed_successfully/);
    expect(compose).not.toContain("migrate dev");
  });

  it("publishes only the reverse proxy and keeps data services on an internal network", () => {
    const portMappings = compose.match(/^\s+ports:/gm) ?? [];
    expect(portMappings).toHaveLength(1);
    expect(compose).toContain('"127.0.0.1:${INGRESS_PORT:-8088}:8080"');
    expect(compose).toMatch(/backend:\s+internal: true/);
    expect(compose).toContain("postgres_data:/var/lib/postgresql/data");
    expect(compose).toContain("redis_data:/data");
  });

  it("uses conservative route-specific limits without a tiny global classroom limit", () => {
    expect(nginx).toContain("zone=login_per_ip:10m rate=30r/m");
    expect(nginx).toContain("zone=teacher_per_ip:10m rate=20r/s");
    expect(nginx).toContain("zone=api_per_ip:10m rate=100r/s");
    expect(nginx).toContain("limit_req_status 429");
  });

  it("does not enable HSTS before real HTTPS termination is configured", () => {
    expect(nginx.toLowerCase()).not.toContain("strict-transport-security");
    expect(nginx).toContain("X-Content-Type-Options");
    expect(nginx).toContain("Referrer-Policy");
    expect(nginx).toContain("X-Frame-Options");
  });
});
