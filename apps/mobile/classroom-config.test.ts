import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("classroom mobile build and server UX", () => {
  const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
  const config = readFileSync(new URL("./app.config.ts", import.meta.url), "utf8");
  const eas = readFileSync(new URL("./eas.json", import.meta.url), "utf8");
  const mobilePackage = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
  const rootPackage = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  const dockerfiles = [
    readFileSync(new URL("../../deploy/docker/api.Dockerfile", import.meta.url), "utf8"),
    readFileSync(new URL("../../deploy/docker/teacher-web.Dockerfile", import.meta.url), "utf8"),
    readFileSync(new URL("../../deploy/docker/student-web.Dockerfile", import.meta.url), "utf8"),
  ];

  it("requires confirmation and clears authenticated state after a server change", () => {
    expect(app).toContain('Alert.alert("Change classroom server?"');
    expect(app).toContain("await clearAuthenticatedState()");
    expect(app).toContain("await saveClassroomApi(next)");
  });

  it("handles classroom connection links on cold and warm launches", () => {
    expect(app).toContain('Linking.addEventListener("url"');
    expect(app).toContain("Linking.getInitialURL()");
    expect(app).toContain("offerDeepLink(url)");
    expect(app).toContain("offerDeepLink(initialUrl)");
    expect(app).toContain("activateServer(candidate)");
  });

  it("uses selected API for existing login, registration, and mission requests", () => {
    expect(app).toContain('mobileApiRequest(API, "/auth/login"');
    expect(app).toContain("registerStudentAccount");
    expect(app).toContain("mobileApiRequest(API, `/student/mission-attempts/");
  });

  it("limits cleartext/local-network relaxation to internal classroom builds", () => {
    expect(config).toContain('process.env.CLASSROOM_BUILD === "true"');
    expect(config).toContain("classroomBuild: classroom");
    expect(config).toContain("usesCleartextTraffic: true");
    expect(config).toContain("NSAllowsLocalNetworking: true");
    expect(eas).toContain('"CLASSROOM_BUILD": "false"');
    expect(eas).toContain('"CLASSROOM_BUILD": "true"');
    expect(eas).not.toContain("EXPO_PUBLIC_API_URL");
  });

  it("does not require an API URL while importing a portable classroom build", () => {
    expect(app).toContain('const DEFAULT_API = process.env.EXPO_PUBLIC_API_URL?.trim() || null');
    expect(app).not.toContain('if (!DEFAULT_API) throw');
    expect(app).toContain("Classroom server not connected");
    expect(app).toContain("loadSavedClassroomApi(DEFAULT_API, CLASSROOM_BUILD)");
  });

  it("defines a standalone classroom APK while leaving production on the store default", () => {
    const profiles = JSON.parse(eas).build;
    expect(profiles.classroom.distribution).toBe("internal");
    expect(profiles.classroom.android.buildType).toBe("apk");
    expect(profiles.classroom.developmentClient).not.toBe(true);
    expect(profiles.production.distribution).toBe("store");
    expect(profiles.production.android?.buildType).toBeUndefined();
  });

  it("keeps stable Android identity and registers the classroom deep link", () => {
    expect(config).toContain('package: "org.carbontrader.explorer"');
    expect(config).toContain("versionCode: 1");
    expect(config).toContain('scheme: "carbontrader"');
    expect(config).toContain('host: "connect"');
  });

  it("configures a concrete splash image for generated Android resources", () => {
    expect(config).toContain('"expo-splash-screen"');
    expect(config).toContain('image: "./assets/splash-icon.png"');
    expect(config).toContain("imageWidth: 200");
    expect(config).toContain('resizeMode: "contain"');
    expect(existsSync(new URL("./assets/splash-icon.png", import.meta.url))).toBe(true);
  });

  it("builds only Mobile workspace dependencies in the EAS-specific lifecycle", () => {
    expect(rootPackage.scripts["build:mobile-deps"]).toBe('pnpm --filter "@carbon/mobile^..." run build');
    expect(mobilePackage.scripts).not.toHaveProperty("postinstall");
    expect(mobilePackage.scripts["eas-build-post-install"]).toBe("pnpm --dir ../.. run build:mobile-deps");
    expect(mobilePackage.dependencies).toHaveProperty("@carbon/contracts", "workspace:*");
    expect(mobilePackage.dependencies).toHaveProperty("@carbon/ui-tokens", "workspace:*");
    expect(mobilePackage.dependencies).not.toHaveProperty("@carbon/game-rules");
  });

  it("keeps ordinary Docker installs manifest-only and free of Mobile build hooks", () => {
    for (const dockerfile of dockerfiles) {
      const installAt = dockerfile.indexOf("pnpm install --frozen-lockfile");
      const sourceCopyAt = dockerfile.indexOf("COPY . .");
      expect(dockerfile.slice(0, installAt)).toContain("COPY apps/mobile/package.json apps/mobile/package.json");
      expect(dockerfile.slice(0, installAt)).not.toContain("tsconfig.json");
      expect(installAt).toBeGreaterThan(0);
      expect(sourceCopyAt).toBeGreaterThan(installAt);
    }
  });
});
