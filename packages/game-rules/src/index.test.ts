import { describe, expect, it } from "vitest";
import { assistanceBonus, calculateEtsState, calculateFootprint, candidateScore, carbonMarketIq, commitEtsTrade, configuredMissionBreakdown, configuredMissionScore, evaluateAnswer, evaluateMissionFiveReasoning, evaluateOrderedMultiExact, missionOneBreakdown, missionOneScore, normalizeActiveMissionScore, projectMissionFiveDecision, proportionalComponent, scoreMissionFive, scoreMissionSix, summarizeCarbonMarketIq } from "./index.js";
describe("question evaluation", () => {
  it("evaluates exact, nested exact, multi-exact and numeric rules", () => {
    expect(evaluateAnswer({ mode: "EXACT", answer: "Scope 1" }, "Scope 1").correct).toBe(true);
    expect(evaluateAnswer({ mode: "EXACT", answer: { before: "Scope 3", after: "Scope 1" } }, { after: "Scope 1", before: "Scope 3" }).correct).toBe(true);
    expect(evaluateAnswer({ mode: "MULTI_EXACT", answer: ["A", "B"] }, ["B", "A"]).correct).toBe(true);
    expect(evaluateAnswer({ mode: "MULTI_EXACT", answer: ["A", "B"] }, ["A", "A"]).correct).toBe(false);
    expect(evaluateAnswer({ mode: "NUMERIC", answer: 100, tolerance: 0.5 }, 100.4).correct).toBe(true);
    expect(evaluateAnswer({ mode: "NUMERIC", answer: 250, tolerancePercent: 0.5 }, 251.25).correct).toBe(true);
    expect(evaluateAnswer({ mode: "NUMERIC", answer: 250, tolerancePercent: 0.5 }, 251.26).correct).toBe(false);
  });
  it("evaluates the configured deterministic M3 compliance strategy", () => {
    const rule = { mode: "STRATEGY" as const, rubricRef: "M3_LOWEST_COST_COMPLIANCE", rubric: { shortage: 20000, availableReduction: 8000, mac: 40, allowancePrice: 65 } };
    expect(evaluateAnswer(rule, { reduce: 8000, buy: 12000 }).correct).toBe(true);
    expect(evaluateAnswer(rule, { reduce: 0, buy: 20000 }).correct).toBe(false);
  });
  it("applies the supplied versioned retry factors and rejects a fourth independent score", () => { const factors=[1,0.9,0.8]; expect(candidateScore(8, true, 1, factors)).toBe(8); expect(candidateScore(8, true, 2, factors)).toBe(7.2); expect(candidateScore(8, true, 3, factors)).toBe(6.4); expect(candidateScore(8, true, 4, factors)).toBe(0); expect(candidateScore(8, false, 1, factors)).toBe(0); });
  it("requires exact sequence for an ORDER / MULTI_EXACT activity", () => {
    const rule = { mode: "MULTI_EXACT" as const, answer: ["Set Cap", "Allocate / Auction", "Emit", "MRV", "Trade", "Surrender", "Compliance / Penalty"] };
    expect(evaluateOrderedMultiExact(rule, rule.answer).correct).toBe(true);
    expect(evaluateOrderedMultiExact(rule, [...rule.answer].reverse()).correct).toBe(false);
  });
});
describe("Mission 4 authoritative ETS engine", () => {
  const simulation = { cap: 300000, companies: [
    { id: "GreenTex", allocation: 100000, verifiedEmissions: 80000 },
    { id: "SteelCo", allocation: 100000, verifiedEmissions: 130000 },
    { id: "PowerCo", allocation: 100000, verifiedEmissions: 90000 }
  ] };
  it("derives the cap, allocations, emissions, signed positions, surpluses and shortage", () => {
    const state = calculateEtsState(simulation);
    expect(state.cap).toBe(300000);
    expect(state.companies.map((company) => company.allocation)).toEqual([100000, 100000, 100000]);
    expect(state.companies.map((company) => company.verifiedEmissions)).toEqual([80000, 130000, 90000]);
    expect(state.companies.map((company) => company.position)).toEqual([20000, -30000, 10000]);
    expect(state.companies.map((company) => company.surplus)).toEqual([20000, 0, 10000]);
    expect(state.companies.find((company) => company.id === "SteelCo")?.shortage).toBe(30000);
  });
  it("keeps the position sign authoritative", () => {
    expect(evaluateAnswer({ mode: "NUMERIC", answer: -30000, tolerance: 0 }, -30000).correct).toBe(true);
    expect(evaluateAnswer({ mode: "NUMERIC", answer: -30000, tolerance: 0 }, 30000).correct).toBe(false);
  });
  it("rejects sales above each seller's current available surplus", () => {
    expect(() => commitEtsTrade(simulation, [], { seller: "GreenTex", buyer: "SteelCo", quantity: 20001 })).toThrow("available surplus of 20000");
    expect(() => commitEtsTrade(simulation, [], { seller: "PowerCo", buyer: "SteelCo", quantity: 10001 })).toThrow("available surplus of 10000");
  });
  it("updates shortage after committed trades and produces exact final compliance", () => {
    const afterFirst = calculateEtsState(simulation, [{ seller: "GreenTex", buyer: "SteelCo", quantity: 20000 }]);
    expect(afterFirst.companies.find((company) => company.id === "SteelCo")?.shortage).toBe(10000);
    const final = calculateEtsState(simulation, [{ seller: "GreenTex", buyer: "SteelCo", quantity: 20000 }, { seller: "PowerCo", buyer: "SteelCo", quantity: 10000 }]);
    expect(final.companies.find((company) => company.id === "SteelCo")).toMatchObject({ finalAllowances: 130000, verifiedEmissions: 130000, complianceGap: 0, status: "Compliant" });
  });
  it("normalizes raw Mission 4 evidence into the 35/25/25/15 score out of 100", () => {
    const components = [
      { weightPoints: 35, normalization: "PROPORTIONAL" as const, contributions: [{ sourceType: "QUESTION_RESULT", sourceRef: "M4-Q01", rawMax: 21 }] },
      { weightPoints: 25, normalization: "PROPORTIONAL" as const, contributions: [2,3,4].map((number) => ({ sourceType: "QUESTION_RESULT", sourceRef: `M4-Q0${number}`, rawMax: 5 })) },
      { weightPoints: 25, normalization: "PROPORTIONAL" as const, contributions: [5,6].map((number) => ({ sourceType: "QUESTION_RESULT", sourceRef: `M4-Q0${number}`, rawMax: 5 })) },
      { weightPoints: 15, normalization: "PROPORTIONAL" as const, contributions: [7,8,9].map((number) => ({ sourceType: "QUESTION_RESULT", sourceRef: `M4-Q0${number}`, rawMax: 5 })) }
    ];
    const scores = new Map([["M4-Q01", 21], ...[2,3,4,5,6,7,8,9].map((number) => [`M4-Q0${number}`, 5] as [string, number])]);
    expect(configuredMissionScore(components, scores)).toBe(100);
  });
});
describe("Package A generic scoring and footprint rules", () => {
  it("derives all five M2 calculations and Scope totals from canonical activities", () => {
    const result = calculateFootprint([
      { activityData: 500000, emissionFactor: 0.5, divisor: 1000, scope: "Scope 2" },
      { activityData: 20000, emissionFactor: 2.68, divisor: 1000, scope: "Scope 1" },
      { activityData: 100, emissionFactor: 3.2, scope: "Scope 3" },
      { activityData: 50, emissionFactor: 0.18, scope: "Scope 3" },
      { activityData: 10, emissionFactor: 0.6, scope: "Scope 3" }
    ]);
    expect(result.values).toEqual([250, 53.6, 320, 9, 6]);
    expect(result.byScope).toEqual({ "Scope 1": 53.6, "Scope 2": 250, "Scope 3": 335 });
    expect(result.total).toBe(638.6);
  });

  it("normalizes configured question components and leaves unresolved bonus at zero", () => {
    const components = [
      { weightPoints: 45, normalization: "PROPORTIONAL" as const, contributions: [{ sourceType: "QUESTION_RESULT", sourceRef: "Q1", rawMax: 5 }] },
      { weightPoints: 5, normalization: "TABLE" as const, contributions: [] }
    ];
    expect(configuredMissionScore(components, new Map([["Q1", 5]]))).toBe(45);
  });
});
describe("Mission 5 authoritative first-trade engine", () => {
  const scenario = { verifiedEmissions: 110000, allowances: 100000, marketPrice: 64.8, bankingEnabled: false, projects: [
    { id: "M5-P01", name: "Boiler efficiency controls", capacity: 4000, marginalAbatementCost: 32 },
    { id: "M5-P02", name: "Waste heat recovery", capacity: 6000, marginalAbatementCost: 46 },
    { id: "M5-P03", name: "Fuel switching", capacity: 8000, marginalAbatementCost: 68 }
  ] };
  const cheap = ["M5-P01", "M5-P02"];
  const reasoning = "The MAC is lower than the allowance market price, and our shortage position means reducing emissions closes the compliance gap.";

  it("derives the 10,000 t shortage from 110,000 emissions and 100,000 allowances", () => {
    expect(projectMissionFiveDecision(scenario, cheap, { action: "Reduce", quantity: 0 }).initialGap).toBe(10000);
  });
  it("uses the canonical market price and project cost/capacity ordering", () => {
    expect(scenario.marketPrice).toBe(64.8);
    expect(scenario.projects.map((project) => [project.capacity, project.marginalAbatementCost])).toEqual([[4000, 32], [6000, 46], [8000, 68]]);
    expect(scenario.projects.filter((project) => project.marginalAbatementCost < scenario.marketPrice).reduce((sum, project) => sum + project.capacity, 0)).toBe(10000);
  });
  it("rejects reduction above selected finite capacity", () => expect(() => projectMissionFiveDecision(scenario, cheap, { action: "Reduce", quantity: 10001 })).toThrow("capacity of 10000"));
  it("rejects selling while the company is short and disables Hold/bank", () => {
    expect(() => projectMissionFiveDecision(scenario, cheap, { action: "Sell", quantity: 1 })).toThrow("shortage cannot sell");
    expect(() => projectMissionFiveDecision(scenario, cheap, { action: "Hold", quantity: 0 })).toThrow("not enabled");
  });
  it("projects compliant Reduce and Buy outcomes with exact deterministic costs", () => {
    expect(projectMissionFiveDecision(scenario, cheap, { action: "Reduce", quantity: 10000 })).toMatchObject({ finalEmissions: 100000, finalAllowances: 100000, complianceGap: 0, status: "Compliant", projectedCost: 404000 });
    expect(projectMissionFiveDecision(scenario, cheap, { action: "Buy", quantity: 10000 })).toMatchObject({ finalEmissions: 110000, finalAllowances: 110000, complianceGap: 0, status: "Compliant", projectedCost: 648000 });
  });
  it("normalizes a Mobile TextInput quantity without changing the authoritative projection", () => {
    expect(projectMissionFiveDecision(scenario, cheap, { action: "Buy", quantity: "10000" })).toMatchObject({ quantity: 10000, complianceGap: 0, status: "Compliant", projectedCost: 648000 });
    expect(() => projectMissionFiveDecision(scenario, cheap, { action: "Buy", quantity: "" })).toThrow("non-negative number");
  });
  it("normalizes the best submitted strategy to the 40/30/20/10 rubric", () => {
    expect(scoreMissionFive(scenario, cheap, { action: "Reduce", quantity: 10000 }, reasoning)).toMatchObject({ total: 100, compliance: 40, costLogic: 30, position: 20, reasoning: 10, benchmarkCost: 404000 });
  });
  it("awards deterministic partial outcomes without a minimum passing score", () => {
    expect(scoreMissionFive(scenario, cheap, { action: "Buy", quantity: 10000 }, "We have a shortage position and buying allowances covers compliance.")).toMatchObject({ total: 80, compliance: 40, costLogic: 15, position: 20, reasoning: 5 });
    expect(scoreMissionFive(scenario, cheap, { action: "Reduce", quantity: 1000 }, "cost")).toMatchObject({ total: 30, compliance: 0, costLogic: 10, position: 20, reasoning: 0 });
  });
  it("uses the transparent 10/5/0 reasoning rubric and preserves strategy evidence", () => {
    expect(evaluateMissionFiveReasoning(reasoning).score).toBe(10);
    expect(evaluateMissionFiveReasoning("Our shortage position needs compliance coverage through buying allowances.").score).toBe(5);
    expect(evaluateMissionFiveReasoning("Buy some.").score).toBe(0);
    expect(evaluateAnswer({ mode: "STRATEGY", rubricRef: "M5_REASONING_RUBRIC", rubric: { allThree: 10, anyTwo: 5, oneOrNone: 0 } }, reasoning).details.evidenceScore).toBe(10);
  });
});
describe("M1 scoring", () => {
  const policy = { explorationPoints: 3, boundaryRawMax: 21, boundaryWeight: 10, reflectionPoints: 2, assistance: { noHint: 8, hintUsed: 6, reveal: 0 } };
  it("scores a perfect mission as 100", () => { expect(missionOneScore({ explorationComplete: true, q01: 5, cardScores: Array(12).fill(6), boundaryScores: [8, 5, 8], reflectionComplete: true, hintUsed: false, revealUsed: false }, policy)).toBe(100); });
  it("normalizes boundary without intermediate rounding", () => { expect(proportionalComponent(10.5, 21, 10)).toBe(5); expect(proportionalComponent(8, 21, 10)).toBeCloseTo(3.8095238095238093, 12); });
  it("uses the single Hint policy", () => { expect(assistanceBonus(false, false, policy.assistance)).toBe(8); expect(assistanceBonus(true, false, policy.assistance)).toBe(6); });
  it("makes any reveal zero the assistance bonus", () => expect(assistanceBonus(false, true, policy.assistance)).toBe(0));
  it("awards exactly three exploration points", () => {
    const common = { q01: 0, cardScores: Array(12).fill(0), boundaryScores: [0,0,0], reflectionComplete: false, hintUsed: true, revealUsed: false };
    expect(missionOneScore({ ...common, explorationComplete: true }, policy) - missionOneScore({ ...common, explorationComplete: false }, policy)).toBe(3);
  });
  it("permits a completed evidence set to have a low score", () => expect(missionOneScore({ explorationComplete: true, q01: 0, cardScores: Array(12).fill(0), boundaryScores: [0,0,0], reflectionComplete: true, hintUsed: true, revealUsed: true }, policy)).toBe(5));
  it("exposes the accepted 8/72/10/10 structure without changing its total", () => expect(missionOneBreakdown({ explorationComplete: true, q01: 5, cardScores: Array(12).fill(6), boundaryScores: [8,5,8], reflectionComplete: true, hintUsed: false, revealUsed: false }, policy)).toEqual({ scan: 8, cards: 72, boundary: 10, reasoning: 10, total: 100 }));
});

