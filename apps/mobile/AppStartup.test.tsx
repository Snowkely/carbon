import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-constants", () => ({ default: { expoConfig: { extra: { classroomBuild: true, classroomWeb: false } } } }));
vi.mock("expo-status-bar", () => ({ StatusBar: "StatusBar" }));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: {
  getItem: vi.fn(async () => null),
  setItem: vi.fn(async () => undefined),
  removeItem: vi.fn(async () => undefined)
} }));
vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  Alert: { alert: vi.fn() },
  Linking: { addEventListener: vi.fn(() => ({ remove: vi.fn() })), getInitialURL: vi.fn(async () => null) },
  Platform: { OS: "android" },
  Pressable: "Pressable",
  SafeAreaView: "SafeAreaView",
  ScrollView: "ScrollView",
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: "Text",
  TextInput: "TextInput",
  View: "View"
}));

afterEach(() => vi.unstubAllEnvs());

describe("portable classroom startup", () => {
  it("imports the application without EXPO_PUBLIC_API_URL", async () => {
    vi.stubEnv("EXPO_PUBLIC_API_URL", "");
    await expect(import("./App")).resolves.toMatchObject({ default: expect.any(Function) });
  });
});
