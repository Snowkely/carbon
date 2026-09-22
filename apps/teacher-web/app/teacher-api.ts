type ResponseLike = Pick<Response, "ok" | "status" | "text">;

export class TeacherApiError extends Error {
  constructor(message: string, readonly status: number, readonly unauthorizedHandled = false) {
    super(message); this.name = "TeacherApiError";
  }
}

function errorMessage(payload: unknown, status: number) {
  const body = payload && typeof payload === "object" ? payload as { error?: { code?: string; message?: string } } : null;
  return `${body?.error?.code ?? "REQUEST_FAILED"}: ${body?.error?.message ?? `Request failed (HTTP ${status})`}`;
}

export async function parseTeacherApiResponse(response: ResponseLike): Promise<any> {
  const raw = await response.text(); let payload: unknown = null;
  if (raw.trim()) { try { payload = JSON.parse(raw); } catch { throw new TeacherApiError(`Invalid JSON response (HTTP ${response.status})`, response.status); } }
  if (!response.ok) throw new TeacherApiError(errorMessage(payload, response.status), response.status);
  return payload;
}

function isDynamicTeacherGet(path: string): boolean {
  return path === "/teacher/dashboard"
    || path === "/teacher/account"
    || path.startsWith("/teacher/workshops")
    || path.startsWith("/teacher/sessions")
    || path.startsWith("/teacher/accounts");
}

export async function teacherApiRequest(apiBase: string, token: string, path: string, options: RequestInit, onUnauthorized: () => void) {
  const method = (options.method ?? "GET").toUpperCase();
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    ...(method === "GET" && isDynamicTeacherGet(path) && options.cache === undefined ? { cache: "no-store" as const } : {}),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...options.headers }
  });
  if (response.status === 401) { onUnauthorized(); await response.text(); throw new TeacherApiError("Session expired", 401, true); }
  return parseTeacherApiResponse(response);
}

export async function refreshTeacherTokens(apiBase: string, refreshToken: string): Promise<{accessToken:string;refreshToken:string}> {
  const response = await fetch(`${apiBase}/auth/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken }) });
  const payload = await parseTeacherApiResponse(response);
  if (!payload || typeof payload.accessToken !== "string" || typeof payload.refreshToken !== "string") throw new TeacherApiError("Invalid refresh response", response.status);
  return { accessToken: payload.accessToken, refreshToken: payload.refreshToken };
}

export function isHandledTeacherUnauthorized(error: unknown) { return error instanceof TeacherApiError && error.status === 401 && error.unauthorizedHandled; }
