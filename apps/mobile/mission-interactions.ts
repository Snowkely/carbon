import { formatScore } from "@carbon/ui-tokens";

export type QuestionSubmissionResult = {
  attemptNumber: number;
  correct: boolean;
  score: number;
  feedback?: string;
  explanation?: string;
  revealAvailable?: boolean;
};

export type QuestionRevealResult = {
  score: number;
  revealedAnswer: unknown;
  feedback?: string;
};

function answersEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function toggleDraftAnswer(current: unknown | undefined, next: unknown): unknown | undefined {
  return current !== undefined && answersEqual(current, next) ? undefined : next;
}

export function setQuestionDraft(
  drafts: Record<string, unknown>,
  questionId: string,
  answer: unknown | undefined
): Record<string, unknown> {
  if (answer === undefined) {
    const { [questionId]: _removed, ...remaining } = drafts;
    return remaining;
  }
  return { ...drafts, [questionId]: answer };
}

export function toggleValueChainNode(selectedNodes: string[], nodeId: string): string[] {
  return selectedNodes.includes(nodeId)
    ? selectedNodes.filter((selected) => selected !== nodeId)
    : [...selectedNodes, nodeId];
}

export function valueChainCanContinue(selectedNodes: string[], required = 4): boolean {
  return new Set(selectedNodes).size >= required;
}

export async function commitValueChainDraft(
  selectedNodes: string[],
  persistedNodes: string[],
  persistNode: (nodeId: string) => Promise<unknown>
): Promise<void> {
  const persisted = new Set(persistedNodes);
  for (const nodeId of new Set(selectedNodes)) {
    if (!persisted.has(nodeId)) await persistNode(nodeId);
  }
}

export function formatQuestionSubmissionResult(result: QuestionSubmissionResult, baseScore: number): string {
  if (result.correct) {
    return `Correct\n${formatScore(result.score)} / ${formatScore(baseScore)} pts\nAttempt ${result.attemptNumber} submitted`;
  }
  return `Incorrect\nAttempt ${result.attemptNumber} submitted${result.feedback ? `\n${result.feedback}` : ""}${result.revealAvailable ? "\nReveal is now available." : ""}`;
}

export function formatQuestionRevealResult(result: QuestionRevealResult, baseScore: number): string {
  const answer = typeof result.revealedAnswer === "string" ? result.revealedAnswer : JSON.stringify(result.revealedAnswer);
  return `Revealed\n${formatScore(result.score)} / ${formatScore(baseScore)} pts\nAnswer: ${answer}${result.feedback ? `\n${result.feedback}` : ""}`;
}

export function allQuestionsResolved(questions: Array<{ finalized: boolean }>): boolean {
  return questions.every((question) => question.finalized);
}
