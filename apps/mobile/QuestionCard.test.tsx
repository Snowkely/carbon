import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Pressable: "Pressable",
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: "Text",
  TextInput: "TextInput",
  View: "View"
}));

import { QuestionCard, strategyAnswerLabel, type MobileQuestion } from "./QuestionCard";

type TestElement = { type: unknown; props: Record<string, any> & { children?: ReactNode } };
function descendants(node: ReactNode): TestElement[] {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as TestElement;
  const children = Array.isArray(element.props.children) ? element.props.children : [element.props.children];
  return [element, ...children.flatMap(descendants)];
}
function textContent(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!node || typeof node !== "object" || !("props" in node)) return "";
  return textContent((node as TestElement).props.children);
}

const question: MobileQuestion = { questionTemplateId: "q1", stableId: "M1-Q01", promptCn: "Which Scope?", type: "SC", options: ["Scope 1", "Scope 2", "Scope 3"], baseScore: 6, finalized: false, attemptsUsed: 0, revealAvailable: false };
const render = (overrides: Partial<Parameters<typeof QuestionCard>[0]> = {}) => QuestionCard({ question, draftAnswer: undefined, onSelect: vi.fn(), onSubmit: vi.fn(), onHint: vi.fn(), onReveal: vi.fn(), ...overrides });

