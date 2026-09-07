"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { formatScore } from "@carbon/ui-tokens";
import {
  AdjustmentTarget,
  GradebookSelection,
  SCORE_PRECEDENCE_LABELS,
  adjustmentInputLabel,
  adjustmentLevelLabel,
  canAdjustScores,
  currentOverride,
  effectiveFinalScore,
  effectiveMissionScore,
  effectiveQuestionScore,
  friendlyAttemptMode,
  friendlyMissionStatus,
  friendlyQuestionResolution,
  scorePagePolicy
} from "./score-state";
import { rosterLoadPresentation } from "./teacher-state";

type WorkshopRef = { id: string };
type Request = (path: string, options?: RequestInit) => Promise<any>;
type MissionEntry = { participant: any; attempt: any; mission: any };

function score(value: unknown): string {
  return value === null || value === undefined ? "—" : formatScore(Number(value));
}

function compactText(value: string | null | undefined): string {
  if (!value) return "—";
  return value.length > 90 ? `${value.slice(0, 87)}…` : value;
}

export function AdjustmentHistory({ stream }: { stream: any }) {
  const history = stream?.adjustments ?? [];
  if (history.length === 0) return <p className="muted">No audited adjustments.</p>;
  return <div className="tableWrap"><table><thead><tr><th>Original</th><th>Adjusted</th><th>Reason</th><th>Teacher</th><th>Timestamp</th><th>State</th></tr></thead><tbody>{history.map((item: any) => <tr key={item.id}><td>{score(item.originalSystemScore)}</td><td>{score(item.adjustedScore)}</td><td>{item.reason}</td><td>{item.adjustedBy?.name ?? "Teacher"}</td><td>{item.createdAt ? new Date(item.createdAt).toLocaleString() : "—"}</td><td><span className={`pill ${stream.currentAdjustmentId === item.id ? "" : "gray"}`}>{stream.currentAdjustmentId === item.id ? "Current" : "Superseded"}</span></td></tr>)}</tbody></table></div>;
}

export function QuestionSelection({ mission, selectedQuestionId, onSelect }: { mission: any; selectedQuestionId: string | null; onSelect: (result: any) => void }) {
  const questions = [...(mission.questionResults ?? [])].sort((a: any, b: any) => (a.question?.stableId ?? "").localeCompare(b.question?.stableId ?? "", undefined, { numeric: true }));
  return <section className="card tableWrap scoreSection"><div><p className="eyebrow">Questions in this attempt</p><h2>Select evidence to review</h2></div>{questions.length === 0 ? <p className="muted">No QuestionResults have been created for this MissionAttempt.</p> : <table><thead><tr><th>Question</th><th>Prompt</th><th>Resolution</th><th>System</th><th>Base</th><th>Override</th><th>Effective</th></tr></thead><tbody>{questions.map((result: any) => <tr key={result.id} className={selectedQuestionId === result.id ? "selectedScoreRow" : undefined}><td><button type="button" className="textButton" aria-pressed={selectedQuestionId === result.id} onClick={() => onSelect(result)}>{result.question?.stableId ?? "Question"}</button></td><td>{compactText(result.question?.promptEn ?? result.question?.promptCn)}</td><td>{friendlyQuestionResolution(result.status, result.resolutionMode)}</td><td>{score(result.systemScore)}</td><td>{score(result.v5BaseScore)}</td><td>{score(currentOverride(result.adjustmentStream))}</td><td><strong>{score(result.effectiveScore ?? effectiveQuestionScore(result))}</strong></td></tr>)}</tbody></table>}</section>;
}

export function AdjustmentForm({ target, request, onDone, onCancel }: { target: AdjustmentTarget; request: Request; onDone: () => Promise<void>; onCancel: () => void }) {
  const [value, setValue] = useState(String(target.systemScore));
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await request("/teacher/score-adjustments", { method: "POST", body: JSON.stringify({ targetLevel: target.level, targetId: target.id, adjustedScore: Number(value), reason, expectedSupersedesAdjustmentId: target.expectedAdjustmentId }) });
      await onDone();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };
  const numericValue = Number(value);
  const invalid = !reason.trim() || value.trim() === "" || !Number.isFinite(numericValue) || numericValue < 0 || numericValue > target.maximum;
  const actionLabel = target.level === "FINAL_TOTAL" ? "Apply audited Final Total adjustment" : `Apply audited ${adjustmentLevelLabel(target.level).toLowerCase()} adjustment`;
  return <form className="adjustmentForm stack" onSubmit={submit}><p className="eyebrow">Append-only {adjustmentLevelLabel(target.level)} adjustment</p><h3>{target.label}</h3><div className="grid"><label className="span4">{adjustmentInputLabel(target.level)} (0–{target.maximum})<input autoFocus type="number" min="0" max={target.maximum} step="0.01" value={value} onChange={(event) => setValue(event.target.value)} /></label><label className="span8">Reason<textarea required value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Required audit reason" /></label></div>{message && <div className="error">{message}</div>}<div className="row"><button className="button" disabled={busy || invalid}>{busy ? "Applying…" : actionLabel}</button><button type="button" className="button secondary" onClick={onCancel}>Cancel</button></div></form>;
}

