const DEVELOPMENT_API_URL = "http://localhost:3001/v1";

export function resolveTeacherBasePath(value: string | undefined = process.env.NEXT_PUBLIC_BASE_PATH): string {
  const configured = value?.trim() ?? "";
  if (!configured) return "";
  if (!/^\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/i.test(configured) || configured.endsWith("/")) {
    throw new Error("NEXT_PUBLIC_BASE_PATH must be an absolute path without a trailing slash");
  }
  return configured;
}

export function resolveTeacherApiUrl(
  value: string | undefined,
  environment = process.env.NODE_ENV,
  publicBasePath = resolveTeacherBasePath()
): string {
  const configured = value?.trim();
  if (!configured && environment === "production") throw new Error("NEXT_PUBLIC_API_URL must be configured for a production Teacher Web build");
  const candidate = configured || DEVELOPMENT_API_URL;
  const expectedRelativeApi = `${resolveTeacherBasePath(publicBasePath)}/v1`;
  if (candidate === expectedRelativeApi) return candidate;
  if (candidate.startsWith("/")) throw new Error(`NEXT_PUBLIC_API_URL relative configuration must be exactly ${expectedRelativeApi}`);
  let url: URL;
  try { url = new URL(candidate); } catch { throw new Error("NEXT_PUBLIC_API_URL must be a valid HTTP(S) URL"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("NEXT_PUBLIC_API_URL must be a public HTTP(S) URL without credentials");
  return candidate.replace(/\/$/, "");
}
