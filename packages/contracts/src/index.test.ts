import { describe, expect, it } from "vitest";
import { feedbackSubmissionSchema, reflectionSchema, scoreAdjustmentStreamVersionSchema } from "./index.js";

const validResponses = [
  { questionStableId: "FB-Q01", selectedOption: "Excellent" },
  { questionStableId: "FB-Q02", selectedOption: "Understanding how carbon markets work" },
  { questionStableId: "FB-Q03", selectedOption: "Definitely yes" },
  { questionStableId: "FB-Q04", textResponse: "More discussion time." }
];

describe("Feedback submission contract", () => {
  it("accepts one response for each frozen question", () => expect(feedbackSubmissionSchema.safeParse({ responses: validResponses }).success).toBe(true));
  it("treats FB-Q02 as single-choice and rejects array input", () => expect(feedbackSubmissionSchema.safeParse({ responses: validResponses.map((response) => response.questionStableId === "FB-Q02" ? { questionStableId: "FB-Q02", selectedOption: ["Other"] } : response) }).success).toBe(false));
  it("requires trimmed Other text", () => expect(feedbackSubmissionSchema.safeParse({ responses: validResponses.map((response) => response.questionStableId === "FB-Q02" ? { questionStableId: "FB-Q02", selectedOption: "Other", otherText: "   " } : response) }).success).toBe(false));
  it("does not permit a choice on the open-text question", () => expect(feedbackSubmissionSchema.safeParse({ responses: validResponses.map((response) => response.questionStableId === "FB-Q04" ? { questionStableId: "FB-Q04", selectedOption: "Good" } : response) }).success).toBe(false));
});

describe("Reflection completion contract", () => {
  it("trims and accepts non-empty evidence", () => expect(reflectionSchema.parse({ response: "  boundary ownership  " }).response).toBe("boundary ownership"));
  it("rejects empty or whitespace-only evidence", () => expect(reflectionSchema.safeParse({ response: "   " }).success).toBe(false));
});

describe("Score adjustment stream response contract", () => {
  it("publishes version as a safe non-negative JSON number", () => {
    expect(scoreAdjustmentStreamVersionSchema.parse(1)).toBe(1);
    expect(() => scoreAdjustmentStreamVersionSchema.parse(1n)).toThrow();
    expect(() => scoreAdjustmentStreamVersionSchema.parse(Number.MAX_SAFE_INTEGER + 1)).toThrow();
  });
});