export function QuestionDrilldown({ detail, mutable, adjustmentOpen, onAdjust, onOpenGradebook, adjustmentForm }: { detail: any; mutable: boolean; adjustmentOpen: boolean; onAdjust: () => void; onOpenGradebook?: () => void; adjustmentForm?: React.ReactNode }) {
  const override = currentOverride(detail.adjustmentStream);
  const adjustable = mutable && detail.status === "FINALIZED" && detail.systemScore !== null;
  return <section className="grid scoreSection"><div className="card span8"><div className="row between"><div><p className="eyebrow">Student Result Drill-down</p><h2>{detail.question.stableId}</h2></div><div className="row">{onOpenGradebook && <button type="button" className="button secondary" onClick={onOpenGradebook}>Open in Gradebook</button>}{adjustable && !adjustmentOpen && <button type="button" className="button" onClick={onAdjust}>Adjust Question</button>}</div></div><p>{detail.question.promptEn}</p><div className="tableWrap"><table><thead><tr><th>Attempt</th><th>Answer</th><th>Correct</th><th>Candidate</th><th>Mode</th></tr></thead><tbody>{detail.allAttempts.map((attempt: any) => <tr key={attempt.id}><td>{attempt.questionAttemptNo}</td><td><code>{JSON.stringify(attempt.studentAnswer)}</code></td><td>{attempt.independentlyCorrect ? "Yes" : "No"}</td><td>{score(attempt.candidateSystemScore)}</td><td>{friendlyAttemptMode(attempt.resolutionMode)}</td></tr>)}</tbody></table></div></div><div className="card span4 stack"><div><p className="eyebrow">Authoritative Question score</p><div className="scoreFacts"><span>System</span><strong>{score(detail.systemScore)} / {score(detail.v5BaseScore)}</strong><span>Override</span><strong>{score(override)}</strong><span>Effective</span><strong>{score(detail.effectiveScore)}</strong></div></div><div><h3>Adjustment history</h3><AdjustmentHistory stream={detail.adjustmentStream} /></div></div>{adjustmentOpen && <div className="card span12">{adjustmentForm}</div>}</section>;
}

export function MissionScorePanel({ mission, mutable, adjustmentOpen, onAdjust, onOpenGradebook, adjustmentForm }: { mission: any; mutable: boolean; adjustmentOpen: boolean; onAdjust: () => void; onOpenGradebook?: () => void; adjustmentForm?: React.ReactNode }) {
  const override = currentOverride(mission.adjustmentStream);
  return <section className="card scoreSection"><div className="row between"><div><p className="eyebrow">Mission score</p><h2>{mission.mission.stableId}</h2></div><div className="row">{onOpenGradebook && <button type="button" className="button secondary" onClick={onOpenGradebook}>Open in Gradebook</button>}{mutable && mission.systemScore !== null && !adjustmentOpen && <button type="button" className="button secondary" onClick={onAdjust}>Adjust Mission</button>}</div></div><div className="scoreFacts scoreFactsWide"><span>System Mission Score</span><strong>{score(mission.systemScore)} / 100.00</strong><span>Question-level adjusted calculation</span><strong>{score(mission.questionAdjustedScore)}</strong><span>Current Mission Override</span><strong>{score(override)}</strong><span>Effective Mission Score</span><strong>{score(mission.effectiveScore ?? effectiveMissionScore(mission))}</strong></div><h3>Mission adjustment history</h3><AdjustmentHistory stream={mission.adjustmentStream} />{adjustmentOpen && adjustmentForm}</section>;
}

