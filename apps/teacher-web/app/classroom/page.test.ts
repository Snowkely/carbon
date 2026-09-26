import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { classroomUrls } from "./classroom-origin";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("./ClassroomClient.tsx", import.meta.url), "utf8");

describe("classroom install page", () => {
  it.each([
    ["http://192.168.1.25:8088", "http://192.168.1.25:8088/v1"],
    ["http://localhost:18089", "http://localhost:18089/v1"],
    ["https://classroom.example", "https://classroom.example/v1"],
    ["https://classroom.example:8443", "https://classroom.example:8443/v1"],
  ])("preserves the browser origin and non-default port for %s", (origin, api) => {
    const urls = classroomUrls(origin);
    expect(urls.api).toBe(api);
    expect(urls.studentWeb).toBe(`${origin}/student`);
    expect(urls.install).toBe(`${origin}/classroom`);
    expect(urls.connectionDeepLink).toBe(`carbontrader://connect?api=${encodeURIComponent(api)}`);
  });

  it("builds all production classroom links below /carbon-trader", () => {
    const urls = classroomUrls("http://173.234.14.233", "/carbon-trader");
    expect(urls.teacherWeb).toBe("http://173.234.14.233/carbon-trader/");
    expect(urls.api).toBe("http://173.234.14.233/carbon-trader/v1");
    expect(urls.studentWeb).toBe("http://173.234.14.233/carbon-trader/student");
    expect(urls.install).toBe("http://173.234.14.233/carbon-trader/classroom");
  });

  it("has safe empty states for optional Android and iOS installation links", () => {
    expect(client).toContain("Android test build not configured");
    expect(client).toContain("iOS TestFlight link not configured");
    expect(client).not.toContain(".ipa");
  });

  it("reads optional app installation links at container runtime", () => {
    expect(source).toContain('export const dynamic = "force-dynamic"');
    expect(source).toContain("process.env.ANDROID_APP_INSTALL_URL");
  });

  it("renders distinct Student Web, Android download, and Android connection choices", () => {
    expect(client).toContain("window.location.origin");
    expect(client).toContain("1</p><h2>Student Web");
    expect(client).toContain("A</p><h2>Android App download");
    expect(client).toContain("B</p><h2>Android Connection QR");
    expect(client).toContain("current.studentWeb");
    expect(client).toContain("Download Android App");
    expect(client).toContain("CarbonTrader.apk");
    expect(source).toContain("ANDROID_APP_VERSION");
  });
});
