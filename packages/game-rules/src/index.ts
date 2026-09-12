import type { AnswerRule } from "@carbon/content-schema";
export type Evaluation = { correct: boolean | null; details: Record<string, unknown> };
const normalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, normalize(item)]));
  return value;
};
const canonical = (value: unknown): string => JSON.stringify(normalize(value));
export function evaluateAnswer(rule: AnswerRule, answer: unknown): Evaluation {
  if (rule.mode === "EXACT") return { correct: canonical(answer) === canonical(rule.answer), details: { mode: rule.mode } };
  if (rule.mode === "MULTI_EXACT") {
    if (!Array.isArray(answer)) return { correct: false, details: { mode: rule.mode } };
    const expected = [...rule.answer].sort(); const actual = [...new Set(answer.map(String))].sort();
    return { correct: canonical(actual) === canonical(expected), details: { mode: rule.mode } };
  }
  if (rule.mode === "NUMERIC") {
    const numeric = typeof answer === "number" ? answer : Number(answer);
    const tolerance = rule.tolerance ?? Math.abs(rule.answer) * ((rule.tolerancePercent ?? 0) / 100);
    return { correct: Number.isFinite(numeric) && Math.abs(numeric - rule.answer) <= tolerance, details: { mode: rule.mode, tolerance, tolerancePercent: rule.tolerancePercent } };
  }
  if (rule.rubricRef === "M3_LOWEST_COST_COMPLIANCE") {
    const submitted = answer && typeof answer === "object" ? answer as Record<string, unknown> : {};
    const shortage = Number(rule.rubric.shortage);
    const availableReduction = Number(rule.rubric.availableReduction);
    const mac = Number(rule.rubric.mac);
    const allowancePrice = Number(rule.rubric.allowancePrice);
    const expectedReduce = mac < allowancePrice ? Math.min(shortage, availableReduction) : 0;
    const expectedBuy = shortage - expectedReduce;
    const reduce = Number(submitted.reduce);
    const buy = Number(submitted.buy);
    return { correct: reduce === expectedReduce && buy === expectedBuy, details: { mode: rule.mode, rubricRef: rule.rubricRef, expectedReduce, expectedBuy } };
  }
  if (rule.rubricRef === "M5_ACTION_DECISION") {
    const submitted = answer && typeof answer === "object" ? answer as Record<string, unknown> : {};
    const action = String(submitted.action ?? "");
    const quantity = Number(submitted.quantity);
    const valid = ["Reduce", "Buy", "Sell", "Hold"].includes(action) && Number.isFinite(quantity) && quantity >= 0;
    return { correct: valid, details: { mode: rule.mode, rubricRef: rule.rubricRef, evidenceScore: valid ? Number(rule.rubric.evidencePoints ?? 0) : 0 } };
  }
  if (rule.rubricRef === "M5_REASONING_RUBRIC") {
    const reasoning = evaluateMissionFiveReasoning(typeof answer === "string" ? answer : "");
    return { correct: true, details: { mode: rule.mode, rubricRef: rule.rubricRef, evidenceScore: reasoning.score, reasoning } };
  }
  if (rule.rubricRef === "M6_POLICY_SHOCK_STRATEGY" || rule.rubricRef === "M6_INTEGRATED_STRATEGY") {
    const submitted = typeof answer === "string" ? answer : "";
    const options = Array.isArray(rule.rubric.options) ? rule.rubric.options.map(String) : [];
    const preferredOption = String(rule.rubric.preferredOption ?? "");
    const valid = options.includes(submitted);
    const correct = valid && submitted === preferredOption;
    return {
      correct,
      details: {
        mode: rule.mode,
        rubricRef: rule.rubricRef,
        evidenceScore: correct ? Number(rule.rubric.evidencePoints ?? 0) : 0,
        preferredOption,
        configuredTrainingScenario: true
      }
    };
  }
  return { correct: null, details: { mode: rule.mode, rubricRef: rule.rubricRef } };
}
export function evaluateOrderedMultiExact(rule: AnswerRule, answer: unknown): Evaluation {
  if (rule.mode !== "MULTI_EXACT") return evaluateAnswer(rule, answer);
  const actual = Array.isArray(answer) ? answer.map(String) : [];
  return { correct: canonical(actual) === canonical(rule.answer), details: { mode: rule.mode, orderMatters: true } };
}
export function retryFactor(attemptNumber: number, factors: readonly number[]): number { return factors[attemptNumber - 1] ?? 0; }
export function candidateScore(baseScore: number, correct: boolean, attemptNumber: number, factors: readonly number[]): number { return correct ? baseScore * retryFactor(attemptNumber, factors) : 0; }
export type MissionOnePolicy = { explorationPoints: number; boundaryRawMax: number; boundaryWeight: number; reflectionPoints: number; assistance: { noHint: number; hintUsed: number; reveal: number } };
export function assistanceBonus(hintUsed: boolean, revealUsed: boolean, policy: MissionOnePolicy["assistance"]): number { return revealUsed ? policy.reveal : hintUsed ? policy.hintUsed : policy.noHint; }
export function proportionalComponent(rawEarned: number, rawMax: number, weight: number): number { if (rawMax <= 0) throw new Error("rawMax must be positive"); return Math.max(0, Math.min(weight, (rawEarned / rawMax) * weight)); }
export type ScoringContribution = { sourceType?: string; sourceRef?: string; rawMax?: number };
export type ScoringComponent = { stableId?: string; weightPoints?: number; normalization?: "PROPORTIONAL" | "DIRECT" | "TABLE"; mappingStatus?: "ACTIVE" | "INACTIVE_UNMAPPED"; contributions?: ScoringContribution[] };
export function configuredMissionBreakdown(components: readonly ScoringComponent[], scores: ReadonlyMap<string, number>) {
  const breakdown = components.map((component) => {
    const questionContributions = (component.contributions ?? []).filter((item) => item.sourceType === "QUESTION_RESULT" && item.sourceRef);
    const inactive = component.mappingStatus === "INACTIVE_UNMAPPED" || questionContributions.length === 0;
    if (inactive) return { stableId: component.stableId ?? "UNKNOWN", earned: null, maximum: Number(component.weightPoints ?? 0), status: "INACTIVE_UNMAPPED" as const };
    const rawEarned = questionContributions.reduce((sum, item) => sum + (scores.get(item.sourceRef!) ?? 0), 0);
    const rawMax = questionContributions.reduce((sum, item) => sum + Number(item.rawMax ?? 0), 0);
    const earned = component.normalization === "DIRECT" ? rawEarned : proportionalComponent(rawEarned, rawMax, Number(component.weightPoints ?? 0));
    return { stableId: component.stableId ?? "UNKNOWN", earned, maximum: Number(component.weightPoints ?? 0), status: "ACTIVE" as const };
  });
  const total = Math.round(breakdown.reduce((sum, component) => sum + (component.earned ?? 0), 0) * 100) / 100;
  return { components: breakdown, total };
}
export function configuredMissionScore(components: readonly ScoringComponent[], scores: ReadonlyMap<string, number>): number {
  return configuredMissionBreakdown(components, scores).total;
}
export type FootprintActivity = { activityData: number; emissionFactor: number; divisor?: number; scope: "Scope 1" | "Scope 2" | "Scope 3" };
export function calculateFootprint(activities: readonly FootprintActivity[]) {
  const values = activities.map((activity) => activity.activityData * activity.emissionFactor / (activity.divisor ?? 1));
  const byScope = activities.reduce<Record<FootprintActivity["scope"], number>>((totals, activity, index) => ({ ...totals, [activity.scope]: totals[activity.scope] + (values[index] ?? 0) }), { "Scope 1": 0, "Scope 2": 0, "Scope 3": 0 });
  return { values, byScope, total: values.reduce((sum, value) => sum + value, 0) };
}
export type EtsCompanyInput = { id: string; allocation: number; verifiedEmissions: number };
export type EtsSimulationConfig = { cap: number; companies: readonly EtsCompanyInput[] };
export type EtsTrade = { seller: string; buyer: string; quantity: number };
export type EtsCompanyState = EtsCompanyInput & { finalAllowances: number; position: number; surplus: number; shortage: number; complianceGap: number; status: "Compliant" | "Non-compliant" };

