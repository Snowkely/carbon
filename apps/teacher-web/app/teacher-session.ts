import { TeacherApiError } from "./teacher-api";
import type { TeacherConsoleView } from "./teacher-account-state";

export const TEACHER_ACCESS_TOKEN_KEY = "teacherAccessToken";
export const TEACHER_REFRESH_TOKEN_KEY = "teacherRefreshToken";
export type TeacherTokens = { accessToken: string; refreshToken: string };

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function readTeacherAccessToken(storage: StorageLike): string | null {
  return storage.getItem(TEACHER_ACCESS_TOKEN_KEY)?.trim() || null;
}

export function readTeacherRefreshToken(storage: StorageLike): string | null {
  return storage.getItem(TEACHER_REFRESH_TOKEN_KEY)?.trim() || null;
}

export function persistTeacherTokens(storage: StorageLike, tokens: TeacherTokens): void {
  storage.setItem(TEACHER_ACCESS_TOKEN_KEY, tokens.accessToken);
  storage.setItem(TEACHER_REFRESH_TOKEN_KEY, tokens.refreshToken);
}

export function clearTeacherAccessToken(storage: StorageLike): void {
  storage.removeItem(TEACHER_ACCESS_TOKEN_KEY);
  storage.removeItem(TEACHER_REFRESH_TOKEN_KEY);
}

export async function restoreTeacherSession(
  storage: StorageLike,
  verify: (token: string) => Promise<unknown>,
  refresh: (refreshToken: string) => Promise<TeacherTokens>
): Promise<TeacherTokens | null> {
  const accessToken = readTeacherAccessToken(storage);
  const refreshToken = readTeacherRefreshToken(storage);
  if (!accessToken || !refreshToken) { clearTeacherAccessToken(storage); return null; }
  try {
    await verify(accessToken);
    return { accessToken, refreshToken };
  } catch (error) {
    if (!(error instanceof TeacherApiError) || error.status !== 401) {
      if (error instanceof TeacherApiError && error.status === 403) {
        clearTeacherAccessToken(storage);
        return null;
      }
      throw error;
    }
    try {
      const tokens = await refresh(refreshToken);
      persistTeacherTokens(storage, tokens);
      await verify(tokens.accessToken);
      return tokens;
    } catch (refreshError) {
      if (refreshError instanceof TeacherApiError && (refreshError.status === 401 || refreshError.status === 403)) {
        clearTeacherAccessToken(storage);
        return null;
      }
      if (refreshError instanceof TeacherApiError) throw refreshError;
      throw refreshError;
    }
  }
}

export type TeacherRoute = { view: TeacherConsoleView; workshopId: string | null; sessionId: string | null };

export function parseTeacherRoute(pathname: string): TeacherRoute {
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "workshops" && parts[1]) {
    const view = parts[2] === "students" ? "Students" : parts[2] === "gradebook" ? "Gradebook" : parts[2] === "session" ? "Session Control" : "Workshops";
    return { view, workshopId: parts[1], sessionId: null };
  }
  if (parts[0] === "sessions" && parts[1]) {
    const view = parts[2] === "monitor" ? "Live Monitor" : parts[2] === "missions" ? "Mission Control" : parts[2] === "feedback" ? "Feedback" : "Session Control";
    return { view, workshopId: null, sessionId: parts[1] };
  }
  return { view: "Dashboard", workshopId: null, sessionId: null };
}

export function teacherRoutePath(view: TeacherConsoleView, workshopId?: string | null, sessionId?: string | null): string {
  const workshop = workshopId ? encodeURIComponent(workshopId) : null;
  const session = sessionId ? encodeURIComponent(sessionId) : null;
  if (view === "Workshops" && workshop) return `/workshops/${workshop}`;
  if (view === "Students" && workshop) return `/workshops/${workshop}/students`;
  if (view === "Gradebook" && workshop) return `/workshops/${workshop}/gradebook`;
  if (view === "Session Control" && workshop) return `/workshops/${workshop}/session`;
  if (view === "Live Monitor" && session) return `/sessions/${session}/monitor`;
  if (view === "Mission Control" && session) return `/sessions/${session}/missions`;
  if (view === "Feedback" && session) return `/sessions/${session}/feedback`;
  return "/";
}
