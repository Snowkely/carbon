export type ClassroomUrls = {
  origin: string;
  api: string;
  studentWeb: string;
  install: string;
  connectionDeepLink: string;
};

export function classroomUrls(browserOrigin: string): ClassroomUrls {
  const parsed = new URL(browserOrigin);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('Classroom origin must be an HTTP(S) origin');
  }
  const origin = parsed.origin;
  const api = `${origin}/v1`;
  return {
    origin,
    api,
    studentWeb: `${origin}/student`,
    install: `${origin}/classroom`,
    connectionDeepLink: `carbontrader://connect?api=${encodeURIComponent(api)}`,
  };
}
