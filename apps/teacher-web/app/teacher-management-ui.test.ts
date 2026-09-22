import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(__dirname, "teacher-management.tsx"), "utf8");
const loginSource = readFileSync(resolve(__dirname, "page.tsx"), "utf8");

describe("Teacher Management UI contract", () => {
  it("renders the required safe account columns and actions", () => {
    for (const label of ["Username", "Display Name", "Role", "Status", "Created", "Last login", "Reset Password", "Disable", "Enable"]) expect(source).toContain(label);
    expect(source).not.toContain("passwordHash"); expect(source).not.toContain("refreshToken");
  });
  it("offers only INSTRUCTOR and VIEWER in normal role controls", () => {
    expect(source).toContain('<option value="INSTRUCTOR">INSTRUCTOR</option>');
    expect(source).toContain('<option value="VIEWER">VIEWER</option>');
    expect(source).not.toContain('<option value="OWNER">'); expect(source).not.toContain('<option value="STUDENT">');
  });
  it("masks password fields, confirms sensitive actions, and guards duplicate submission", () => {
    expect(source.match(/type="password"/g)).toHaveLength(7);
    expect(source).toContain("window.confirm(`Disable"); expect(source).toContain("window.confirm(`Reset"); expect(source).toContain("submission.current");
  });
  it("does not add public Teacher registration to Login", () => {
    expect(loginSource).not.toContain("Create teacher account"); expect(loginSource).not.toContain("auth/teacher/register");
  });
});
