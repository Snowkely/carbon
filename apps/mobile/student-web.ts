export function studentWebApiBase(browserOrigin: string): string {
  const parsed = new URL(browserOrigin);
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.origin === "null") {
    throw new Error("Student Web requires an HTTP(S) classroom origin");
  }
  return `${parsed.origin}/v1`;
}

export function isClassroomStudentWeb(platform: string, configured: unknown): boolean {
  return platform === "web" && configured === true;
}
