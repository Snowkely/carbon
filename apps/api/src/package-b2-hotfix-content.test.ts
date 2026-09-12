import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { projectMissionFiveDecision, scoreMissionFive } from "@carbon/game-rules";
import { packageB2MissionFiveScoringComponents } from "../prisma/package-b2-content";
import { packageB2HotfixMarketPrice, packageB2HotfixMissionFiveScenario, packageB2HotfixProjects } from "../prisma/package-b2-hotfix-content";

describe("Package B2 additive market-price hotfix", () => {
  it("publishes a new immutable version based on B2 and never updates old Workshop pins", () => {
    const source = readFileSync(resolve(process.cwd(), "prisma/package-b2-hotfix-content.ts"), "utf8");
    expect(source).toContain('targetCode = "v5.3.1-package-b2-hotfix"');
    expect(source).toContain('versionCode: "v5.3-package-b2"');
    expect(source).not.toContain("workshop.update");
    expect(source).not.toContain("gameContentVersion.updateMany");
  });

  it("sets the corrected active M5 market price with no superseded price literal", () => {
    expect(packageB2HotfixMarketPrice).toBe(64.8);
    expect(packageB2HotfixMissionFiveScenario).toMatchObject({ verifiedEmissions: 110000, allowances: 100000, marketPrice: 64.8 });
    expect(packageB2HotfixMissionFiveScenario.verifiedEmissions - packageB2HotfixMissionFiveScenario.allowances).toBe(10000);
    const source = readFileSync(resolve(process.cwd(), "prisma/package-b2-hotfix-content.ts"), "utf8");
    expect(source).not.toMatch(/54\.8(?:0)?/);
  });

  it("preserves projects and compares every MAC against €64.8", () => {
    expect(packageB2HotfixProjects.map((project) => [project.capacity, project.marginalAbatementCost])).toEqual([[4000, 32], [6000, 46], [8000, 68]]);
    expect(32).toBeLessThan(packageB2HotfixMarketPrice);
    expect(46).toBeLessThan(packageB2HotfixMarketPrice);
    expect(68).toBeGreaterThan(packageB2HotfixMarketPrice);
  });

  it("calculates a 10,000 allowance purchase at €64.8 as €648,000", () => {
    const projection = projectMissionFiveDecision(packageB2HotfixMissionFiveScenario, ["M5-P01", "M5-P02"], { action: "Buy", quantity: 10000 });
    expect(10000 * packageB2HotfixMarketPrice).toBe(648000);
    expect(projection).toMatchObject({ finalAllowances: 110000, finalEmissions: 110000, complianceGap: 0, status: "Compliant", projectedCost: 648000 });
  });

  it("uses corrected cost comparisons while preserving the 40/30/20/10 rubric", () => {
    const result = scoreMissionFive(packageB2HotfixMissionFiveScenario, ["M5-P01", "M5-P02"], { action: "Buy", quantity: 10000 }, "Our shortage position needs compliance coverage through buying allowances.");
    expect(result).toMatchObject({ compliance: 40, costLogic: 15, position: 20, reasoning: 5, benchmarkCost: 404000, total: 80 });
    expect(packageB2MissionFiveScoringComponents.map((component) => [component.stableId, component.weightPoints])).toEqual([["COMPLIANCE", 40], ["COST_LOGIC", 30], ["POSITION", 20], ["REASONING", 10]]);
  });

  it("keeps M1-M5 playable and M6 deferred by cloning the published B2 flags", () => {
    const source = readFileSync(resolve(process.cwd(), "prisma/package-b2-hotfix-content.ts"), "utf8");
    expect(source).toContain('["M1", "M2", "M3", "M4", "M5", "M6"]');
    expect(source).toContain('implemented: ["M1", "M2", "M3", "M4", "M5"]');
  });

  it("keeps newest published content first so new Workshops prefer the hotfix", () => {
    const teacher = readFileSync(resolve(process.cwd(), "src/teacher/teacher.ts"), "utf8");
    expect(teacher).toContain('orderBy: { publishedAt: "desc" }');
  });
});
