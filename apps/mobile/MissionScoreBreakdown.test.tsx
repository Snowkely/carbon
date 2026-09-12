import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { MissionScoreBreakdownDto } from "@carbon/contracts";

vi.mock("react-native", () => ({ StyleSheet: { create: <T,>(styles: T) => styles }, Text: "Text", View: "View" }));
import { MissionScoreBreakdown } from "./MissionScoreBreakdown";

type Element = { type: unknown; props: { children?: ReactNode } };
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join(" ");
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!node || typeof node !== "object" || !("props" in node)) return "";
  const element = node as Element;
  if (typeof element.type === "function") return text(element.type(element.props));
  return text(element.props.children);
}
const normalizedText = (node: ReactNode) => text(node).replace(/\s+/g, " ").trim();
const dto = (missionStableId: string, entries: Array<[string, number, number]>, extra: Partial<MissionScoreBreakdownDto> = {}): MissionScoreBreakdownDto => ({ missionStableId, components: entries.map(([stableId, earned, maximum]) => ({ stableId, earned, maximum, status: "ACTIVE" })), rawActiveTotal: 100, rawActiveMaximum: 100, normalizedTotal: 100, normalizedMaximum: 100, normalizationApplied: false, ...extra });

describe("MissionScoreBreakdown", () => {
  it.each([
    ["M1", [["SCAN",8,8],["CARDS",72,72],["BOUNDARY",10,10],["REASONING_ASSISTANCE",10,10]]],
    ["M2", [["UNIT_MATCHING",15,15],["FACTOR_MATCHING",20,20],["CALCULATION",25,25],["HOTSPOT_REASONING",15,15],["COMPANY_COMPARISON",15,15],["INTENSITY_REASONING",10,10]]],
    ["M4", [["PROCESS",35,35],["POSITION_CALCULATION",25,25],["TRADE",25,25],["COMPLIANCE_REASONING",15,15]]],
    ["M5", [["COMPLIANCE",40,40],["COST_LOGIC",30,30],["POSITION",20,20],["REASONING",10,10]]],
    ["M6", [["ROUND_1_POLICY_SHOCK",50,50],["ROUND_2_TECHNOLOGY_SHOCK",25,25],["ROUND_3_INTEGRATED",25,25]]]
  ])("renders the authoritative %s structure and total", (mission, entries) => {
    const output = normalizedText(MissionScoreBreakdown({ breakdown: dto(mission as string, entries as Array<[string, number, number]>) }));
    for (const [, earned, maximum] of entries as Array<[string, number, number]>) expect(output).toContain(`${earned}.00 / ${maximum}.00`);
    expect(output).toContain("Total"); expect(output).toContain("100.00 / 100.00");
  });
  it("shows M3 Bonus as inactive and explains /95 normalization", () => {
    const breakdown = dto("M3", [["CONCEPT",45,45],["CASES",35,35],["MISCONCEPTION_CHALLENGE",15,15]], { components: [...dto("M3", [["CONCEPT",45,45],["CASES",35,35],["MISCONCEPTION_CHALLENGE",15,15]]).components, { stableId:"BONUS",earned:null,maximum:5,status:"INACTIVE_UNMAPPED" }], rawActiveTotal:95,rawActiveMaximum:95,normalizationApplied:true });
    const output = normalizedText(MissionScoreBreakdown({ breakdown }));
    expect(output).toContain("Bonus"); expect(output).toContain("Inactive — not earnable"); expect(output).toContain("Active raw structure: 95.00 / 95.00"); expect(output).toContain("100.00 / 100.00");
  });
});
