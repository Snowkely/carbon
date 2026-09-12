import { describe, expect, it, vi } from "vitest";
import { createUnauthorizedCoordinator, missionScoreComponentLabel } from "./index.js";

describe("unauthorized confirmation coordination", () => {
  it("waits for confirmation and coalesces parallel 401 responses", () => {
    const coordinator = createUnauthorizedCoordinator(); const show = vi.fn(); const clear = vi.fn();
    expect(coordinator.notify(show, clear)).toBe(true);
    expect(coordinator.notify(show, clear)).toBe(false);
    expect(show).toHaveBeenCalledOnce(); expect(clear).not.toHaveBeenCalled();
    const confirm = show.mock.calls[0]![0] as () => void;
    confirm(); confirm();
    expect(clear).toHaveBeenCalledOnce();
    expect(coordinator.notify(show, clear)).toBe(false);
  });

  it("can be reset only for a newly authenticated session", () => {
    const coordinator = createUnauthorizedCoordinator(); const show = vi.fn((confirm: () => void) => confirm()); const clear = vi.fn();
    coordinator.notify(show, clear); coordinator.reset(); coordinator.notify(show, clear);
    expect(show).toHaveBeenCalledTimes(2); expect(clear).toHaveBeenCalledTimes(2);
  });
});

it("provides the shared M1-M6 component labels", () => {
  expect(["SCAN", "UNIT_MATCHING", "BONUS", "PROCESS", "COST_LOGIC", "ROUND_3_INTEGRATED"].map(missionScoreComponentLabel)).toEqual(["Scan", "Unit", "Bonus", "Process", "Cost Logic", "Round 3 Integrated"]);
});