export function FinalScorePanel({ participant, attempt, mutable, adjustmentOpen, onAdjust, adjustmentForm }: { participant: any; attempt: any; mutable: boolean; adjustmentOpen: boolean; onAdjust: () => void; adjustmentForm?: React.ReactNode }) {
  const override = currentOverride(attempt.adjustmentStream);
  const hasAuthoritativeTotal = attempt.systemTotalScore !== null && attempt.systemTotalScore !== undefined;
  return <section className="card scoreSection"><div className="row between"><div><p className="eyebrow">Final Carbon Market IQ</p><h2>{participant.student.name}</h2></div>{mutable && hasAuthoritativeTotal && !adjustmentOpen && <button type="button" className="button secondary" onClick={onAdjust}>Adjust Final Total</button>}</div><div className="scoreFacts scoreFactsWide"><span>System Final Total</span><strong>{score(attempt.systemTotalScore)}{hasAuthoritativeTotal ? " / 100.00" : ""}</strong><span>Current Final Override</span><strong>{score(override)}</strong><span>Effective Final Total</span><strong>{score(attempt.effectiveScore ?? effectiveFinalScore(attempt))}</strong></div>{!hasAuthoritativeTotal && <div className="notice">Final total is not available until all six authoritative Mission scores exist. No provisional score is fabricated.</div>}<h3>Final Total adjustment history</h3><AdjustmentHistory stream={attempt.adjustmentStream} />{adjustmentOpen && adjustmentForm}</section>;
}