export function calculateEtsState(config: EtsSimulationConfig, trades: readonly EtsTrade[] = []) {
  const allocationTotal = config.companies.reduce((sum, company) => sum + company.allocation, 0);
  if (allocationTotal !== config.cap) throw new Error("ETS allocations must equal the cap");
  const allowances = new Map(config.companies.map((company) => [company.id, company.allocation]));
  for (const trade of trades) {
    const seller = config.companies.find((company) => company.id === trade.seller);
    const buyer = config.companies.find((company) => company.id === trade.buyer);
    if (!seller || !buyer || seller.id === buyer.id) throw new Error("ETS trade requires different known companies");
    if (!Number.isFinite(trade.quantity) || trade.quantity <= 0) throw new Error("ETS trade quantity must be positive");
    const sellerAllowances = allowances.get(seller.id)!;
    const buyerAllowances = allowances.get(buyer.id)!;
    const sellerSurplus = Math.max(0, sellerAllowances - seller.verifiedEmissions);
    if (trade.quantity > sellerSurplus) throw new Error(`${seller.id} cannot sell more than its available surplus of ${sellerSurplus}`);
    allowances.set(seller.id, sellerAllowances - trade.quantity);
    allowances.set(buyer.id, buyerAllowances + trade.quantity);
  }
  const companies: EtsCompanyState[] = config.companies.map((company) => {
    const finalAllowances = allowances.get(company.id)!;
    const position = company.allocation - company.verifiedEmissions;
    const complianceGap = company.verifiedEmissions - finalAllowances;
    return {
      ...company,
      finalAllowances,
      position,
      surplus: Math.max(0, finalAllowances - company.verifiedEmissions),
      shortage: Math.max(0, complianceGap),
      complianceGap,
      status: complianceGap <= 0 ? "Compliant" : "Non-compliant"
    };
  });
  return { cap: config.cap, allocationTotal, trades: [...trades], companies };
}

