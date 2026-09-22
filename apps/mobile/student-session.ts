import { MobileApiError, mobileApiRequest } from "./mobile-api";

export const STUDENT_ACCESS_TOKEN_KEY = "accessToken";
export const STUDENT_REFRESH_TOKEN_KEY = "refreshToken";

export type StudentTokens = { accessToken: string; refreshToken: string };
export type StudentSessionStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<unknown>;
  removeItem(key: string): Promise<unknown>;
};

export async function readStudentTokens(storage: StudentSessionStorage): Promise<StudentTokens | null> {
  const [accessToken, refreshToken] = await Promise.all([
    storage.getItem(STUDENT_ACCESS_TOKEN_KEY),
    storage.getItem(STUDENT_REFRESH_TOKEN_KEY)
  ]);
  return accessToken?.trim() && refreshToken?.trim() ? { accessToken, refreshToken } : null;
}

export async function persistStudentTokens(storage: StudentSessionStorage, tokens: StudentTokens): Promise<void> {
  await Promise.all([
    storage.setItem(STUDENT_ACCESS_TOKEN_KEY, tokens.accessToken),
    storage.setItem(STUDENT_REFRESH_TOKEN_KEY, tokens.refreshToken)
  ]);
}

export async function clearStudentTokens(storage: StudentSessionStorage): Promise<void> {
  await Promise.all([
    storage.removeItem(STUDENT_ACCESS_TOKEN_KEY),
    storage.removeItem(STUDENT_REFRESH_TOKEN_KEY)
  ]);
}

async function verifyStudent(apiBase: string, accessToken: string): Promise<{ profileRequired: boolean }> {
  const profile = await mobileApiRequest(apiBase, "/student/profile", { token: accessToken });
  return { profileRequired: profile === null };
}

async function refreshStudentTokens(apiBase: string, refreshToken: string): Promise<StudentTokens> {
  const result = await mobileApiRequest(apiBase, "/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refreshToken })
  });
  if (!result || typeof result.accessToken !== "string" || typeof result.refreshToken !== "string") {
    throw new Error("Invalid student refresh response");
  }
  return { accessToken: result.accessToken, refreshToken: result.refreshToken };
}

export async function restoreStudentSession(
  storage: StudentSessionStorage,
  apiBase: string
): Promise<{ tokens: StudentTokens; profileRequired: boolean } | null> {
  const stored = await readStudentTokens(storage);
  if (!stored) {
    await clearStudentTokens(storage);
    return null;
  }
  try {
    return { tokens: stored, ...(await verifyStudent(apiBase, stored.accessToken)) };
  } catch (error) {
    if (!(error instanceof MobileApiError) || error.status !== 401) {
      throw error;
    }
  }

  try {
    const tokens = await refreshStudentTokens(apiBase, stored.refreshToken);
    await persistStudentTokens(storage, tokens);
    return { tokens, ...(await verifyStudent(apiBase, tokens.accessToken)) };
  } catch (error) {
    if (error instanceof MobileApiError && error.status === 401) {
      await clearStudentTokens(storage);
      return null;
    }
    throw error;
  }
}
