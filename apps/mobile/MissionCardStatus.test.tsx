import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Pressable: "Pressable",
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: "Text"
}));

import { MissionCardStatus } from "./MissionCardStatus";
import type { StudentMission } from "./student-state";

type TestElement = { props: Record<string, unknown> & { children?: ReactNode } };
const mission = (overrides: Partial<StudentMission>): StudentMission => ({
  missionTemplateId: "m1", missionStableId: "M1", titleCn: "边界侦探", titleEn: "Boundary Detective",
  progressState: "NOT_STARTED", accessState: "BLOCKED_SESSION_UNLOCK", capabilities: { canStartAttempt: false }, ...overrides
});

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!node || typeof node !== "object" || !("props" in node)) return "";
  const children = (node as TestElement).props.children;
  return (Array.isArray(children) ? children : [children]).map(textContent).join("");
}

describe("Student Mission status presentation", () => {
  it.each([
    ["locked Mission", mission({ accessState: "BLOCKED_SESSION_UNLOCK", reason: "SESSION_NOT_UNLOCKED" }), "LOCKED"],
    ["unmet prerequisite", mission({ accessState: "BLOCKED_PREREQUISITE", reason: "PREREQUISITE_NOT_COMPLETED" }), "UNCOMPLETED"],
    ["available Mission", mission({ accessState: "AVAILABLE", capabilities: { canStartAttempt: true } }), "START"],
    ["available deferred Mission", mission({ accessState: "AVAILABLE", capabilities: { canStartAttempt: false } }), "COMING SOON"],
    ["active attempt", mission({ progressState: "IN_PROGRESS", accessState: "ACTIVE_ATTEMPT", activeMissionAttemptId: "ma-existing" }), "CONTINUE"],
    ["completed Mission", mission({ progressState: "COMPLETED", accessState: "COMPLETED_READ_ONLY" }), "COMPLETED"]
  ])("renders only the student-facing state for %s", (_name, value, label) => {
    const text = textContent(MissionCardStatus({ mission: value, onOpen: vi.fn() }));
    expect(text).toBe(label);
    expect(text).not.toContain(value.accessState);
    if (value.progressState !== label) expect(text).not.toContain(value.progressState);
    if (value.reason) expect(text).not.toContain(value.reason);
  });

  it("passes the existing active MissionAttempt through the CONTINUE action", () => {
    const onOpen = vi.fn();
    const value = mission({ progressState: "IN_PROGRESS", accessState: "ACTIVE_ATTEMPT", activeMissionAttemptId: "ma-existing" });
    const tree = MissionCardStatus({ mission: value, onOpen }) as unknown as TestElement;
    (tree.props.onPress as () => void)();
    expect(onOpen).toHaveBeenCalledWith(value);
    expect(value.activeMissionAttemptId).toBe("ma-existing");
  });

  it("does not expose an action that can enter deferred gameplay", () => {
    const onOpen = vi.fn();
    const value = mission({ missionTemplateId: "m3", missionStableId: "M3", accessState: "AVAILABLE", capabilities: { canStartAttempt: false } });
    const tree = MissionCardStatus({ mission: value, onOpen }) as unknown as TestElement;
    expect(textContent(tree as unknown as ReactNode)).toBe("COMING SOON");
    expect(tree.props.onPress).toBeUndefined();
    expect(onOpen).not.toHaveBeenCalled();
  });
});
