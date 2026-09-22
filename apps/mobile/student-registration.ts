import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, PASSWORD_REQUIREMENT } from "@carbon/contracts";

export type StudentRegistrationDraft = { username: string; password: string; confirmPassword: string };
export type RegistrationRequest = (path: string, options: RequestInit) => Promise<any>;

export function validateStudentRegistration(draft: StudentRegistrationDraft): string | null {
  const usernameLength = draft.username.trim().length;
  if (usernameLength < 3 || usernameLength > 80) return "Username must be between 3 and 80 characters.";
  if (draft.password.length < PASSWORD_MIN_LENGTH) return PASSWORD_REQUIREMENT;
  if (draft.password.length > PASSWORD_MAX_LENGTH) return `Password must be no more than ${PASSWORD_MAX_LENGTH} characters.`;
  if (draft.confirmPassword !== draft.password) return "Passwords do not match.";
  return null;
}

export function registrationErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : "";
  if (message === "This username is already in use.") return message;
  if (message && !/^Request failed \(HTTP 5\d\d\)$/.test(message)) return message;
  return "We could not create your account. Please try again.";
}

export async function registerStudentAccount(draft: StudentRegistrationDraft, request: RegistrationRequest): Promise<any> {
  const validationError = validateStudentRegistration(draft);
  if (validationError) throw new Error(validationError);
  return request("/auth/student/register", { method: "POST", body: JSON.stringify({ username: draft.username.trim(), password: draft.password }) });
}

export function createRegistrationSubmissionGate() {
  let active = false;
  return {
    async run(task: () => Promise<void>): Promise<boolean> {
      if (active) return false;
      active = true;
      try { await task(); return true; }
      finally { active = false; }
    }
  };
}
