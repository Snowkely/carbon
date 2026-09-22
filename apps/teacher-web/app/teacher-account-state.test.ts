import { describe, expect, it } from "vitest";
import { teacherAccountError, teacherNavigation, validatePasswordConfirmation } from "./teacher-account-state";

describe("Teacher account management presentation", () => {
  it("shows Teacher Management only to OWNER", () => {
    expect(teacherNavigation("OWNER")).toContain("Teacher Management");
    expect(teacherNavigation("INSTRUCTOR")).not.toContain("Teacher Management");
    expect(teacherNavigation("VIEWER")).not.toContain("Teacher Management");
    expect(teacherNavigation(null)).not.toContain("Teacher Management");
    expect(teacherNavigation("OWNER")).toContain("Account");
  });
  it("uses the central password bounds and blocks confirmation mismatch", () => {
    expect(validatePasswordConfirmation("short", "short")).toBe("Password must be between 8 and 128 characters.");
    expect(validatePasswordConfirmation("Carbon123!", "Different123!")).toBe("Passwords do not match.");
    expect(validatePasswordConfirmation("Carbon123!", "Carbon123!")).toBeNull();
  });
  it("keeps readable API error codes without raw Error prefixes", () => {
    expect(teacherAccountError(new Error("USERNAME_ALREADY_EXISTS: This username is already in use."))).toBe("USERNAME_ALREADY_EXISTS: This username is already in use.");
  });
});
