import { describe, expect, it } from "vitest";
import { resolveTeacherApiUrl, resolveTeacherBasePath } from "./public-config";

describe("Teacher Web public configuration", () => {
  it("requires an explicit API URL for production", () => {
    expect(() => resolveTeacherApiUrl(undefined, "production")).toThrow("NEXT_PUBLIC_API_URL");
  });

  it("keeps the local development fallback", () => {
    expect(resolveTeacherApiUrl(undefined, "development")).toBe("http://localhost:3001/v1");
  });

  it("supports the classroom same-origin API without weakening arbitrary relative URLs", () => {
    expect(resolveTeacherApiUrl("/v1", "production")).toBe("/v1");
    expect(() => resolveTeacherApiUrl("/other", "production")).toThrow("exactly /v1");
  });

  it("allows only the configured production base path for relative API calls", () => {
    expect(resolveTeacherBasePath("/carbon-trader")).toBe("/carbon-trader");
    expect(resolveTeacherApiUrl("/carbon-trader/v1", "production", "/carbon-trader")).toBe("/carbon-trader/v1");
    expect(() => resolveTeacherApiUrl("/v1", "production", "/carbon-trader")).toThrow("/carbon-trader/v1");
    expect(() => resolveTeacherBasePath("/carbon-trader/")).toThrow();
  });

  it("rejects credentials embedded in a public URL", () => {
    expect(() => resolveTeacherApiUrl("https://user:secret@example.com/v1", "production")).toThrow("without credentials");
  });
});