export function commitEtsTrade(config: EtsSimulationConfig, committedTrades: readonly EtsTrade[], trade: EtsTrade) {
  return calculateEtsState(config, [...committedTrades, trade]);
}

export type MissionFiveProject = { id: string; name: string; capacity: number; marginalAbatementCost: number };
export type MissionFiveScenario = {
  verifiedEmissions: number;
  allowances: number;
  marketPrice: number;
  bankingEnabled: boolean;
  projects: readonly MissionFiveProject[];
};
export type MissionFiveAction = "Reduce" | "Buy" | "Sell" | "Hold";
export type MissionFiveDecision = { action: MissionFiveAction; quantity: number | string };
export type MissionFiveProjection = {
  action: MissionFiveAction;
  quantity: number;
  initialGap: number;
  availableReductionCapacity: number;
  availableSurplus: number;
  finalAllowances: number;
  finalEmissions: number;
  complianceGap: number;
  status: "Compliant" | "Non-compliant";
  projectedCost: number;
};

const assertMissionFiveScenario = (scenario: MissionFiveScenario) => {
  if (![scenario.verifiedEmissions, scenario.allowances, scenario.marketPrice].every(Number.isFinite)) throw new Error("Mission 5 scenario values must be finite");
  if (!Array.isArray(scenario.projects) || scenario.projects.some((project) => !project.id || !Number.isFinite(project.capacity) || project.capacity < 0 || !Number.isFinite(project.marginalAbatementCost) || project.marginalAbatementCost < 0)) throw new Error("Mission 5 projects are invalid");
};

