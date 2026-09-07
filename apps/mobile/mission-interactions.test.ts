import { describe, expect, it, vi } from "vitest";
import { allQuestionsResolved, commitValueChainDraft, formatQuestionRevealResult, formatQuestionSubmissionResult, setQuestionDraft, toggleDraftAnswer, toggleValueChainNode, valueChainCanContinue } from "./mission-interactions";

describe("Value Chain draft selection", () => {
  it("toggles a hotspot locally and allows it to be deselected before confirmation", () => {
    const selected = toggleValueChainNode([], "Dyeing");
    expect(selected).toEqual(["Dyeing"]);
    expect(toggleValueChainNode(selected, "Dyeing")).toEqual([]);
  });

  it("requires four draft selections before Continue", () => {
    expect(valueChainCanContinue(["Raw materials", "Dyeing", "Assembly"])).toBe(false);
    expect(valueChainCanContinue(["Raw materials", "Dyeing", "Assembly", "Logistics"])).toBe(true);
  });

  it("does not persist selection until the confirmation helper is called", async () => {
    const persistNode = vi.fn().mockResolvedValue(undefined);
    const selected = toggleValueChainNode([], "Dyeing");
    expect(persistNode).not.toHaveBeenCalled();
    await commitValueChainDraft(selected, [], persistNode);
    expect(persistNode).toHaveBeenCalledOnce();
    expect(persistNode).toHaveBeenCalledWith("Dyeing");
  });

  it("commits only new nodes and preserves server-persisted exploration", async () => {
    const persistNode = vi.fn().mockResolvedValue(undefined);
    await commitValueChainDraft(["Dyeing", "Assembly", "Retail", "Logistics"], ["Dyeing", "Assembly"], persistNode);
    expect(persistNode.mock.calls).toEqual([["Retail"], ["Logistics"]]);
  });
});

describe("Question draft state", () => {
  it("selects, replaces and clears a draft without submitting anything", () => {
    const submit = vi.fn();
    expect(toggleDraftAnswer(undefined, "Scope 1")).toBe("Scope 1");
    expect(toggleDraftAnswer("Scope 1", "Scope 2")).toBe("Scope 2");
    expect(toggleDraftAnswer("Scope 2", "Scope 2")).toBeUndefined();
    expect(submit).not.toHaveBeenCalled();
  });

  it("keeps independent drafts for every Round A/B question", () => {
    const first = setQuestionDraft({}, "q1", "Scope 1");
    const second = setQuestionDraft(first, "q2", "Scope 3");
    expect(second).toEqual({ q1: "Scope 1", q2: "Scope 3" });
    expect(setQuestionDraft(second, "q1", undefined)).toEqual({ q2: "Scope 3" });
  });

  it("enables page progression only when all questions are server-resolved", () => {
    expect(allQuestionsResolved([{ finalized: true }, { finalized: false }])).toBe(false);
    expect(allQuestionsResolved([{ finalized: true }, { finalized: true }])).toBe(true);
  });

  it("formats server-authoritative retry and Reveal results without client score calculation", () => {
    expect(formatQuestionSubmissionResult({ attemptNumber: 2, correct: true, score: 5.399999999999999 }, 6)).toContain("5.40 / 6.00 pts");
    expect(formatQuestionSubmissionResult({ attemptNumber: 3, correct: false, score: 0, feedback: "Try again", revealAvailable: true }, 6)).toContain("Reveal is now available.");
    expect(formatQuestionRevealResult({ score: 3, revealedAnswer: "Scope 3" }, 6)).toContain("3.00 / 6.00 pts");
  });

  it("hides third-attempt floating-point noise without changing the server score", () => {
    const result = { attemptNumber: 3, correct: true, score: 4.800000000000001 };
    const message = formatQuestionSubmissionResult(result, 6);
    expect(message).toContain("4.80 / 6.00 pts");
    expect(message).not.toContain("4.800000000000001");
    expect(result.score).toBe(4.800000000000001);
  });
});
