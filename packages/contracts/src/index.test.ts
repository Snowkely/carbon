import { describe, expect, it, vi } from "vitest";
import { changeOwnPasswordSchema, changeTeacherRoleSchema, createTeacherAccountSchema, createUnauthorizedCoordinator, loginSchema, missionScoreComponentLabel, PASSWORD_REQUIREMENT, studentRegistrationSchema } from "./index.js";

describe("unauthorized confirmation coordination", () => {
  it("waits for confirmation and coalesces parallel 401 responses", () => {
    const coordinator = createUnauthorizedCoordinator(); const show = vi.fn(); const clear = vi.fn();
    expect(coordinator.notify(show, clear)).toBe(true);
    expect(coordinator.notify(show, clear)).toBe(false);
    expect(show).toHaveBeenCalledOnce(); expect(clear).not.toHaveBeenCalled();
    const confirm = show.mock.calls[0]![0] as () => void;
    confirm(); confirm();
    expect(clear).toHaveBeenCalledOnce();
    expect(coordinator.notify(show, clear)).toBe(false);
  });

  it("can be reset only for a newly authenticated session", () => {
    const coordinator = createUnauthorizedCoordinator(); const show = vi.fn((confirm: () => void) => confirm()); const clear = vi.fn();
    coordinator.notify(show, clear); coordinator.reset(); coordinator.notify(show, clear);
    expect(show).toHaveBeenCalledTimes(2); expect(clear).toHaveBeenCalledTimes(2);
  });
});

it("provides the shared M1-M6 component labels", () => {
  expect(["SCAN", "UNIT_MATCHING", "BONUS", "PROCESS", "COST_LOGIC", "ROUND_3_INTEGRATED"].map(missionScoreComponentLabel)).toEqual(["Scan", "Unit", "Bonus", "Process", "Cost Logic", "Round 3 Integrated"]);
});

describe("shared authentication validation", () => {
  it("uses the same password policy for login and student registration", () => {
    expect(loginSchema.safeParse({ username: "student", password: "short" }).success).toBe(false);
    const result = studentRegistrationSchema.safeParse({ username: "student", password: "short" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((issue) => issue.message)).toContain(PASSWORD_REQUIREMENT);
  });

  it.each(["accountType", "role", "schoolId", "classId"])("rejects unexpected registration field %s", (field) => {
    expect(studentRegistrationSchema.safeParse({ username: "student", password: "Carbon123!", [field]: "OWNER" }).success).toBe(false);
  });

  it("restricts managed Teacher roles and shares the password policy", () => {
    expect(createTeacherAccountSchema.safeParse({ username: "teacher", displayName: "Teacher", role: "INSTRUCTOR", password: "Carbon123!" }).success).toBe(true);
    expect(createTeacherAccountSchema.safeParse({ username: "teacher", displayName: "Teacher", role: "OWNER", password: "Carbon123!" }).success).toBe(false);
    expect(changeTeacherRoleSchema.safeParse({ role: "STUDENT" }).success).toBe(false);
    expect(changeOwnPasswordSchema.safeParse({ currentPassword: "short", newPassword: "Carbon123!" }).success).toBe(false);
  });
});
