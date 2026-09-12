import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Pressable: "Pressable",
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: "Text",
  View: "View"
}));

import { MISSION_BACK_LABEL, MissionHeader } from "./MissionHeader";

type TestElement = { type: unknown; props: Record<string, unknown> & { children?: ReactNode } };

function expand(node: ReactNode): ReactNode {
  if (!node || typeof node !== "object" || !("props" in node)) return node;
  const element = node as TestElement;
  if (typeof element.type === "function") return expand(element.type(element.props));
  return element as unknown as ReactNode;
}

function descendants(node: ReactNode): TestElement[] {
  const expanded = expand(node);
  if (!expanded || typeof expanded !== "object" || !("props" in expanded)) return [];
  const element = expanded as TestElement;
  const children = Array.isArray(element.props.children) ? element.props.children : [element.props.children];
  return [element, ...children.flatMap(descendants)];
}

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  const expanded = expand(node);
  if (!expanded || typeof expanded !== "object" || !("props" in expanded)) return "";
  const children = (expanded as TestElement).props.children;
  return (Array.isArray(children) ? children : [children]).map(textContent).join("");
}

describe("MissionHeader", () => {
  it("renders a comfortable Home control and the current M1 step", () => {
    const onBack = vi.fn();
    const tree = MissionHeader({ onBack, step: 2, totalSteps: 7 });
    const back = descendants(tree).find((node) => node.props.accessibilityLabel === "Back to Home");

    expect(textContent(tree)).toContain(MISSION_BACK_LABEL);
    expect(textContent(tree)).toContain("M1 · STEP 2/7");

    (back?.props.onPress as () => void)();
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("shows Mission 4's current six-screen progress", () => {
    expect(textContent(MissionHeader({ onBack: vi.fn(), missionId: "M4", step: 5, totalSteps: 6 }))).toContain("M4 · STEP 5/6");
  });
});
