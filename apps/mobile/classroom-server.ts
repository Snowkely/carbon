import AsyncStorage from "@react-native-async-storage/async-storage";

export const CLASSROOM_SERVER_STORAGE_KEY = "classroomApiBase";

const normalized = (value: string) => value.trim().replace(/\/+$/, "");

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10 || (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31) || (parts[0] === 192 && parts[1] === 168);
}

export function validateClassroomApiBase(value: string): string {
  const candidate = normalized(value);
  let url: URL;
  try { url = new URL(candidate); } catch { throw new Error("Enter a valid classroom server URL"); }
  if (url.username || url.password || url.search || url.hash || url.pathname.replace(/\/$/, "") !== "/v1") throw new Error("Classroom server URL must end in /v1 and must not contain credentials, query, or fragment");
  if (url.protocol === "http:" && !isPrivateIpv4(url.hostname) && url.hostname !== "127.0.0.1") throw new Error("HTTP classroom servers must use a private LAN IPv4 address");
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only HTTP private-LAN or HTTPS classroom servers are allowed");
  return candidate;
}

export function parseClassroomDeepLink(value: string): string {
  let link: URL;
  try { link = new URL(value); } catch { throw new Error("Invalid Carbon Trader connection link"); }
  if (link.protocol !== "carbontrader:" || link.hostname !== "connect") throw new Error("Invalid Carbon Trader connection link");
  const api = link.searchParams.get("api");
  if (!api) throw new Error("Connection link does not contain a classroom server");
  return validateClassroomApiBase(api);
}

export function classroomHealthUrl(apiBase: string): string {
  const url = new URL(validateClassroomApiBase(apiBase));
  url.pathname = "/health"; url.search = ""; url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function fallbackClassroomApi(defaultApi: string | null | undefined, allowUnconfigured: boolean): string | null {
  if (defaultApi?.trim()) return validateClassroomApiBase(defaultApi);
  if (allowUnconfigured) return null;
  throw new Error("EXPO_PUBLIC_API_URL must be configured");
}

export async function loadSavedClassroomApi(defaultApi: string | null | undefined, allowUnconfigured = false): Promise<string | null> {
  const saved = await AsyncStorage.getItem(CLASSROOM_SERVER_STORAGE_KEY);
  if (!saved) return fallbackClassroomApi(defaultApi, allowUnconfigured);
  try { return validateClassroomApiBase(saved); } catch { await AsyncStorage.removeItem(CLASSROOM_SERVER_STORAGE_KEY); return fallbackClassroomApi(defaultApi, allowUnconfigured); }
}

export async function saveClassroomApi(apiBase: string): Promise<string> {
  const value = validateClassroomApiBase(apiBase);
  await AsyncStorage.setItem(CLASSROOM_SERVER_STORAGE_KEY, value);
  return value;
}

export async function resetClassroomApi(defaultApi: string | null | undefined, allowUnconfigured = false): Promise<string | null> {
  await AsyncStorage.removeItem(CLASSROOM_SERVER_STORAGE_KEY);
  return fallbackClassroomApi(defaultApi, allowUnconfigured);
}