export default function ScoreWorkspace({ selected, request, gradebook, initialSelection = null, onOpenGradebook }: { selected: WorkshopRef | null; request: Request; gradebook: boolean; initialSelection?: GradebookSelection | null; onOpenGradebook?: (selection: GradebookSelection) => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [role, setRole] = useState<string | null>(null);
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [target, setTarget] = useState<AdjustmentTarget | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selected) { setRows([]); setRole(null); setLoading(false); setLoadError(null); return; }
    setLoading(true);
    setLoadError(null);
    try {
      const [nextRows, workshop] = await Promise.all([request(`/teacher/workshops/${selected.id}/students`), request(`/teacher/workshops/${selected.id}`)]);
      setRows(nextRows);
      setRole(workshop.currentRole);
    } catch (error) {
      setRows([]);
      setLoadError(String(error));
    } finally {
      setLoading(false);
    }
  }, [selected, request]);

  useEffect(() => { setSelectedMissionId(initialSelection?.missionAttemptId ?? null); setSelectedQuestionId(initialSelection?.questionResultId ?? null); setDetail(null); setTarget(null); void load(); }, [load, initialSelection?.missionAttemptId, initialSelection?.questionResultId]);

  const missions = useMemo<MissionEntry[]>(() => rows.flatMap((participant) => participant.attempts.flatMap((attempt: any) => attempt.missionAttempts.map((mission: any) => ({ participant, attempt, mission })))), [rows]);
  const selectedEntry = missions.find((entry) => entry.mission.id === selectedMissionId) ?? null;
  const canMutate = canAdjustScores(role);
  const pagePolicy = scorePagePolicy(gradebook, role);
  const loadPresentation = rosterLoadPresentation(loading, loadError, missions.length);

  useEffect(() => {
    if (!gradebook || !initialSelection?.questionResultId || detail?.id === initialSelection.questionResultId) return;
    const result = selectedEntry?.mission.questionResults.find((item: any) => item.id === initialSelection.questionResultId);
    if (!result) return;
    request(`/teacher/question-results/${result.id}`).then(setDetail).catch((error) => setMessage(String(error)));
  }, [gradebook, initialSelection?.questionResultId, selectedEntry, detail?.id, request]);

  if (!selected) return <div className="notice">Create a Workshop first.</div>;
  if (loadPresentation.showLoading) return <><p className="eyebrow">{gradebook ? "Gradebook" : "Students"}</p><h1>{gradebook ? "Scores, evidence and audit" : "Workshop roster"}</h1><div className="card muted">Loading student attempts…</div></>;
  if (loadPresentation.showError) return <><p className="eyebrow">{gradebook ? "Gradebook" : "Students"}</p><h1>{gradebook ? "Scores, evidence and audit" : "Workshop roster"}</h1><div className="error">{loadError}</div></>;

  const openMission = (missionId: string) => { setSelectedMissionId(missionId); setSelectedQuestionId(null); setDetail(null); setTarget(null); };
  const openQuestion = async (result: any) => {
    setSelectedQuestionId(result.id);
    setTarget(null);
    try { setDetail(await request(`/teacher/question-results/${result.id}`)); } catch (error) { setMessage(String(error)); }
  };
  const openTarget = (next: AdjustmentTarget) => { if (gradebook) setTarget(next); };
  const finishAdjustment = async () => {
    const completedTarget = target;
    await load();
    if (completedTarget?.level === "QUESTION") setDetail(await request(`/teacher/question-results/${completedTarget.id}`));
    setTarget(null);
    setMessage("Audited adjustment applied. System evidence remains unchanged.");
  };
  const adjustmentForm = gradebook && target ? <AdjustmentForm key={`${target.level}:${target.id}:${target.expectedAdjustmentId ?? "none"}`} target={target} request={request} onDone={finishAdjustment} onCancel={() => setTarget(null)} /> : null;
  const exportCsv = async () => {
    try {
      const created = await request(`/teacher/workshops/${selected.id}/exports`, { method: "POST" });
      const file = await request(`/teacher/exports/${created.id}`);
      const bytes = Uint8Array.from(atob(file.base64), (character) => character.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "text/csv;charset=utf-8" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = file.filename; anchor.click(); URL.revokeObjectURL(url);
    } catch (error) { setMessage(String(error)); }
  };

  return <><div className="row between"><div><p className="eyebrow">{gradebook ? "Gradebook" : "Students"}</p><h1>{gradebook ? "Scores, evidence and audit" : "Workshop roster"}</h1></div>{canMutate && <button className="button secondary" onClick={exportCsv}>Export CSV</button>}</div><div className="notice scorePrecedence"><strong>Score precedence</strong><span>{SCORE_PRECEDENCE_LABELS.join("  ›  ")}</span></div>{role === "VIEWER" && <div className="notice">Read-only access. Score evidence and audit history remain visible.</div>}{message && <div className={message.startsWith("Audited") ? "success" : "error"}>{message}</div>}<div className="card tableWrap scoreSection"><table><thead><tr><th>Student</th><th>Class</th><th>Mission</th><th>Status</th><th>System</th><th>Effective</th><th>Evidence</th></tr></thead><tbody>{missions.map(({ participant, mission }) => <tr key={mission.id} className={selectedMissionId === mission.id ? "selectedScoreRow" : undefined}><td><strong>{participant.student.name}</strong><br /><span className="muted">{participant.student.studentId}</span></td><td>{participant.student.schoolClass.name}</td><td>{mission.mission.stableId}</td><td><span className="pill gray">{friendlyMissionStatus(mission.status)}</span></td><td>{score(mission.systemScore)}</td><td><strong>{score(mission.effectiveScore ?? effectiveMissionScore(mission))}</strong></td><td><button type="button" className="button secondary" disabled={!mission.questionResults.length} onClick={() => openMission(mission.id)}>Review scores &amp; evidence</button></td></tr>)}</tbody></table>{missions.length === 0 && <p className="muted">No student attempts yet.</p>}</div>{selectedEntry && <><MissionScorePanel mission={selectedEntry.mission} mutable={pagePolicy.canAdjustMission} adjustmentOpen={target?.level === "MISSION" && target.id === selectedEntry.mission.id} onAdjust={() => openTarget({ level: "MISSION", id: selectedEntry.mission.id, systemScore: Number(selectedEntry.mission.systemScore), maximum: 100, expectedAdjustmentId: selectedEntry.mission.adjustmentStream?.currentAdjustmentId ?? null, label: `${selectedEntry.mission.mission.stableId} Mission score` })} onOpenGradebook={!gradebook && onOpenGradebook ? () => onOpenGradebook({ missionAttemptId: selectedEntry.mission.id, questionResultId: selectedQuestionId }) : undefined} adjustmentForm={target?.level === "MISSION" ? adjustmentForm : null} />{pagePolicy.showFinalScoreSection && <FinalScorePanel participant={selectedEntry.participant} attempt={selectedEntry.attempt} mutable={pagePolicy.canAdjustFinalTotal} adjustmentOpen={target?.level === "FINAL_TOTAL" && target.id === selectedEntry.attempt.id} onAdjust={() => openTarget({ level: "FINAL_TOTAL", id: selectedEntry.attempt.id, systemScore: Number(selectedEntry.attempt.systemTotalScore), maximum: 100, expectedAdjustmentId: selectedEntry.attempt.adjustmentStream?.currentAdjustmentId ?? null, label: `${selectedEntry.participant.student.name} Final Carbon Market IQ` })} adjustmentForm={target?.level === "FINAL_TOTAL" && target.id === selectedEntry.attempt.id ? adjustmentForm : null} />}<QuestionSelection mission={selectedEntry.mission} selectedQuestionId={selectedQuestionId} onSelect={openQuestion} /></>}{detail && <QuestionDrilldown detail={detail} mutable={pagePolicy.canAdjustQuestion} adjustmentOpen={target?.level === "QUESTION" && target.id === detail.id} onAdjust={() => openTarget({ level: "QUESTION", id: detail.id, systemScore: Number(detail.systemScore), maximum: Number(detail.v5BaseScore), expectedAdjustmentId: detail.adjustmentStream?.currentAdjustmentId ?? null, label: `${detail.question.stableId} Question score` })} onOpenGradebook={!gradebook && onOpenGradebook && selectedEntry ? () => onOpenGradebook({ missionAttemptId: selectedEntry.mission.id, questionResultId: detail.id }) : undefined} adjustmentForm={target?.level === "QUESTION" ? adjustmentForm : null} />}</>;
}