export function projectMissionFiveDecision(scenario: MissionFiveScenario, selectedProjectIds: readonly string[], decision: MissionFiveDecision): MissionFiveProjection {
  assertMissionFiveScenario(scenario);
  if (!["Reduce", "Buy", "Sell", "Hold"].includes(decision.action)) throw new Error("Choose a known Mission 5 action");
  const quantity = typeof decision.quantity === "number" ? decision.quantity : typeof decision.quantity === "string" && decision.quantity.trim() ? Number(decision.quantity) : Number.NaN;
  if (!Number.isFinite(quantity) || quantity < 0) throw new Error("Decision quantity must be a non-negative number");
  const selectedIds = [...new Set(selectedProjectIds)];
  if (selectedIds.length !== selectedProjectIds.length) throw new Error("Selected projects must be unique");
  const selected = selectedIds.map((id) => scenario.projects.find((project) => project.id === id) ?? (() => { throw new Error(`Unknown reduction project: ${id}`); })());
  const availableReductionCapacity = selected.reduce((sum, project) => sum + project.capacity, 0);
  const initialGap = scenario.verifiedEmissions - scenario.allowances;
  const availableSurplus = Math.max(0, -initialGap);
  let finalAllowances = scenario.allowances;
  let finalEmissions = scenario.verifiedEmissions;
  let projectedCost = 0;
  if (decision.action === "Reduce") {
    if (quantity > availableReductionCapacity) throw new Error(`Reduction cannot exceed selected project capacity of ${availableReductionCapacity}`);
    let remaining = quantity;
    for (const project of [...selected].sort((left, right) => left.marginalAbatementCost - right.marginalAbatementCost || left.id.localeCompare(right.id))) {
      const used = Math.min(remaining, project.capacity);
      projectedCost += used * project.marginalAbatementCost;
      remaining -= used;
    }
    finalEmissions -= quantity;
  } else if (decision.action === "Buy") {
    finalAllowances += quantity;
    projectedCost = quantity * scenario.marketPrice;
  } else if (decision.action === "Sell") {
    if (initialGap > 0) throw new Error("A company with a shortage cannot sell allowances");
    if (quantity > availableSurplus) throw new Error(`Selling cannot exceed available surplus of ${availableSurplus}`);
    finalAllowances -= quantity;
    projectedCost = -quantity * scenario.marketPrice;
  } else {
    if (!scenario.bankingEnabled) throw new Error("Hold / bank is not enabled in this content version");
    if (quantity !== 0) throw new Error("Hold quantity must be zero");
  }
  const complianceGap = finalEmissions - finalAllowances;
  return {
    action: decision.action, quantity, initialGap, availableReductionCapacity, availableSurplus,
    finalAllowances, finalEmissions, complianceGap, status: complianceGap <= 0 ? "Compliant" : "Non-compliant",
    projectedCost: Math.round(projectedCost * 100) / 100
  };
}

export function evaluateMissionFiveReasoning(text: string) {
  const normalized = text.toLowerCase();
  const concepts = {
    marginalCostVsPrice: /(?:mac|marginal abatement|abatement cost)/.test(normalized) && /(?:market )?price|allowance cost|€|eur/.test(normalized) && /lower|higher|below|above|cheaper|expensive|compare/.test(normalized),
    position: /shortage|short position|deficit|emissions exceed|allowances.*emissions|position/.test(normalized),
    complianceEffect: /compliance|compliant|compliance gap|surrender|cover/.test(normalized) && /reduce|reduction|buy|allowance|emissions/.test(normalized)
  };
  const conceptCount = Object.values(concepts).filter(Boolean).length;
  return { score: conceptCount === 3 ? 10 : conceptCount === 2 ? 5 : 0, conceptCount, concepts };
}

export function scoreMissionFive(scenario: MissionFiveScenario, selectedProjectIds: readonly string[], decision: MissionFiveDecision, reasoningText: string) {
  const projection = projectMissionFiveDecision(scenario, selectedProjectIds, decision);
  const initialShortage = Math.max(0, scenario.verifiedEmissions - scenario.allowances);
  const lowCostProjects = scenario.projects.filter((project) => project.marginalAbatementCost < scenario.marketPrice).sort((left, right) => left.marginalAbatementCost - right.marginalAbatementCost || left.id.localeCompare(right.id));
  let remaining = initialShortage;
  let benchmarkCost = 0;
  for (const project of lowCostProjects) {
    const used = Math.min(remaining, project.capacity);
    benchmarkCost += used * project.marginalAbatementCost;
    remaining -= used;
  }
  benchmarkCost += remaining * scenario.marketPrice;
  const compliance = projection.status === "Compliant" ? 40 : 0;
  const position = initialShortage > 0 && (decision.action === "Reduce" || decision.action === "Buy") && projection.quantity > 0 ? 20 : 0;
  const improvesShortage = projection.complianceGap < initialShortage;
  const costLogic = projection.status === "Compliant" && projection.projectedCost <= benchmarkCost
    ? 30
    : projection.status === "Compliant"
      ? 15
      : improvesShortage && (decision.action === "Reduce" || decision.action === "Buy")
        ? 10
        : 0;
  const reasoning = evaluateMissionFiveReasoning(reasoningText);
  const feedback = [
    compliance === 40 ? "The submitted plan reaches compliance." : "The submitted plan leaves a compliance gap.",
    costLogic === 30 ? "The plan uses the lowest-cost compliant route." : costLogic > 0 ? "The plan improves or reaches compliance, but a lower-cost route is available." : "The plan does not make cost-effective progress toward compliance.",
    position === 20 ? "The action is consistent with the initial shortage." : "The action conflicts with, or does not address, the initial shortage.",
    reasoning.score === 10 ? "The explanation connects marginal cost, market price, position and compliance." : "The explanation should connect marginal cost versus price, the firm's position, and the compliance effect."
  ];
  return { total: compliance + costLogic + position + reasoning.score, compliance, costLogic, position, reasoning: reasoning.score, benchmarkCost, projection, reasoningEvaluation: reasoning, feedback };
}
export function missionOneScore(input: { explorationComplete: boolean; q01: number; cardScores: number[]; boundaryScores: number[]; reflectionComplete: boolean; hintUsed: boolean; revealUsed: boolean }, policy: MissionOnePolicy): number {
  return missionOneBreakdown(input, policy).total;
}
export function missionOneBreakdown(input: { explorationComplete: boolean; q01: number; cardScores: number[]; boundaryScores: number[]; reflectionComplete: boolean; hintUsed: boolean; revealUsed: boolean }, policy: MissionOnePolicy) {
  const scan = (input.explorationComplete ? policy.explorationPoints : 0) + input.q01;
  const cards = input.cardScores.reduce((sum, value) => sum + value, 0);
  const boundary = proportionalComponent(input.boundaryScores.reduce((sum, value) => sum + value, 0), policy.boundaryRawMax, policy.boundaryWeight);
  const reasoning = (input.reflectionComplete ? policy.reflectionPoints : 0) + assistanceBonus(input.hintUsed, input.revealUsed, policy.assistance);
  return { scan, cards, boundary, reasoning, total: Math.round((scan + cards + boundary + reasoning) * 100) / 100 };
}
export function carbonMarketIq(scores: readonly number[], weights: readonly number[]): number | null { if (scores.length !== 6 || weights.length !== 6 || scores.some((score) => !Number.isFinite(score)) || Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 1) > 1e-9) return null; return Math.round(scores.reduce((sum, score, index) => sum + score * (weights[index] ?? 0), 0) * 100) / 100; }

