const DEVELOPMENT_API_URL = "http://localhost:3001/v1";

export function resolveTeacherApiUrl(value: string | undefined, environment = process.env.NODE_ENV): string {
  const configured = value?.trim();
  if (!configured && environment === "production") throw new Error("NEXT_PUBLIC_API_URL must be configured for a production Teacher Web build");
  const candidate = configured || DEVELOPMENT_API_URL;
  let url: URL;
  try { url = new URL(candidate); } catch { throw new Error("NEXT_PUBLIC_API_URL must be a valid HTTP(S) URL"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("NEXT_PUBLIC_API_URL must be a public HTTP(S) URL without credentials");
  return candidate.replace(/\/$/, "");
}
