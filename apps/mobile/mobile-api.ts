export type MobileApiResponseContract = {
  allowEmptyBody?: boolean;
};

type ResponseLike = Pick<Response, "ok" | "status" | "text">;

export class MobileApiError extends Error {
  constructor(message: string, readonly status: number, readonly unauthorizedHandled = false) {
    super(message);
    this.name = "MobileApiError";
  }
}

export class MobileApiProtocolError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "MobileApiProtocolError";
  }
}

export const CLASSROOM_SERVER_NOT_CONFIGURED = "CLASSROOM_SERVER_NOT_CONFIGURED";

export class MobileApiConfigurationError extends Error {
  readonly code = CLASSROOM_SERVER_NOT_CONFIGURED;

  constructor() {
    super("Classroom server not connected. Open Server settings to connect to your classroom.");
    this.name = "MobileApiConfigurationError";
  }
}

function responseErrorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === "object") {
    const body = payload as { message?: unknown; error?: { message?: unknown } };
    if (typeof body.error?.message === "string" && body.error.message.trim()) return body.error.message;
    if (typeof body.message === "string" && body.message.trim()) return body.message;
  }
  return `Request failed (HTTP ${status})`;
}

export async function parseMobileApiResponse(response: ResponseLike, contract: MobileApiResponseContract = {}): Promise<any> {
  const rawBody = await response.text();
  const hasBody = rawBody.trim().length > 0;
  let payload: unknown = null;

  if (hasBody) {
    try {
      payload = JSON.parse(rawBody);
    } catch {
      throw new MobileApiProtocolError(`Invalid JSON response (HTTP ${response.status})`, response.status);
    }
  }

  if (!response.ok) throw new MobileApiError(responseErrorMessage(payload, response.status), response.status);
  if (!hasBody && response.status !== 204 && !contract.allowEmptyBody) {
    throw new MobileApiProtocolError(`Expected JSON response but received an empty body (HTTP ${response.status})`, response.status);
  }
  return payload;
}

export async function mobileApiRequest(
  apiBase: string | null | undefined,
  path: string,
  options: RequestInit & { token?: string; responseContract?: MobileApiResponseContract; onUnauthorized?: () => void } = {}
): Promise<any> {
  if (!apiBase) throw new MobileApiConfigurationError();
  const { token, responseContract, onUnauthorized, headers: suppliedHeaders, ...requestOptions } = options;
  const method = (requestOptions.method ?? "GET").toUpperCase();
  const response = await fetch(`${apiBase}${path}`, {
    ...requestOptions,
    ...(method === "GET" && path.startsWith("/student/") && requestOptions.cache === undefined ? { cache: "no-store" as const } : {}),
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(suppliedHeaders as Record<string, string> | undefined)
    }
  });
  if (response.status === 401 && onUnauthorized) {
    onUnauthorized();
    await response.text();
    throw new MobileApiError("Session expired", 401, true);
  }
  return parseMobileApiResponse(response, responseContract);
}

export function isHandledUnauthorized(error: unknown): boolean {
  return error instanceof MobileApiError && error.status === 401 && error.unauthorizedHandled;
}
