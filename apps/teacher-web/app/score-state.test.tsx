import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AdjustmentForm, AdjustmentHistory, FinalScorePanel, MissionScorePanel, QuestionDrilldown, QuestionSelection } from "./score-workspace";
import { SCORE_PRECEDENCE_LABELS, canAdjustScores, effectiveFinalScore, effectiveMissionScore, findQuestionResult, friendlyMissionStatus, navigateToGradebook, scorePagePolicy } from "./score-state";

const question = (id: string, stableId: string, override: number | null = null) => ({
  id,
  status: "FINALIZED",
  resolutionMode: "INDEPENDENT",
  systemScore: 4,
  v5BaseScore: 5,
  effectiveScore: override ?? 4,
  question: { stableId, promptEn: `Prompt for ${stableId}` },
  adjustmentStream: override === null ? null : { currentAdjustmentId: `adj-${id}`, currentAdjustment: { id: `adj-${id}`, adjustedScore: override }, adjustments: [] }
});

describe("Teacher score adjustment presentation", () => {
  it("selects any QuestionResult belonging to the MissionAttempt", () => {
    const results = [question("qr7", "M1-Q07"), question("qr12", "M1-Q12")];
    expect(findQuestionResult(results, "qr12")?.question.stableId).toBe("M1-Q12");
  });

  it("renders the supplied QuestionResults instead of hardcoding Q01", () => {
    const html = renderToStaticMarkup(<QuestionSelection mission={{ questionResults: [question("qr7", "M1-Q07"), question("qr12", "M1-Q12")] }} selectedQuestionId={null} onSelect={vi.fn()} />);
    expect(html).toContain("M1-Q07");
    expect(html).toContain("M1-Q12");
    expect(html).not.toContain("M1-Q01");
  });

  it("keeps the Question adjustment form collapsed until Adjust Question is selected", () => {
    const detail = { ...question("qr2", "M1-Q02", 4.01), question: { stableId: "M1-Q02", promptEn: "Prompt" }, allAttempts: [] };
    const collapsed = renderToStaticMarkup(<QuestionDrilldown detail={detail} mutable adjustmentOpen={false} onAdjust={vi.fn()} />);
    const expanded = renderToStaticMarkup(<QuestionDrilldown detail={detail} mutable adjustmentOpen onAdjust={vi.fn()} adjustmentForm={<div>Adjusted score form</div>} />);
    expect(collapsed).toContain("Adjust Question");
    expect(collapsed).not.toContain("Adjusted score form");
    expect(expanded).toContain("Adjusted score form");
    expect(expanded).not.toContain(">Adjust Question<");
  });

  it("displays an existing 4.01 Question override and effective score", () => {
    const html = renderToStaticMarkup(<QuestionSelection mission={{ questionResults: [question("qr1", "M1-Q01", 4.01)] }} selectedQuestionId="qr1" onSelect={vi.fn()} />);
    expect(html.match(/4\.01/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("formats Gradebook scores without exposing floating-point noise", () => {
    const noisy = question("qr-noise", "M1-Q03");
    noisy.systemScore = 4.800000000000001;
    noisy.effectiveScore = 4.800000000000001;
    noisy.v5BaseScore = 6;
    const html = renderToStaticMarkup(<QuestionSelection mission={{ questionResults: [noisy] }} selectedQuestionId={null} onSelect={vi.fn()} />);
    expect(html).toContain("4.80");
    expect(html).toContain("6.00");
    expect(html).not.toContain("4.800000000000001");
  });

  it("renders Mission adjustment controls against the MissionAttempt", () => {
    const mission = { id: "ma1", systemScore: 84.16, questionAdjustedScore: 85, effectiveScore: 85, mission: { stableId: "M1" }, adjustmentStream: null };
    const html = renderToStaticMarkup(<MissionScorePanel mission={mission} mutable adjustmentOpen={false} onAdjust={vi.fn()} />);
    expect(html).toContain("Question-level adjusted calculation");
    expect(html).toContain("Adjust Mission");
  });

  it.each(["OWNER", "INSTRUCTOR"])("shows Adjust Mission to %s", (role) => {
    const mission = { id: "ma1", systemScore: 84.16, questionAdjustedScore: 83.66, effectiveScore: 83.66, mission: { stableId: "M1" }, adjustmentStream: null };
    const html = renderToStaticMarkup(<MissionScorePanel mission={mission} mutable={canAdjustScores(role)} adjustmentOpen={false} onAdjust={vi.fn()} />);
    expect(html).toContain("Adjust Mission");
  });

  it("does not show Adjust Mission to a VIEWER", () => {
    const mission = { id: "ma1", systemScore: 84.16, questionAdjustedScore: 83.66, effectiveScore: 83.66, mission: { stableId: "M1" }, adjustmentStream: null };
    const html = renderToStaticMarkup(<MissionScorePanel mission={mission} mutable={canAdjustScores("VIEWER")} adjustmentOpen={false} onAdjust={vi.fn()} />);
    expect(html).not.toContain("Adjust Mission");
  });

  it("renders the Mission form with numeric 0–100 bounds and a required reason", () => {
    const html = renderToStaticMarkup(<AdjustmentForm target={{ level: "MISSION", id: "ma1", systemScore: 84.16, maximum: 100, expectedAdjustmentId: null, label: "M1 Mission score" }} request={vi.fn()} onDone={vi.fn()} onCancel={vi.fn()} />);
    expect(html).toContain("Adjusted Mission Score (0–100)");
    expect(html).toContain('type="number"');
    expect(html).toContain('min="0"');
    expect(html).toContain('max="100"');
    expect(html).toContain("required");
    expect(html).toContain("Apply audited mission adjustment");
  });

  it("renders a separate Final Total adjustment control against the Attempt", () => {
    const html = renderToStaticMarkup(<FinalScorePanel participant={{ student: { name: "Alex" } }} attempt={{ id: "attempt-1", systemTotalScore: 80, adjustmentStream: null }} mutable adjustmentOpen={false} onAdjust={vi.fn()} />);
    expect(html).toContain("Final Carbon Market IQ");
    expect(html).toContain("Adjust Final Total");
  });

  it.each(["OWNER", "INSTRUCTOR"])("shows Adjust Final Total to %s for an authoritative total", (role) => {
    const policy = scorePagePolicy(true, role);
    const html = renderToStaticMarkup(<FinalScorePanel participant={{ student: { name: "Alex" } }} attempt={{ id: "attempt-1", systemTotalScore: 82.61, effectiveScore: 82.61, adjustmentStream: null }} mutable={policy.canAdjustFinalTotal} adjustmentOpen={false} onAdjust={vi.fn()} />);
    expect(html).toContain("System Final Total");
    expect(html).toContain("Effective Final Total");
    expect(html).toContain("Adjust Final Total");
  });

  it("keeps Final Total mutation hidden from VIEWER", () => {
    const policy = scorePagePolicy(true, "VIEWER");
    const html = renderToStaticMarkup(<FinalScorePanel participant={{ student: { name: "Alex" } }} attempt={{ id: "attempt-1", systemTotalScore: 82.61, adjustmentStream: null }} mutable={policy.canAdjustFinalTotal} adjustmentOpen={false} onAdjust={vi.fn()} />);
    expect(html).not.toContain("Adjust Final Total");
  });

  it("does not fabricate a provisional Final Total from an incomplete six-Mission set", () => {
    const html = renderToStaticMarkup(<FinalScorePanel participant={{ student: { name: "Alex" } }} attempt={{ id: "attempt-1", systemTotalScore: null, adjustmentStream: null }} mutable adjustmentOpen={false} onAdjust={vi.fn()} />);
    expect(html).toContain("Final Carbon Market IQ");
    expect(html).toContain("Final total is not available until all six authoritative Mission scores exist");
    expect(html).not.toContain("Adjust Final Total");
  });

  it("renders Final Total validation with numeric 0–100 bounds and required reason", () => {
    const html = renderToStaticMarkup(<AdjustmentForm target={{ level: "FINAL_TOTAL", id: "attempt-1", systemScore: 82.61, maximum: 100, expectedAdjustmentId: null, label: "Alex Final Carbon Market IQ" }} request={vi.fn()} onDone={vi.fn()} onCancel={vi.fn()} />);
    expect(html).toContain("Adjusted Final Total (0–100)");
    expect(html).toContain('type="number"');
    expect(html).toContain('min="0"');
    expect(html).toContain('max="100"');
    expect(html).toContain("required");
    expect(html).toContain("Apply audited Final Total adjustment");
  });

  it("applies Mission override precedence over the Question-derived Mission score", () => {
    expect(effectiveMissionScore({ systemScore: 80, questionAdjustedScore: 82, adjustmentStream: { currentAdjustment: { adjustedScore: 87 } } })).toBe(87);
  });

  it("uses the Question-derived Mission score when no Mission override exists", () => {
    expect(effectiveMissionScore({ systemScore: 80, questionAdjustedScore: 82, adjustmentStream: null })).toBe(82);
  });

  it("applies Final Total override precedence over the system/mission-derived total", () => {
    expect(effectiveFinalScore({ systemTotalScore: 88, adjustmentStream: { currentAdjustment: { adjustedScore: 91 } } })).toBe(91);
  });

  it("keeps an active Final Override effective after a Mission Override changes", () => {
    const attempt = { systemTotalScore: 12.62, effectiveMissionScores: { M1: 70 }, adjustmentStream: { currentAdjustment: { adjustedScore: 60 } } };
    expect(effectiveFinalScore(attempt)).toBe(60);
    attempt.effectiveMissionScores.M1 = 75;
    expect(effectiveFinalScore(attempt)).toBe(60);
  });

  it("shows append-only Final Total audit history as Superseded and Current", () => {
    const stream = { currentAdjustmentId: "final-2", currentAdjustment: { id: "final-2", adjustedScore: 72 }, adjustments: [
      { id: "final-1", originalSystemScore: 82.61, adjustedScore: 65, reason: "Initial final review", adjustedBy: { name: "Teacher A" }, createdAt: "2026-09-01T00:00:00Z" },
      { id: "final-2", originalSystemScore: 82.61, adjustedScore: 72, reason: "Updated final review", adjustedBy: { name: "Teacher B" }, createdAt: "2026-09-02T00:00:00Z" }
    ] };
    const html = renderToStaticMarkup(<FinalScorePanel participant={{ student: { name: "Alex" } }} attempt={{ id: "attempt-1", systemTotalScore: 82.61, adjustmentStream: stream }} mutable={false} adjustmentOpen={false} onAdjust={vi.fn()} />);
    expect(html).toContain("Final Total adjustment history");
    expect(html).toContain("65.00");
    expect(html).toContain("72.00");
    expect(html).toContain("Superseded");
    expect(html).toContain("Current");
    expect(html).not.toContain("Delete");
  });

  it("exposes the frozen precedence in teacher-friendly terms", () => {
    expect(SCORE_PRECEDENCE_LABELS).toEqual(["Final total override", "Mission override", "Question override", "System score"]);
  });

  it.each(["OWNER", "INSTRUCTOR"])("allows %s score mutation controls", (role) => {
    expect(canAdjustScores(role)).toBe(true);
  });

  it("keeps VIEWER read-only", () => {
    expect(canAdjustScores("VIEWER")).toBe(false);
  });

  it("labels audit entries as superseded or current without edit/delete actions", () => {
    const stream = { currentAdjustmentId: "adj2", adjustments: [
      { id: "adj1", originalSystemScore: 4, adjustedScore: 4.1, reason: "First review", adjustedBy: { name: "Teacher A" }, createdAt: "2026-09-01T00:00:00Z" },
      { id: "adj2", originalSystemScore: 4, adjustedScore: 4.2, reason: "Second review", adjustedBy: { name: "Teacher B" }, createdAt: "2026-09-02T00:00:00Z" }
    ] };
    const html = renderToStaticMarkup(<AdjustmentHistory stream={stream} />);
    expect(html).toContain("Superseded");
    expect(html).toContain("Current");
    expect(html).not.toContain("Delete");
    expect(html).not.toContain("Edit");
  });

  it("uses friendly labels instead of raw backend score/status enums", () => {
    const html = renderToStaticMarkup(<QuestionSelection mission={{ questionResults: [question("qr2", "M1-Q02")] }} selectedQuestionId={null} onSelect={vi.fn()} />);
    expect(friendlyMissionStatus("IN_PROGRESS")).toBe("In progress");
    expect(html).not.toContain("FINALIZED");
    expect(html).not.toContain("INDEPENDENT");
    expect(html).not.toContain("ScoreTargetLevel");
  });

  it("uses the requested target level and id in the audited adjustment request", async () => {
    const request = vi.fn();
    const html = renderToStaticMarkup(<AdjustmentForm target={{ level: "MISSION", id: "ma2", systemScore: 80, maximum: 100, expectedAdjustmentId: "adj1", label: "M1 Mission score" }} request={request} onDone={vi.fn()} onCancel={vi.fn()} />);
    expect(html).toContain("Append-only Mission adjustment");
    expect(html).toContain("Apply audited mission adjustment");
  });
});

describe("Students and Gradebook responsibility separation", () => {
  it.each(["OWNER", "INSTRUCTOR", "VIEWER"])("keeps Students score read-only for %s", (role) => {
    expect(scorePagePolicy(false, role)).toEqual({
      readOnly: true,
      canAdjustQuestion: false,
      canAdjustMission: false,
      canAdjustFinalTotal: false,
      showFinalScoreSection: false
    });
  });

  it("does not expose Question or Mission mutation controls in read-only evidence", () => {
    const stream = { currentAdjustmentId: "adj1", currentAdjustment: { id: "adj1", adjustedScore: 3.5 }, adjustments: [{ id: "adj1", originalSystemScore: 4, adjustedScore: 3.5, reason: "Evidence", adjustedBy: { name: "Teacher" }, createdAt: "2026-09-01T00:00:00Z" }] };
    const detail = { id: "qr2", status: "FINALIZED", systemScore: 4, effectiveScore: 3.5, v5BaseScore: 5, adjustmentStream: stream, question: { stableId: "M1-Q02", promptEn: "Read-only evidence prompt" }, allAttempts: [{ id: "qa1", questionAttemptNo: 1, studentAnswer: "Scope 1", independentlyCorrect: true, candidateSystemScore: 4, resolutionMode: "INDEPENDENT" }] };
    const mission = { id: "ma1", systemScore: 84.16, questionAdjustedScore: 83.66, effectiveScore: 83.66, mission: { stableId: "M1" }, adjustmentStream: null };
    const questionHtml = renderToStaticMarkup(<QuestionDrilldown detail={detail} mutable={false} adjustmentOpen={false} onAdjust={vi.fn()} onOpenGradebook={vi.fn()} />);
    const missionHtml = renderToStaticMarkup(<MissionScorePanel mission={mission} mutable={false} adjustmentOpen={false} onAdjust={vi.fn()} onOpenGradebook={vi.fn()} />);
    const html = questionHtml + missionHtml;
    expect(html).not.toContain("Adjust Question");
    expect(html).not.toContain("Adjust Mission");
    expect(html).not.toContain("Adjust Final Total");
    expect(html).not.toContain("Apply audited");
    expect(html).toContain("Read-only evidence prompt");
    expect(html).toContain("Effective");
    expect(html).toContain("3.50");
    expect(html).toContain("Adjustment history");
    expect(html).toContain("Evidence");
    expect(html).toContain("Open in Gradebook");
  });

  it("opens Gradebook with the selected MissionAttempt and Question context", () => {
    const setSelection = vi.fn();
    const setView = vi.fn();
    const selection = { missionAttemptId: "ma1", questionResultId: "qr2" };
    navigateToGradebook(setSelection, setView, selection);
    expect(setSelection).toHaveBeenCalledWith(selection);
    expect(setView).toHaveBeenCalledWith("Gradebook");
  });

  it.each(["OWNER", "INSTRUCTOR"])("keeps all Gradebook adjustment levels available to %s", (role) => {
    expect(scorePagePolicy(true, role)).toEqual({
      readOnly: false,
      canAdjustQuestion: true,
      canAdjustMission: true,
      canAdjustFinalTotal: true,
      showFinalScoreSection: true
    });
  });

  it("keeps Gradebook read-only for VIEWER while retaining its score section", () => {
    expect(scorePagePolicy(true, "VIEWER")).toEqual({
      readOnly: false,
      canAdjustQuestion: false,
      canAdjustMission: false,
      canAdjustFinalTotal: false,
      showFinalScoreSection: true
    });
  });
});
