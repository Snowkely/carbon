import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "../..");
const classroom = readFileSync(resolve(root, "docker-compose.classroom.yml"), "utf8");
const production = readFileSync(resolve(root, "docker-compose.production.yml"), "utf8");
const gitignore = readFileSync(resolve(root, ".gitignore"), "utf8");
const packager = readFileSync(resolve(root, "scripts/package-classroom.ps1"), "utf8");
const nginx = readFileSync(resolve(root, "deploy/local-classroom/nginx.conf"), "utf8");
const studentNginx = readFileSync(resolve(root, "deploy/local-classroom/student-web.nginx.conf"), "utf8");
const studentDockerfile = readFileSync(resolve(root, "deploy/docker/student-web.Dockerfile"), "utf8");

describe("local classroom distribution", () => {
  it("publishes only LAN Nginx and leaves application/data services internal", () => {
    expect(classroom.match(/^\s+ports:/gm)).toHaveLength(1);
    expect(classroom).toContain('"0.0.0.0:${CLASSROOM_PORT:-8088}:8080"');
    for (const service of ["postgres", "redis", "api", "teacher-web", "student-web"]) {
      const section = classroom.split(`\n  ${service}:`)[1]!.split(/\n  [a-z][\w-]*:/)[0]!;
      expect(section).not.toMatch(/\n\s+ports:/);
    }
    expect(classroom).toMatch(/backend: \{ internal: true \}/);
  });

  it("builds and serves the Expo Student Web SPA only under /student", () => {
    expect(classroom).toContain("deploy/docker/student-web.Dockerfile");
    expect(classroom).toContain("student-web: { condition: service_healthy }");
    expect(studentDockerfile).toContain("pnpm run build:mobile-deps");
    expect(studentDockerfile).toContain("pnpm --filter @carbon/mobile build:classroom-web");
    expect(studentDockerfile).not.toContain("EXPO_PUBLIC_API_URL");
    expect(nginx).toContain("location = /student");
    expect(nginx).toContain("location ^~ /student/");
    expect(nginx).toContain("proxy_pass http://student_web");
    expect(studentNginx).toContain("try_files $uri $uri/ /student/index.html");
    expect(nginx).toContain("location = /v1/student/sessions/active");
    expect(nginx).toContain('add_header Cache-Control "no-store" always;');
  });

  it("keeps production ingress loopback-only", () => {
    expect(production).toContain('"127.0.0.1:${INGRESS_PORT:-8088}:8080"');
    expect(production).not.toContain("0.0.0.0:${INGRESS_PORT");
  });

  it("ignores classroom secrets, dumps, and optional APK artifacts", () => {
    expect(gitignore).toMatch(/^\.env\*$/m);
    expect(gitignore).toContain("**/*.dump");
    expect(gitignore).toContain("deploy/local-classroom/downloads/*.apk");
    expect(gitignore).toContain("*.jks");
    expect(gitignore).toContain("*.keystore");
  });

  it("rejects sensitive release content before and after ZIP creation", () => {
    for (const pattern of [".env.classroom", ".dump", ".pem", ".key", ".jks", ".keystore", "PRIVATE KEY", "ZipFile"]) expect(packager).toContain(pattern);
    expect(packager).toContain("[\\\\/]");
    expect(packager).toContain("Secret/package scan: PASS");
  });

  it("serves only the named APK with the Android package content type", () => {
    expect(nginx).toContain("location = /downloads/CarbonTrader.apk");
    expect(nginx).toContain("application/vnd.android.package-archive");
    expect(nginx).toContain("location ^~ /downloads/ { return 404; }");
    expect(nginx).not.toContain("autoindex on");
  });

  it("uses hardened images and one-shot migration/initialization", () => {
    expect(classroom).toContain("deploy/docker/api.Dockerfile");
    expect(classroom).toContain("deploy/docker/teacher-web.Dockerfile");
    expect(classroom).toContain("deploy/docker/student-web.Dockerfile");
    expect(classroom).toContain('"migrate", "deploy"');
    expect(classroom).toContain("CLASSROOM_BOOTSTRAP: \"true\"");
  });
});
