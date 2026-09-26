export function normalizeStudentPublicBasePath(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") throw new Error("Student Web public base path must be a string");
  const path = value.trim();
  if (!/^\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/i.test(path) || path.endsWith("/")) {
    throw new Error("Student Web public base path must be absolute and must not end with a slash");
  }
  return path;
}

export function studentWebApiBase(browserOrigin: string, publicBasePath: unknown = ""): string {
  const parsed = new URL(browserOrigin);
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.origin === "null") {
    throw new Error("Student Web requires an HTTP(S) classroom origin");
  }
  return `${parsed.origin}${normalizeStudentPublicBasePath(publicBasePath)}/v1`;
}

export function isClassroomStudentWeb(platform: string, configured: unknown): boolean {
  return platform === "web" && configured === true;
}
