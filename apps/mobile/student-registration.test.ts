import { describe, expect, it, vi } from "vitest";
import { createRegistrationSubmissionGate, registerStudentAccount, registrationErrorMessage, validateStudentRegistration } from "./student-registration";

describe("student registration behavior", () => {
  it("validates confirmation and the shared password requirement before a request", () => {
    expect(validateStudentRegistration({ username: "alex", password: "Carbon123!", confirmPassword: "different" })).toBe("Passwords do not match.");
    expect(validateStudentRegistration({ username: "alex", password: "short", confirmPassword: "short" })).toBe("Password must be at least 8 characters.");
  });

  it("posts only username and password to the dedicated public endpoint", async () => {
    const request = vi.fn().mockResolvedValue({ accessToken: "access", profileRequired: true });
    await expect(registerStudentAccount({ username: " Alex ", password: "Carbon123!", confirmPassword: "Carbon123!" }, request)).resolves.toMatchObject({ profileRequired: true });
    expect(request).toHaveBeenCalledWith("/auth/student/register", { method: "POST", body: JSON.stringify({ username: "Alex", password: "Carbon123!" }) });
    expect(request.mock.calls[0]![1].body).not.toContain("confirmPassword");
  });

  it("prevents a second submission while the first is pending", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const task = vi.fn(() => pending);
    const gate = createRegistrationSubmissionGate();
    const first = gate.run(task);
    await expect(gate.run(task)).resolves.toBe(false);
    expect(task).toHaveBeenCalledOnce();
    release();
    await expect(first).resolves.toBe(true);
    await expect(gate.run(async () => undefined)).resolves.toBe(true);
  });

  it("shows a readable username conflict and hides generic server failures", () => {
    expect(registrationErrorMessage(new Error("This username is already in use."))).toBe("This username is already in use.");
    expect(registrationErrorMessage(new Error("Request failed (HTTP 500)"))).toBe("We could not create your account. Please try again.");
  });
});
