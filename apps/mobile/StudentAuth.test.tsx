import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Pressable: "Pressable", StyleSheet: { create: <T,>(styles: T) => styles }, Text: "Text", TextInput: "TextInput", View: "View" }));
vi.mock("@carbon/ui-tokens", () => ({ colors: { border: "gray", forest: "green", ink: "black", muted: "gray", navy: "navy" } }));

import { StudentLoginView, StudentRegistrationView } from "./StudentAuth";

type TestElement = { type: unknown; props: Record<string, any> & { children?: ReactNode } };
function descendants(node: ReactNode): TestElement[] {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as TestElement;
  if (typeof element.type === "function") return descendants(element.type(element.props));
  const children = Array.isArray(element.props.children) ? element.props.children : [element.props.children];
  return [element, ...children.flatMap(descendants)];
}
function textContent(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!node || typeof node !== "object" || !("props" in node)) return "";
  const element = node as TestElement;
  if (typeof element.type === "function") return textContent(element.type(element.props));
  return textContent(element.props.children);
}

const noop = vi.fn();
describe("Student authentication UI", () => {
  it("exposes Create student account from Login without changing Sign in", () => {
    const onCreateAccount = vi.fn();
    const tree = StudentLoginView({ username: "", password: "", busy: false, onUsernameChange: noop, onPasswordChange: noop, onSubmit: noop, onCreateAccount });
    expect(textContent(tree)).toContain("Student Login"); expect(textContent(tree)).toContain("Sign in"); expect(textContent(tree)).toContain("Create student account");
    expect(textContent(tree)).not.toContain("Create teacher account");
    const create = descendants(tree).find((node) => node.props.accessibilityLabel === "Create student account");
    create?.props.onPress(); expect(onCreateAccount).toHaveBeenCalledOnce();
  });

  it("renders the scroll-safe registration fields with both passwords masked and a readable error", () => {
    const tree = StudentRegistrationView({ username: "alex", password: "secret123", confirmPassword: "different", busy: false, error: "Passwords do not match.", onUsernameChange: noop, onPasswordChange: noop, onConfirmPasswordChange: noop, onSubmit: noop, onSignIn: noop });
    expect(textContent(tree)).toContain("Create Student Account"); expect(textContent(tree)).toContain("Already have an account?"); expect(textContent(tree)).toContain("Passwords do not match.");
    const fields = descendants(tree).filter((node) => node.type === "TextInput");
    expect(fields).toHaveLength(3); expect(fields.filter((node) => node.props.secureTextEntry)).toHaveLength(2);
    expect(fields.map((node) => node.props.accessibilityLabel)).toEqual(["Registration username", "Registration password", "Confirm password"]);
  });

  it("disables both registration actions while an account request is pending", () => {
    const tree = StudentRegistrationView({ username: "alex", password: "Carbon123!", confirmPassword: "Carbon123!", busy: true, error: null, onUsernameChange: noop, onPasswordChange: noop, onConfirmPasswordChange: noop, onSubmit: noop, onSignIn: noop });
    const buttons = descendants(tree).filter((node) => node.type === "Pressable");
    expect(buttons).toHaveLength(2); expect(buttons.every((button) => button.props.disabled === true)).toBe(true); expect(textContent(tree)).toContain("Creating account…");
  });
});
