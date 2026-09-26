export type ClassroomUrls = {
  origin: string;
  teacherWeb: string;
  api: string;
  studentWeb: string;
  install: string;
  connectionDeepLink: string;
};

export function classroomUrls(browserOrigin: string, publicBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? ""): ClassroomUrls {
  const parsed = new URL(browserOrigin);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('Classroom origin must be an HTTP(S) origin');
  }
  const origin = parsed.origin;
  const basePath = publicBasePath.trim();
  if (basePath && (!/^\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/i.test(basePath) || basePath.endsWith("/"))) {
    throw new Error("Classroom public base path must be absolute and must not end with a slash");
  }
  const api = `${origin}${basePath}/v1`;
  return {
    origin,
    teacherWeb: `${origin}${basePath}/`,
    api,
    studentWeb: `${origin}${basePath}/student`,
    install: `${origin}${basePath}/classroom`,
    connectionDeepLink: `carbontrader://connect?api=${encodeURIComponent(api)}`,
  };
}
