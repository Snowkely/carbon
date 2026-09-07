import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  Pressable: "Pressable",
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: "Text",
  View: "View"
}));

import { StudentHistory } from "./StudentHistory";

type TestElement = { type: unknown; props: Record<string, unknown> & { children?: ReactNode } };

function expand(node: ReactNode): ReactNode {
  if (!node || typeof node !== "object" || !("props" in node)) return node;
  const element = node as TestElement;
  if (typeof element.type === "function") return expand(element.type(element.props));
  return element as unknown as ReactNode;
}

function textContent(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(textContent).join(" ");
  if (typeof node === "string" || typeof node === "number") return String(node);
  const expanded = expand(node);
  if (!expanded || typeof expanded !== "object" || !("props" in expanded)) return "";
  const children = (expanded as TestElement).props.children;
  return (Array.isArray(children) ? children : [children]).map(textContent).join(" ");
}

describe("StudentHistory", () => {
  it("renders a safe empty state", () => {
    expect(textContent(StudentHistory({ items: [], loading: false, error: null, onHome: vi.fn() }))).toContain("No learning history yet.");
  });

  it("renders IN PROGRESS and COMPLETED Mission attempts with available scores and dates", () => {
    const tree = StudentHistory({ items: [{
      id: "attempt-1", attemptNo: 1, session: { status: "ENDED", workshop: { name: "Climate Lab" } }, completedAt: "2026-09-05T10:00:00Z",
      missionAttempts: [
        { id: "m1", status: "IN_PROGRESS", systemScore: null, mission: { stableId: "M1", titleEn: "Boundary Detective" } },
        { id: "m2", status: "COMPLETED", systemScore: 84.16000000000001, completedAt: "2026-09-05T10:00:00Z", mission: { stableId: "M1", titleEn: "Boundary Detective" } }
      ]
    }], loading: false, error: null, onHome: vi.fn() });
    const text = textContent(tree);
    expect(text).toContain("Climate Lab");
    expect(text).toContain("Session: ENDED");
    expect(text).toContain("IN PROGRESS");
    expect(text).toContain("COMPLETED");
    expect(text.replaceAll(" ", "")).toContain("Systemscore:84.16/100.00");
    expect(text).not.toContain("84.16000000000001");
    expect(text).toContain("Completed:");
  });

  it("does not crash when optional Session and Workshop information is absent", () => {
    const render = () => StudentHistory({ items: [{ id: "attempt-1", missionAttempts: [{ id: "m1", status: "IN_PROGRESS", mission: null }] }], loading: false, error: null, onHome: vi.fn() });
    expect(render).not.toThrow();
    const text = textContent(render());
    expect(text).toContain("Workshop information unavailable");
    expect(text).toContain("Historical Session details unavailable");
  });
});
