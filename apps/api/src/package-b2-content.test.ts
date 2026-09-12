import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { packageB2MissionFiveScenario, packageB2MissionFiveScoringComponents, packageB2MissionFiveScreens } from "../prisma/package-b2-content";

describe("Historical Package B2 immutable Mission 5 content", () => {
  it("publishes v5.3 from published B1 without mutating earlier versions", () => {
    const source = readFileSync(resolve(process.cwd(), "prisma/package-b2-content.ts"), "utf8");
    expect(source).toContain('targetCode = "v5.3-package-b2"');
    expect(source).toContain('versionCode: "v5.2-package-b1"');
    expect(source).toContain('implemented: ["M1", "M2", "M3", "M4", "M5"]');
    expect(source).toContain('stableId: "M6"');
    expect(source).toContain('gameplayImplemented: false');
    expect(source).not.toContain("gameContentVersion.updateMany");
  });

  it("uses four distinct gameplay screens and labels every screen as Training simulation", () => {
    expect(packageB2MissionFiveScreens.map((screen) => [screen.stableId, screen.titleEn])).toEqual([
      ["M5-S01", "Know Your Position"],
      ["M5-S02", "Compare Reduction Projects"],
      ["M5-S03", "Choose and Submit an Action"],
      ["M5-S04", "Explain Your Strategy"]
    ]);
    expect(packageB2MissionFiveScenario.label).toBe("Training simulation");
  });

  it("keeps the published B2 starting emissions, allowances and project data reproducible", () => {
    expect(packageB2MissionFiveScenario).toMatchObject({ verifiedEmissions: 110000, allowances: 100000, bankingEnabled: false });
    expect(packageB2MissionFiveScenario.verifiedEmissions - packageB2MissionFiveScenario.allowances).toBe(10000);
    const projects = packageB2MissionFiveScenario.projects;
    expect(projects).toHaveLength(3);
    expect(projects.every((project) => project.capacity > 0 && Number.isFinite(project.marginalAbatementCost))).toBe(true);
    expect(projects.map((project) => [project.capacity, project.marginalAbatementCost])).toEqual([[4000, 32], [6000, 46], [8000, 68]]);
  });

  it("defines the authoritative 40/30/20/10 Mission rubric rather than a raw /45 sum", () => {
    expect(packageB2MissionFiveScoringComponents.map((component) => [component.stableId, component.weightPoints, component.normalization])).toEqual([
      ["COMPLIANCE", 40, "TABLE"], ["COST_LOGIC", 30, "TABLE"], ["POSITION", 20, "TABLE"], ["REASONING", 10, "TABLE"]
    ]);
    expect(packageB2MissionFiveScoringComponents.reduce((sum, component) => sum + component.weightPoints, 0)).toBe(100);
  });

  it("keeps completion score-free and explicitly prevents automatic M6 unlock", () => {
    const source = readFileSync(resolve(process.cwd(), "prisma/package-b2-content.ts"), "utf8");
    expect(source).toContain('minimumScore: null');
    expect(source).toContain('nextMissionAutoUnlock: false');
    expect(source).not.toContain("M3 Bonus");
  });
});
