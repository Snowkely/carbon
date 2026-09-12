import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { calculateEtsState } from "@carbon/game-rules";
import { packageB1CanonicalTrades, packageB1EtsSimulation, packageB1MissionFourQuestions, packageB1MissionFourScreens, packageB1MissionScoringComponents, packageB1ProcessOrder } from "../prisma/package-b1-content";

const answer = (stableId: string) => (packageB1MissionFourQuestions().find((question) => question.stableId === stableId)!.answerRule as { answer?: unknown }).answer;

describe("Package B1 immutable Mission 4 content", () => {
  it("publishes a new version based on Package A and leaves only M5-M6 deferred", () => {
    const source = readFileSync(resolve(process.cwd(), "prisma/package-b1-content.ts"), "utf8");
    expect(source).toContain('targetCode = "v5.2-package-b1"');
    expect(source).toContain('versionCode: "v5.1-package-a"');
    expect(source).toContain('implemented: ["M1", "M2", "M3", "M4"]');
    expect(source).toMatch(/\["M5"[\s\S]*\["M6"[\s\S]*gameplayImplemented: false/);
    expect(source).not.toContain("gameContentVersion.updateMany");
  });
  it("defines the exact seven-step ORDER / MULTI_EXACT evidence", () => {
    expect(packageB1ProcessOrder).toEqual(["Set Cap", "Allocate / Auction", "Emit", "MRV", "Trade", "Surrender", "Compliance / Penalty"]);
    expect(packageB1MissionFourQuestions()[0]).toMatchObject({ stableId: "M4-Q01", type: "ORDER", mode: "MULTI_EXACT", baseScore: 21, answerRule: { mode: "MULTI_EXACT", answer: packageB1ProcessOrder } });
    expect(packageB1MissionFourQuestions()[0]!.baseScore / packageB1ProcessOrder.length).toBe(3);
  });
  it("uses the six-screen Mission 4 sequence without collapsing the simulation", () => {
    expect(packageB1MissionFourScreens.map((screen) => [screen.stableId, screen.titleEn])).toEqual([["M4-S01", "Process Puzzle"], ["M4-S02", "Allocation"], ["M4-S03", "Emissions / MRV"], ["M4-S04", "Position"], ["M4-S05", "Trade"], ["M4-S06", "Surrender / Compliance"]]);
  });
  it("stores the exact cap, equal allocations, verified emissions and signed position answers", () => {
    expect(packageB1EtsSimulation.cap).toBe(300000);
    expect(packageB1EtsSimulation.companies.map((company) => company.allocation)).toEqual([100000, 100000, 100000]);
    expect(packageB1EtsSimulation.companies.map((company) => company.verifiedEmissions)).toEqual([80000, 130000, 90000]);
    expect([answer("M4-Q02"), answer("M4-Q03"), answer("M4-Q04")]).toEqual([20000, -30000, 10000]);
  });
  it("stores both canonical trades and the exact SteelCo compliance answers", () => {
    expect([answer("M4-Q05"), answer("M4-Q06")]).toEqual(packageB1CanonicalTrades);
    expect([answer("M4-Q07"), answer("M4-Q08"), answer("M4-Q09")]).toEqual([130000, 0, "Compliant"]);
    expect(calculateEtsState(packageB1EtsSimulation, packageB1CanonicalTrades).companies.find((company) => company.id === "SteelCo")).toMatchObject({ finalAllowances: 130000, complianceGap: 0, status: "Compliant" });
  });
  it("normalizes raw evidence into exactly 35/25/25/15", () => {
    expect(packageB1MissionScoringComponents.map((component) => [component.stableId, component.weightPoints])).toEqual([["PROCESS", 35], ["POSITION_CALCULATION", 25], ["TRADE", 25], ["COMPLIANCE_REASONING", 15]]);
    expect(packageB1MissionScoringComponents.reduce((sum, component) => sum + component.weightPoints, 0)).toBe(100);
  });
});