describe("QuestionCard explicit submission", () => {
  it("selecting an option does not submit or create an attempt", () => {
    const onSelect = vi.fn(); const onSubmit = vi.fn();
    const tree = render({ onSelect, onSubmit });
    descendants(tree).find((node) => node.props.accessibilityLabel === "Scope 1")?.props.onPress();
    expect(onSelect).toHaveBeenCalledWith("Scope 1");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("visibly marks the controlled draft selection", () => {
    const tree = render({ draftAnswer: "Scope 2" });
    const selected = descendants(tree).find((node) => node.props.accessibilityLabel === "Scope 2");
    expect(selected?.props.accessibilityState.selected).toBe(true);
    expect(textContent(selected as unknown as ReactNode)).toContain("✓ Scope 2");
  });

  it("disables Submit Answer with no selection and enables it with a draft", () => {
    const findSubmit = (tree: ReactNode) => descendants(tree).find((node) => node.props.accessibilityLabel === "Submit answer for M1-Q01");
    expect(findSubmit(render())?.props.disabled).toBe(true);
    expect(findSubmit(render({ draftAnswer: "Scope 1" }))?.props.disabled).toBe(false);
  });

  it("creates the submission only through the per-question Submit Answer action", () => {
    const onSubmit = vi.fn();
    const tree = render({ draftAnswer: "Scope 1", onSubmit });
    descendants(tree).find((node) => node.props.accessibilityLabel === "Submit answer for M1-Q01")?.props.onPress();
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("keeps Hint independent from submission", () => {
    const onHint = vi.fn(); const onSubmit = vi.fn();
    const tree = render({ draftAnswer: "Scope 1", onHint, onSubmit });
    descendants(tree).find((node) => node.props.accessibilityLabel === "Hint for M1-Q01")?.props.onPress();
    expect(onHint).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows Reveal only when the server reports it available", () => {
    expect(descendants(render()).some((node) => node.props.accessibilityLabel === "Reveal answer for M1-Q01")).toBe(false);
    const tree = render({ question: { ...question, attemptsUsed: 3, revealAvailable: true } });
    expect(descendants(tree).some((node) => node.props.accessibilityLabel === "Reveal answer for M1-Q01")).toBe(true);
  });

  it("renders server-authoritative score and prevents more submissions after resolution", () => {
    const tree = render({ question: { ...question, finalized: true, attemptsUsed: 2, score: 5.399999999999999, resolutionMode: "INDEPENDENT" }, message: "Correct\n5.40 / 6.00 pts\nAttempt 2 submitted" });
    expect(textContent(tree)).toContain("Correct");
    expect(textContent(tree)).toContain("5.40 / 6.00 pts");
    expect(textContent(tree)).not.toContain("5.399999999999999");
    expect(descendants(tree).some((node) => node.props.accessibilityLabel === "Submit answer for M1-Q01")).toBe(false);
  });

  it("formats a revealed result score consistently", () => {
    const tree = render({ question: { ...question, finalized: true, attemptsUsed: 3, score: 3, resolutionMode: "REVEALED" } });
    expect(textContent(tree)).toContain("3.00 / 6.00 pts");
  });

  it("supports the non-drag Scope selection alternative on classification cards", () => {
    const tree = render({ question: { ...question, stableId: "M1-Q02", type: "DRAG", options: { destinations: ["Scope 1", "Scope 2", "Scope 3"] } } });
    expect(textContent(tree)).toContain("SELECT CARD → SELECT SCOPE");
    expect(descendants(tree).filter((node) => node.props.accessibilityRole === "radio")).toHaveLength(3);
    expect(textContent(tree)).toContain("Submit Answer");
  });

  it("renders a numeric entry that only updates draft state", () => {
    const onSelect = vi.fn(); const onSubmit = vi.fn();
    const tree = render({ question: { ...question, stableId: "M2-Q11", type: "NUM", options: null }, onSelect, onSubmit });
    const input = descendants(tree).find((node) => node.props.accessibilityLabel === "Numeric answer for M2-Q11");
    input?.props.onChangeText("250");
    expect(onSelect).toHaveBeenCalledWith("250");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("exposes multi-select choices as accessible checkboxes", () => {
    const tree = render({ question: { ...question, stableId: "M2-MC", type: "MC", options: ["A", "B"] }, draftAnswer: ["A"] });
    expect(descendants(tree).filter((node) => node.props.accessibilityRole === "checkbox")).toHaveLength(2);
    expect(descendants(tree).find((node) => node.props.accessibilityLabel === "A")?.props.accessibilityState.selected).toBe(true);
  });

  it("reorders the seven-step process draft without submitting and exposes Move controls", () => {
    const onSelect = vi.fn(); const onSubmit = vi.fn();
    const process = ["Emit", "Set Cap", "Allocate / Auction", "MRV", "Trade", "Surrender", "Compliance / Penalty"];
    const tree = render({ question: { ...question, stableId: "M4-Q01", type: "ORDER", options: process, baseScore: 21 }, draftAnswer: process, onSelect, onSubmit });
    descendants(tree).find((node) => node.props.accessibilityLabel === "Move Set Cap up")?.props.onPress();
    expect(onSelect).toHaveBeenCalledWith(["Set Cap", "Emit", "Allocate / Auction", "MRV", "Trade", "Surrender", "Compliance / Penalty"]);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(descendants(tree).find((node) => node.props.accessibilityLabel === "Submit Order for M4-Q01")?.props.disabled).toBe(false);
  });

  it("uses an explicit Submit Trade action and locks the second trade until the first resolves", () => {
    const trade = { seller: "PowerCo", buyer: "SteelCo", quantity: 10000 };
    const tree = render({ question: { ...question, stableId: "M4-Q06", type: "DECISION", options: [{ label: "PowerCo to SteelCo", value: trade }] }, draftAnswer: trade, disabled: true });
    expect(descendants(tree).find((node) => node.props.accessibilityLabel === "Submit Trade for M4-Q06")?.props.disabled).toBe(true);
    expect(textContent(tree)).toContain("Complete the preceding trade first.");
  });

  it("keeps Mission 5 action and quantity changes as drafts until review and explicit Submit Decision", () => {
    const onSelect = vi.fn(); const onReview = vi.fn(); const onSubmit = vi.fn();
    const m5 = { ...question, stableId: "M5-Q03", type: "DECISION", answerMode: "STRATEGY", options: ["Reduce", "Buy", "Sell", "Hold"], baseScore: 20 };
    const draftTree = render({ question: m5, draftAnswer: { action: "Reduce", quantity: "10000" }, onSelect, onReview, onSubmit });
    descendants(draftTree).find((node) => node.props.accessibilityLabel === "Buy")?.props.onPress();
    descendants(draftTree).find((node) => node.props.accessibilityLabel === "Decision quantity")?.props.onChangeText("9000");
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onReview).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(descendants(draftTree).find((node) => node.props.accessibilityLabel === "Submit Decision for M5-Q03")?.props.disabled).toBe(true);
  });

  it("shows only the chosen projected state and enables explicit submission after Review", () => {
    const onReview = vi.fn(); const onSubmit = vi.fn();
    const m5 = { ...question, stableId: "M5-Q03", type: "DECISION", answerMode: "STRATEGY", options: ["Reduce", "Buy", "Sell", "Hold"], baseScore: 20 };
    const tree = render({ question: m5, draftAnswer: { action: "Reduce", quantity: "10000" }, strategyPreview: { finalAllowances: 100000, finalEmissions: 100000, complianceGap: 0, status: "Compliant", projectedCost: 404000 }, onReview, onSubmit });
    descendants(tree).find((node) => node.props.accessibilityLabel === "Review projected state")?.props.onPress();
    expect(onReview).toHaveBeenCalledOnce();
    expect(textContent(tree)).toContain("Projected state");
    expect(textContent(tree)).toContain("Selected strategy: Reduce 10,000");
    expect(textContent(tree)).not.toContain("[object Object]");
    expect(textContent(tree)).not.toMatch(/best|correct strategy/i);
    const submit = descendants(tree).find((node) => node.props.accessibilityLabel === "Submit Decision for M5-Q03");
    expect(submit?.props.disabled).toBe(false);
    submit?.props.onPress();
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("keeps an M6 strategy as an unscored draft until Review and explicit Submit Decision", () => {
    const onSelect = vi.fn(); const onReview = vi.fn(); const onSubmit = vi.fn();
    const m6 = { ...question, stableId: "M6-Q23", type: "DECISION", answerMode: "STRATEGY", options: ["Reduce / Invest", "Buy", "Sell", "Hold"], baseScore: 20 };
    const draft = render({ question: m6, draftAnswer: "Reduce / Invest", onSelect, onReview, onSubmit });
    expect(descendants(draft).find((node) => node.props.accessibilityLabel === "Submit Decision for M6-Q23")?.props.disabled).toBe(true);
    descendants(draft).find((node) => node.props.accessibilityLabel === "Review strategy for M6-Q23")?.props.onPress();
    expect(onReview).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
    const reviewed = render({ question: m6, draftAnswer: "Reduce / Invest", strategyPreview: { selection: "Reduce / Invest" }, onSubmit });
    const submit = descendants(reviewed).find((node) => node.props.accessibilityLabel === "Submit Decision for M6-Q23");
    expect(textContent(reviewed)).toContain("Selected strategy: Reduce / Invest");
    expect(textContent(reviewed)).not.toContain("[object Object]");
    expect(textContent(reviewed)).not.toMatch(/preferred|correct strategy/i);
    expect(submit?.props.disabled).toBe(false);
    submit?.props.onPress();
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("maps the M3 object-valued strategy back to its configured label for selection and Review", () => {
    const onReview = vi.fn(); const createQuestionAttempt = vi.fn();
    const selected = { reduce: 8000, buy: 12000 };
    const m3 = { ...question, stableId: "M3-Q10", type: "DECISION", answerMode: "STRATEGY", options: [
      { label: "Reduce 8,000; Buy 12,000", value: selected },
      { label: "Reduce 0; Buy 20,000", value: { reduce: 0, buy: 20000 } }
    ], baseScore: 10 };
    const tree = render({ question: m3, draftAnswer: selected, strategyPreview: { selection: selected }, onReview, onSubmit: createQuestionAttempt });

    const selectedOption = descendants(tree).find((node) => node.props.accessibilityLabel === "Reduce 8,000; Buy 12,000");
    expect(selectedOption?.props.accessibilityState.selected).toBe(true);
    expect(textContent(selectedOption as unknown as ReactNode)).toContain("Selected: Reduce 8,000; Buy 12,000");
    expect(textContent(tree)).toContain("Selected strategy: Reduce 8,000; Buy 12,000");
    expect(textContent(tree)).not.toContain("[object Object]");

    descendants(tree).find((node) => node.props.accessibilityLabel === "Review strategy for M3-Q10")?.props.onPress();
    expect(onReview).toHaveBeenCalledOnce();
    expect(createQuestionAttempt).not.toHaveBeenCalled();
    descendants(tree).find((node) => node.props.accessibilityLabel === "Submit Decision for M3-Q10")?.props.onPress();
    expect(createQuestionAttempt).toHaveBeenCalledOnce();
  });

  it("invalidates the reviewed strategy when selection changes and renders the newly reviewed label", () => {
    const onSelect = vi.fn(); const onSubmit = vi.fn();
    const first = { reduce: 8000, buy: 12000 };
    const second = { reduce: 0, buy: 20000 };
    const options = [{ label: "Reduce 8,000; Buy 12,000", value: first }, { label: "Reduce 0; Buy 20,000", value: second }];
    const m3 = { ...question, stableId: "M3-Q10", type: "DECISION", answerMode: "STRATEGY", options };
    const oldReview = render({ question: m3, draftAnswer: first, strategyPreview: { selection: first }, onSelect, onSubmit });
    descendants(oldReview).find((node) => node.props.accessibilityLabel === "Reduce 0; Buy 20,000")?.props.onPress();
    expect(onSelect).toHaveBeenCalledWith(second);
    expect(onSubmit).not.toHaveBeenCalled();

    const changedDraft = render({ question: m3, draftAnswer: second, strategyPreview: undefined, onSubmit });
    expect(descendants(changedDraft).find((node) => node.props.accessibilityLabel === "Submit Decision for M3-Q10")?.props.disabled).toBe(true);
    const newReview = render({ question: m3, draftAnswer: second, strategyPreview: { selection: second }, onSubmit });
    expect(textContent(newReview)).toContain("Selected strategy: Reduce 0; Buy 20,000");
    expect(textContent(newReview)).not.toContain("Reduce 8,000; Buy 12,000This review");
  });

  it("renders a structurally restored strategy value and finalized persisted answer by configured label", () => {
    const options = [{ label: "Reduce 8,000; Buy 12,000", value: { reduce: 8000, buy: 12000 } }];
    const restored = JSON.parse('{"buy":12000,"reduce":8000}');
    expect(strategyAnswerLabel(options, restored)).toBe("Reduce 8,000; Buy 12,000");

    const tree = render({ question: { ...question, stableId: "M3-Q10", type: "DECISION", answerMode: "STRATEGY", options, finalized: true, resolutionMode: "STRATEGY", selectedAnswer: restored, score: 10 } });
    expect(textContent(tree)).toContain("Selected strategy: Reduce 8,000; Buy 12,000");
    expect(textContent(tree)).not.toContain("[object Object]");
  });

  it("supports immutable free-text reasoning through explicit submission", () => {
    const onSelect = vi.fn(); const onSubmit = vi.fn();
    const reflection = { ...question, stableId: "M5-Q04", type: "REFLECTION", answerMode: "STRATEGY", options: null, baseScore: 10 };
    const tree = render({ question: reflection, draftAnswer: "MAC is below price.", onSelect, onSubmit });
    descendants(tree).find((node) => node.props.accessibilityLabel === "Reasoning for M5-Q04")?.props.onChangeText("New reasoning");
    expect(onSelect).toHaveBeenCalledWith("New reasoning");
    expect(onSubmit).not.toHaveBeenCalled();
    descendants(tree).find((node) => node.props.accessibilityLabel === "Submit Reasoning for M5-Q04")?.props.onPress();
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("renders finalized rubric reasoning semantically without leaking a raw enum-like value", () => {
    const tree = render({ question: { ...question, stableId: "M5-Q04", type: "REFLECTION", answerMode: "STRATEGY", options: null, baseScore: 10, finalized: true, resolutionMode: "STRATEGY", selectedAnswer: "1", score: 0 } });
    const output = textContent(tree);
    expect(output).toContain("Reasoning evaluated");
    expect(output).toContain("Reasoning submitted");
    expect(output).toContain("0.00 / 10.00 pts");
    expect(output).not.toContain("Selected strategy: 1");
    expect(output).not.toContain("Correct");
    expect(output).not.toContain("[object Object]");
  });
});
