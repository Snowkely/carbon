import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Pressable: "Pressable",
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: "Text",
  View: "View"
}));

import { FeedbackFooter, HomeRefreshControl, StudentHomeHeader, StudentSubpageHeader } from "./StudentControls";

type TestElement = { type: unknown; props: Record<string, unknown> & { children?: ReactNode } };

function expand(node: ReactNode): ReactNode {
  if (!node || typeof node !== "object" || !("props" in node)) return node;
  const element = node as TestElement;
  if (typeof element.type === "function") return expand(element.type(element.props));
  return element as unknown as ReactNode;
}

function descendants(node: ReactNode): TestElement[] {
  if (Array.isArray(node)) return node.flatMap(descendants);
  const expanded = expand(node);
  if (!expanded || typeof expanded !== "object" || !("props" in expanded)) return [];
  const element = expanded as TestElement;
  const children = Array.isArray(element.props.children) ? element.props.children : [element.props.children];
  return [element, ...children.flatMap(descendants)];
}

function textContent(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  const expanded = expand(node);
  if (!expanded || typeof expanded !== "object" || !("props" in expanded)) return "";
  const children = (expanded as TestElement).props.children;
  return (Array.isArray(children) ? children : [children]).map(textContent).join("");
}

describe("Student mobile controls", () => {
  it("shows a disabled visible loading state and a visible Refresh failure", () => {
    const tree = HomeRefreshControl({ refreshing: true, error: "Server unavailable", onRefresh: vi.fn() });
    const refresh = descendants(tree).find((node) => node.props.accessibilityLabel === "Refresh student home");
    expect(textContent(tree)).toContain("Refreshing…");
    expect(textContent(tree)).toContain("Refresh failed: Server unavailable");
    expect(refresh?.props.disabled).toBe(true);
  });

  it("renders reusable Home navigation and invokes only its navigation callback", () => {
    const onHome = vi.fn();
    const tree = StudentHomeHeader({ onHome });
    const back = descendants(tree).find((node) => node.props.accessibilityLabel === "Back to Home");
    expect(textContent(tree)).toContain("‹ Home");
    (back?.props.onPress as () => void)();
    expect(onHome).toHaveBeenCalledOnce();
  });

  it("keeps only Submit feedback in the Feedback footer", () => {
    const onSubmit = vi.fn();
    const tree = FeedbackFooter({ busy: false, complete: true, onSubmit });
    expect(textContent(tree)).toContain("Submit feedback");
    expect(textContent(tree)).not.toContain("Back");
    const submit = descendants(tree).find((node) => node.props.accessibilityLabel === "Submit feedback");
    (submit?.props.onPress as () => void)();
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("keeps the generic header usable with the shared Home vocabulary", () => {
    const tree = StudentSubpageHeader({ label: "‹ Home", accessibilityLabel: "Back to Home", onPress: vi.fn() });
    expect(textContent(tree)).toContain("‹ Home");
  });
});
