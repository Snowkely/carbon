import { describe, expect, it } from "vitest";
import { resolveTeacherApiUrl } from "./public-config";

describe("Teacher Web public configuration", () => {
  it("requires an explicit API URL for production", () => {
    expect(() => resolveTeacherApiUrl(undefined, "production")).toThrow("NEXT_PUBLIC_API_URL");
  });

  it("keeps the local development fallback", () => {
    expect(resolveTeacherApiUrl(undefined, "development")).toBe("http://localhost:3001/v1");
  });

  it("rejects credentials embedded in a public URL", () => {
    expect(() => resolveTeacherApiUrl("https://user:secret@example.com/v1", "production")).toThrow("without credentials");
  });
});