describe("authoritative Mission score breakdown structures", () => {
  const perfectConfigured = (definitions: Array<{ stableId: string; weightPoints: number }>) => {
    const components = definitions.map((component, index) => ({ ...component, normalization: "PROPORTIONAL" as const, contributions: [{ sourceType: "QUESTION_RESULT", sourceRef: `Q${index}`, rawMax: component.weightPoints }] }));
    return configuredMissionBreakdown(components, new Map(definitions.map((component, index) => [`Q${index}`, component.weightPoints])));
  };
  it.each([
    ["M2", [["UNIT_MATCHING",15],["FACTOR_MATCHING",20],["CALCULATION",25],["HOTSPOT_REASONING",15],["COMPANY_COMPARISON",15],["INTENSITY_REASONING",10]]],
    ["M4", [["PROCESS",35],["POSITION_CALCULATION",25],["TRADE",25],["COMPLIANCE_REASONING",15]]]
  ])("preserves the %s configured component maxima", (_mission, entries) => {
    const definitions = (entries as Array<[string, number]>).map(([stableId, weightPoints]) => ({ stableId, weightPoints }));
    const result = perfectConfigured(definitions);
    expect(result.components.map(({ stableId, maximum }) => [stableId, maximum])).toEqual(entries);
    expect(result.total).toBe(100);
  });
  it("marks M3 Bonus inactive and keeps active raw evidence at 95 for normalization", () => {
    const result = configuredMissionBreakdown([
      { stableId: "CONCEPT", weightPoints: 45, normalization: "DIRECT", contributions: [{ sourceType: "QUESTION_RESULT", sourceRef: "C", rawMax: 45 }] },
      { stableId: "CASES", weightPoints: 35, normalization: "DIRECT", contributions: [{ sourceType: "QUESTION_RESULT", sourceRef: "K", rawMax: 35 }] },
      { stableId: "MISCONCEPTION_CHALLENGE", weightPoints: 15, normalization: "DIRECT", contributions: [{ sourceType: "QUESTION_RESULT", sourceRef: "M", rawMax: 15 }] },
      { stableId: "BONUS", weightPoints: 5, normalization: "TABLE", mappingStatus: "INACTIVE_UNMAPPED", contributions: [] }
    ], new Map([["C",45],["K",35],["M",15]]));
    expect(result.total).toBe(95); expect(normalizeActiveMissionScore(result.total, 95)).toBe(100);
    expect(result.components.at(-1)).toEqual({ stableId: "BONUS", earned: null, maximum: 5, status: "INACTIVE_UNMAPPED" });
  });
  it("preserves M5 40/30/20/10 and M6 50/25/25 dedicated engine outputs", () => {
    expect(scoreMissionFive({ verifiedEmissions:110000,allowances:100000,marketPrice:64.8,bankingEnabled:false,projects:[{id:"p1",name:"One",capacity:10000,marginalAbatementCost:32}] },["p1"],{action:"Reduce",quantity:10000},"MAC is below market price; the shortage position is resolved because reducing emissions closes the compliance gap.")).toMatchObject({ compliance:40,costLogic:30,position:20,reasoning:10,total:100 });
    expect(scoreMissionSix(new Map([["M6-Q01",5],["M6-Q02",5],["M6-Q03",5],["M6-Q11",5],["M6-Q12",5],["M6-Q13",5],["M6-Q14",5],["M6-Q21",5],["M6-Q22",5],["M6-Q23",20]]))).toEqual({ round1:50,round2:25,round3:25,total:100 });
  });
});
describe("Carbon Market IQ", () => {
  const weights = [0.15, 0.15, 0.15, 0.15, 0.2, 0.2];
  it("uses the final frozen weights", () => expect(carbonMarketIq([85.76, 80, 70, 75, 88, 92], weights)).toBe(82.61));
  it("does not fake missing scores", () => expect(carbonMarketIq([100], weights)).toBeNull());
});

