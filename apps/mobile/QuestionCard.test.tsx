import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Pressable: "Pressable",
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: "Text",
  View: "View"
}));

import { QuestionCard, type MobileQuestion } from "./QuestionCard";

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
});
