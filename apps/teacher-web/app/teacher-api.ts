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

export async function teacherApiRequest(apiBase: string, token: string, path: string, options: RequestInit, onUnauthorized: () => void) {
  const response = await fetch(`${apiBase}${path}`, { ...options, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...options.headers } });
  if (response.status === 401) { onUnauthorized(); await response.text(); throw new TeacherApiError("Session expired", 401, true); }
  return parseTeacherApiResponse(response);
}

export function isHandledTeacherUnauthorized(error: unknown) { return error instanceof TeacherApiError && error.status === 401 && error.unauthorizedHandled; }
