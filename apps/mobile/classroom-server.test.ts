import { beforeEach, describe, expect, it, vi } from "vitest";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { classroomHealthUrl, loadSavedClassroomApi, parseClassroomDeepLink, resetClassroomApi, saveClassroomApi, validateClassroomApiBase } from "./classroom-server";

vi.mock("@react-native-async-storage/async-storage", () => {
  const values = new Map<string, string>();
  return { default: {
    getItem: vi.fn(async (key: string) => values.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { values.delete(key); }),
    clear: vi.fn(async () => { values.clear(); })
  } };
});

describe("classroom server selection", () => {
  beforeEach(async () => { await AsyncStorage.clear(); });

  it("accepts RFC1918 HTTP deep links and rejects dangerous/public HTTP schemes", () => {
    expect(parseClassroomDeepLink("carbontrader://connect?api=http%3A%2F%2F192.168.1.25%3A8088%2Fv1")).toBe("http://192.168.1.25:8088/v1");
    expect(validateClassroomApiBase("http://10.2.3.4:8088/v1/")).toBe("http://10.2.3.4:8088/v1");
    expect(validateClassroomApiBase("http://172.31.1.4:8088/v1")).toContain("172.31.1.4");
    for (const value of ["file:///tmp/v1", "javascript:alert(1)", "data:text/plain,x", "http://8.8.8.8/v1"]) expect(() => validateClassroomApiBase(value)).toThrow();
  });

  it("allows credential-free HTTPS for future production configuration", () => {
    expect(validateClassroomApiBase("https://class.example.test/v1")).toBe("https://class.example.test/v1");
    expect(() => validateClassroomApiBase("https://user:secret@class.example.test/v1")).toThrow();
  });

  it("persists a selection, derives health, and resets to default", async () => {
    const selected = "http://192.168.1.25:8088/v1";
    await saveClassroomApi(selected);
    expect(await loadSavedClassroomApi("https://default.example/v1")).toBe(selected);
    expect(classroomHealthUrl(selected)).toBe("http://192.168.1.25:8088/health");
    expect(await resetClassroomApi("https://default.example/v1")).toBe("https://default.example/v1");
    expect(await loadSavedClassroomApi("https://default.example/v1")).toBe("https://default.example/v1");
  });

  it("allows a portable classroom build to start without a server or fallback", async () => {
    await expect(loadSavedClassroomApi(null, true)).resolves.toBeNull();
    await expect(resetClassroomApi(undefined, true)).resolves.toBeNull();
  });

  it("prefers the persisted classroom server over the optional environment fallback", async () => {
    await saveClassroomApi("http://10.20.30.40:8088/v1");
    await expect(loadSavedClassroomApi("https://fallback.example/v1", true)).resolves.toBe("http://10.20.30.40:8088/v1");
  });

  it("uses an optional fallback when no classroom server has been persisted", async () => {
    await expect(loadSavedClassroomApi("https://fallback.example/v1", true)).resolves.toBe("https://fallback.example/v1");
  });

  it("keeps a missing production API configuration invalid", async () => {
    await expect(loadSavedClassroomApi(null, false)).rejects.toThrow("EXPO_PUBLIC_API_URL must be configured");
  });
});
