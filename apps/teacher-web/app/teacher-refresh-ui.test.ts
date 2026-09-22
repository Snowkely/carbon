import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const scoreWorkspace = readFileSync(new URL("./score-workspace.tsx", import.meta.url), "utf8");

describe("Teacher reload and refresh wiring", () => {
  it("restores sessionStorage authentication through the authoritative account endpoint", () => {
    expect(page).toContain("restoreTeacherSession(sessionStorage");
    expect(page).toContain('teacherApiRequest(API,token,"/teacher/account"');
    expect(page).toContain("refreshTeacherTokens(API,refreshToken)");
    expect(page).toContain("Restoring teacher session");
    expect(page).not.toContain('localStorage.setItem("teacherAccessToken"');
  });

  it("clears persisted authentication only from login/logout and unauthorized flows", () => {
    expect(page).toContain("persistTeacherTokens(sessionStorage,tokens)");
    expect(page).toContain("clearTeacherAccessToken(sessionStorage)");
    const refreshBody = page.slice(page.indexOf("const manualRefresh"), page.indexOf("const navigate="));
    expect(refreshBody).not.toContain("clearTeacherAccessToken");
  });

  it("never persists plaintext teacher credentials", () => {
    expect(page).not.toContain("sessionStorage.setItem(\"password\"");
    expect(page).not.toContain("localStorage.setItem(\"password\"");
  });

  it("uses in-place manual refresh with loading state and never reloads the browser", () => {
    expect(page).toContain('refreshing?"Refreshing…":"Refresh"');
    expect(page).toContain("await refreshCurrent()");
    expect(page).not.toContain("window.location.reload");
  });

  it("keeps Live Monitor polling registered after an immediate manual refresh", () => {
    expect(page).toContain("setInterval(()=>void load(),5000)");
    expect(page).toContain("registerRefresh(load)");
  });

  it("registers Students and Gradebook data loads as refresh handlers", () => {
    expect(scoreWorkspace).toContain("registerRefresh?.(load)");
    expect(scoreWorkspace).toContain("Showing the last loaded data");
  });

  it("provides reloadable Next routes for Workshop and Session URLs", () => {
    expect(existsSync(new URL("./workshops/[...path]/page.tsx", import.meta.url))).toBe(true);
    expect(existsSync(new URL("./sessions/[...path]/page.tsx", import.meta.url))).toBe(true);
    expect(page).toContain("sessions.find((item)=>item.id===initialRoute.current.sessionId)");
  });
});