export function normalizeActiveMissionScore(activeRaw: number, activeRawMax: number): number {
  return Math.round(proportionalComponent(activeRaw, activeRawMax, 100) * 100) / 100;
}

export type MissionSixBreakdown = { round1: number; round2: number; round3: number; total: number };
export function scoreMissionSix(scores: ReadonlyMap<string, number>): MissionSixBreakdown {
  const sum = (ids: readonly string[]) => ids.reduce((total, id) => total + (scores.get(id) ?? 0), 0);
  const round1 = proportionalComponent(sum(["M6-Q01", "M6-Q02", "M6-Q03"]), 15, 50);
  const round2 = proportionalComponent(sum(["M6-Q11", "M6-Q12", "M6-Q13", "M6-Q14"]), 20, 25);
  const round3 = proportionalComponent(sum(["M6-Q21", "M6-Q22", "M6-Q23"]), 30, 25);
  const rounded = (value: number) => Math.round(value * 100) / 100;
  return { round1: rounded(round1), round2: rounded(round2), round3: rounded(round3), total: rounded(round1 + round2 + round3) };
}

export const FINAL_MISSION_ORDER = ["M1", "M2", "M3", "M4", "M5", "M6"] as const;
export function carbonMarketLevel(score: number): string {
  if (score >= 90) return "Carbon Market Navigator";
  if (score >= 80) return "Carbon Trader";
  if (score >= 70) return "Carbon Explorer";
  if (score >= 60) return "Carbon Learner";
  return "Review recommended before Level II";
}

export function summarizeCarbonMarketIq(scores: Readonly<Record<string, number>>, weights: Readonly<Record<string, number>>) {
  if (!FINAL_MISSION_ORDER.every((id) => Number.isFinite(scores[id]) && Number.isFinite(weights[id]))) return null;
  const calculatedScore = carbonMarketIq(FINAL_MISSION_ORDER.map((id) => scores[id]!), FINAL_MISSION_ORDER.map((id) => weights[id]!));
  if (calculatedScore === null) return null;
  const ranked = [...FINAL_MISSION_ORDER].sort((left, right) => scores[right]! - scores[left]! || FINAL_MISSION_ORDER.indexOf(left) - FINAL_MISSION_ORDER.indexOf(right));
  const reverseRanked = [...FINAL_MISSION_ORDER].sort((left, right) => scores[left]! - scores[right]! || FINAL_MISSION_ORDER.indexOf(left) - FINAL_MISSION_ORDER.indexOf(right));
  return { calculatedScore, level: carbonMarketLevel(calculatedScore), topStrength: ranked[0]!, conceptToReview: reverseRanked[0]! };
}
