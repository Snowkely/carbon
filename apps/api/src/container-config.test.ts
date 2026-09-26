import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "../..");
const compose = readFileSync(resolve(root, "docker-compose.production.yml"), "utf8");
const dockerignore = readFileSync(resolve(root, ".dockerignore"), "utf8");
const apiDockerfile = readFileSync(resolve(root, "deploy/docker/api.Dockerfile"), "utf8");
const teacherDockerfile = readFileSync(resolve(root, "deploy/docker/teacher-web.Dockerfile"), "utf8");
const studentDockerfile = readFileSync(resolve(root, "deploy/docker/student-web.Dockerfile"), "utf8");
const proxyDockerfile = readFileSync(resolve(root, "deploy/docker/reverse-proxy.Dockerfile"), "utf8");
const nginx = readFileSync(resolve(root, "deploy/nginx/nginx.conf"), "utf8");
const studentNginx = readFileSync(resolve(root, "deploy/nginx/student-web.nginx.conf"), "utf8");
const nextConfig = readFileSync(resolve(root, "apps/teacher-web/next.config.ts"), "utf8");
const environmentExample = readFileSync(resolve(root, "deploy/.env.example"), "utf8");

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
    expect(studentDockerfile).toContain("pnpm --filter @carbon/mobile build:classroom-web");
    expect(proxyDockerfile).toContain("PUBLIC_BASE_PATH=/carbon-trader");
  });

  it("runs controlled production migrations before the API", () => {
    expect(compose).toContain('["./node_modules/.bin/prisma", "migrate", "deploy"');
    expect(compose).toContain("migrate: { condition: service_completed_successfully }");
    expect(compose).toContain("initialize: { condition: service_completed_successfully }");
    expect(compose).not.toContain("migrate dev");
  });

  it("publishes only the reverse proxy and keeps data services on an internal network", () => {
    const portMappings = compose.match(/^\s+ports:/gm) ?? [];
    expect(portMappings).toHaveLength(1);
    expect(compose).toContain('name: ${COMPOSE_PROJECT_NAME:-carbon-trader}');
    expect(compose).toContain('"127.0.0.1:${INGRESS_PORT:-8089}:8080"');
    expect(compose).not.toContain("8088");
    expect(compose).toContain("backend: { internal: true }");
    expect(compose).toContain("postgres_data:/var/lib/postgresql/data");
    expect(compose).toContain("redis_data:/data");
  });

  it("uses conservative route-specific limits without a tiny global classroom limit", () => {
    expect(nginx).toContain("zone=login_per_ip:10m rate=30r/m");
    expect(nginx).toContain("zone=teacher_per_ip:10m rate=20r/s");
    expect(nginx).toContain("zone=api_per_ip:10m rate=100r/s");
    expect(nginx).toContain("limit_req_status 429");
    expect(nginx).toMatch(/location = __PUBLIC_BASE_PATH__\/v1\/auth\/student\/register \{\s+limit_req zone=login_per_ip burst=60 nodelay;/);
  });

  it("isolates every public route below the production base path", () => {
    expect(nextConfig).toContain("basePath: configuredBasePath");
    expect(teacherDockerfile).toContain("PUBLIC_BASE_PATH=$PUBLIC_BASE_PATH");
    expect(studentDockerfile).toContain("PUBLIC_BASE_PATH=$PUBLIC_BASE_PATH");
    expect(studentNginx).toContain("__PUBLIC_BASE_PATH__/student");
    for (const route of ["/v1/", "/health", "/ready", "/student", "/_next/", "/"]) {
      expect(nginx).toContain(`__PUBLIC_BASE_PATH__${route}`);
    }
    expect(nginx).toContain("location = __PUBLIC_BASE_PATH__ { return 301 __PUBLIC_BASE_PATH__/; }");
    expect(nginx).toContain("absolute_redirect off;");
    expect(nginx).toContain("rewrite ^__PUBLIC_BASE_PATH__/$ __PUBLIC_BASE_PATH__ break;");
    expect(nginx).toContain("location / { return 404; }");
  });

  it("builds a complete isolated production stack with safe placeholder configuration", () => {
    for (const service of ["postgres", "redis", "migrate", "initialize", "api", "teacher-web", "student-web", "reverse-proxy"]) {
      expect(compose).toMatch(new RegExp(`\\n  ${service}:`));
    }
    expect(compose).toContain("CLASSROOM_BOOTSTRAP: \"true\"");
    expect(compose).toContain("admin-create-owner:");
    expect(compose).toContain("postgres_data:/var/lib/postgresql/data");
    expect(compose).toContain("redis_data:/data");
    expect(environmentExample).toContain("COMPOSE_PROJECT_NAME=carbon-trader");
    expect(environmentExample).toContain("INGRESS_PORT=8089");
    expect(environmentExample).toContain("PUBLIC_BASE_PATH=/carbon-trader");
    expect(environmentExample).toContain("CORS_ALLOWED_ORIGINS=http://173.234.14.233");
    expect(environmentExample).not.toMatch(/JWT_(ACCESS|REFRESH)_SECRET=[A-Za-z0-9+/]{32,}$/m);
    expect(environmentExample).not.toMatch(/POSTGRES_PASSWORD=[A-Za-z0-9+/]{24,}$/m);
  });

  it("does not enable HSTS before real HTTPS termination is configured", () => {
    expect(nginx.toLowerCase()).not.toContain("strict-transport-security");
    expect(nginx).toContain("X-Content-Type-Options");
    expect(nginx).toContain("Referrer-Policy");
    expect(nginx).toContain("X-Frame-Options");
  });
});