describe("Package C Mission 6", () => {
  const perfect = new Map([
    ["M6-Q01", 5], ["M6-Q02", 5], ["M6-Q03", 5], ["M6-Q04", 0],
    ["M6-Q11", 5], ["M6-Q12", 5], ["M6-Q13", 5], ["M6-Q14", 5],
    ["M6-Q21", 5], ["M6-Q22", 5], ["M6-Q23", 20]
  ]);
  it("normalizes the three fixed rounds to exactly 50/25/25 and M6 to 100", () => expect(scoreMissionSix(perfect)).toEqual({ round1: 50, round2: 25, round3: 25, total: 100 }));
  it("uses only the authoritative 15-point Round 1 numeric evidence", () => expect(scoreMissionSix(new Map([["M6-Q01", 5], ["M6-Q02", 5], ["M6-Q03", 5]]))).toEqual({ round1: 50, round2: 0, round3: 0, total: 50 }));
  it("normalizes Round 2 raw max 20 and Round 3 raw max 30", () => {
    expect(scoreMissionSix(new Map([["M6-Q11", 5], ["M6-Q12", 5], ["M6-Q13", 5], ["M6-Q14", 5]])).round2).toBe(25);
    expect(scoreMissionSix(new Map([["M6-Q21", 5], ["M6-Q22", 5], ["M6-Q23", 20]])).round3).toBe(25);
  });
  it("deterministically evaluates both configured strategies", () => {
    const rubric = { options: ["Reduce / Invest", "Buy", "Sell", "Hold"], preferredOption: "Reduce / Invest", evidencePoints: 20, mac: 45, allowancePrice: 75 };
    expect(evaluateAnswer({ mode: "STRATEGY", rubricRef: "M6_INTEGRATED_STRATEGY", rubric }, "Reduce / Invest")).toMatchObject({ correct: true, details: { evidenceScore: 20 } });
    expect(evaluateAnswer({ mode: "STRATEGY", rubricRef: "M6_POLICY_SHOCK_STRATEGY", rubric: { ...rubric, evidencePoints: 0 } }, "Buy")).toMatchObject({ correct: false, details: { evidenceScore: 0 } });
  });
});

describe("Package C M3 normalization and final summary", () => {
  it.each([[95, 100], [90, 94.74], [80, 84.21]])("normalizes active M3 raw %s/95 to %s/100", (raw, expected) => expect(normalizeActiveMissionScore(raw, 95)).toBe(expected));
  it("uses exact 15/15/15/15/20/20 weights and deterministic Mission-order ties", () => {
    const weights = { M1: .15, M2: .15, M3: .15, M4: .15, M5: .2, M6: .2 };
    expect(summarizeCarbonMarketIq({ M1: 100, M2: 100, M3: 100, M4: 100, M5: 100, M6: 100 }, weights)).toMatchObject({ calculatedScore: 100, topStrength: "M1", conceptToReview: "M1" });
    expect(summarizeCarbonMarketIq({ M1: 0, M2: 0, M3: 0, M4: 0, M5: 0, M6: 100 }, weights)?.calculatedScore).toBe(20);
  });
  it("does not fabricate a final result when any Mission is missing", () => expect(summarizeCarbonMarketIq({ M1: 100, M2: 100, M3: 100, M4: 100, M5: 100 }, { M1: .15, M2: .15, M3: .15, M4: .15, M5: .2, M6: .2 })).toBeNull());
});
