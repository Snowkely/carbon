import { describe, expect, it } from "vitest";
import { formatScore } from "./index.js";

describe("formatScore", () => {
  it.each([
    [4.800000000000001, "4.80"],
    [5.399999999999999, "5.40"],
    [6, "6.00"],
    [3, "3.00"],
    [84.16, "84.16"]
  ])("formats %s as %s", (value, expected) => {
    expect(formatScore(value)).toBe(expected);
  });

  it("formats without modifying the authoritative numeric value", () => {
    const authoritativeScore = 4.800000000000001;
    expect(formatScore(authoritativeScore)).toBe("4.80");
    expect(authoritativeScore).toBe(4.800000000000001);
  });
});
