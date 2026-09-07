import { describe, expect, it } from "vitest";
import { bigintToSafeNumber, scoreAdjustmentStreamResponse } from "./teacher-response";

describe("Teacher response BigInt serialization", () => {
  it("maps Prisma ScoreAdjustmentStream.version bigint to a public JSON number", () => {
    const response = scoreAdjustmentStreamResponse({ id: "stream-1", version: 1n, currentAdjustment: { id: "adjustment-1" } });
    expect(response.version).toBe(1);
    expect(JSON.stringify(response)).toContain('"version":1');
  });

  it("rejects unsafe versions rather than silently losing precision", () => {
    expect(() => bigintToSafeNumber(BigInt(Number.MAX_SAFE_INTEGER) + 1n, "ScoreAdjustmentStream.version")).toThrow(RangeError);
  });
});
