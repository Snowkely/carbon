import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Pressable: "Pressable",
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: "Text",
  View: "View"
}));

import { ValueChainExplorer } from "./ValueChainExplorer";

type TestElement = { type: unknown; props: Record<string, any> & { children?: ReactNode } };
function descendants(node: ReactNode): TestElement[] {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as TestElement;
  const children = Array.isArray(element.props.children) ? element.props.children : [element.props.children];
  return [element, ...children.flatMap(descendants)];
}
function textContent(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!node || typeof node !== "object" || !("props" in node)) return "";
  return textContent((node as TestElement).props.children);
}

const nodes = ["Raw materials", "Dyeing", "Assembly", "Logistics", "Retail"];

describe("ValueChainExplorer", () => {
  it("shows obvious selected state and the editable Selected counter", () => {
    const tree = ValueChainExplorer({ nodes, selectedNodes: ["Dyeing"], onToggle: vi.fn(), onContinue: vi.fn() });
    const dyeing = descendants(tree).find((node) => node.props.accessibilityLabel === "Dyeing");
    expect(dyeing?.props.accessibilityState.selected).toBe(true);
    expect(textContent(dyeing as unknown as ReactNode)).toContain("✓ Dyeing");
    expect(textContent(tree)).toContain("Selected: 1 / 4");
    expect(textContent(tree)).not.toContain("Viewed:");
  });

  it("delegates a tap to local toggle state rather than persistence", () => {
    const onToggle = vi.fn(); const onContinue = vi.fn();
    const tree = ValueChainExplorer({ nodes, selectedNodes: [], onToggle, onContinue });
    const dyeing = descendants(tree).find((node) => node.props.accessibilityLabel === "Dyeing");
    dyeing?.props.onPress();
    expect(onToggle).toHaveBeenCalledWith("Dyeing");
    expect(onContinue).not.toHaveBeenCalled();
  });

  it("keeps Continue disabled below four selections and enables it at four", () => {
    const below = ValueChainExplorer({ nodes, selectedNodes: nodes.slice(0, 3), onToggle: vi.fn(), onContinue: vi.fn() });
    const ready = ValueChainExplorer({ nodes, selectedNodes: nodes.slice(0, 4), onToggle: vi.fn(), onContinue: vi.fn() });
    const findContinue = (tree: ReactNode) => descendants(tree).find((node) => node.props.accessibilityLabel === "Continue Value Chain exploration");
    expect(findContinue(below)?.props.disabled).toBe(true);
    expect(findContinue(ready)?.props.disabled).toBe(false);
  });

  it("renders committed nodes as selected when restored after Home or fresh login", () => {
    const persisted = ["Raw materials", "Dyeing", "Assembly", "Logistics"];
    for (const restoredRuntime of ["Home → Continue", "fresh Login → Continue"]) {
      const tree = ValueChainExplorer({ nodes, selectedNodes: persisted, onToggle: vi.fn(), onContinue: vi.fn() });
      expect(descendants(tree).filter((node) => node.props.accessibilityState?.selected === true)).toHaveLength(4);
      expect(textContent(tree), restoredRuntime).toContain("Selected: 4 / 4");
    }
  });
});
