export type TeacherPlatformRole = "OWNER" | "INSTRUCTOR" | "VIEWER";
export type TeacherConsoleView = "Dashboard" | "Workshops" | "Session Control" | "Mission Control" | "Live Monitor" | "Students" | "Gradebook" | "Feedback" | "Question Bank" | "Account" | "Teacher Management";

const standardNavigation: TeacherConsoleView[] = ["Dashboard", "Workshops", "Session Control", "Mission Control", "Live Monitor", "Students", "Gradebook", "Feedback", "Question Bank", "Account"];
export function teacherNavigation(role: TeacherPlatformRole | null): TeacherConsoleView[] { return role === "OWNER" ? [...standardNavigation, "Teacher Management"] : standardNavigation; }
export function validatePasswordConfirmation(password: string, confirmation: string): string | null { if (password.length < 8 || password.length > 128) return "Password must be between 8 and 128 characters."; return password === confirmation ? null : "Passwords do not match."; }
export function teacherAccountError(error: unknown): string { const message = error instanceof Error ? error.message : String(error); return message.replace(/^Error:\s*/, "") || "The request could not be completed."; }
