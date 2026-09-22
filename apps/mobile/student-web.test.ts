import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isClassroomStudentWeb, studentWebApiBase } from "./student-web";

const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const config = readFileSync(new URL("./app.config.ts", import.meta.url), "utf8");

describe("Student Web classroom runtime", () => {
  it.each([
    ["http://192.168.40.22:9090", "http://192.168.40.22:9090/v1"],
    ["https://carbon.school.example", "https://carbon.school.example/v1"],
    ["https://carbon.school.example:8443", "https://carbon.school.example:8443/v1"]
  ])("derives the API from arbitrary browser origin %s", (origin, expected) => {
    expect(studentWebApiBase(origin)).toBe(expected);
  });

  it("uses Classroom Web only on web and does not require an environment API URL", () => {
    expect(isClassroomStudentWeb("web", true)).toBe(true);
    expect(isClassroomStudentWeb("android", true)).toBe(false);
    expect(app).toContain("studentWebApiBase(window.location.origin)");
    expect(app).toContain("CLASSROOM_WEB_API ?? await loadSavedClassroomApi(DEFAULT_API, CLASSROOM_BUILD)");
  });

  it("exports production assets below /student without changing native classroom mode", () => {
    expect(config).toContain('process.env.CLASSROOM_WEB_BUILD === "true"');
    expect(config).toContain('baseUrl: "/student"');
    expect(config).toContain('process.env.CLASSROOM_BUILD === "true"');
    expect(app).toContain("!CLASSROOM_WEB &&");
  });

  it("polls while waiting for an active Session and keeps the manual refresh", () => {
    expect(app).toContain("setInterval(() => void loadHome(true), 5000)");
    expect(app).toContain("onRefresh={() => void loadHome()}");
  });

  it("uses bounded, wrapping layouts suitable for narrow browser viewports", () => {
    expect(app).toContain('maxWidth: 760');
    expect(app).toContain('flexWrap: "wrap"');
    expect(app).toContain("minHeight: 44");
  });
});
