import React from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, formatScore } from "@carbon/ui-tokens";
import { moveOrderItem } from "./mission-interactions";

export type MobileQuestion = { questionTemplateId: string; stableId: string; promptCn: string; type: string; answerMode?: string; screenTemplateId?: string; options: unknown; baseScore: number; finalized: boolean; attemptsUsed: number; revealAvailable: boolean; score?: number | null; resolutionMode?: string | null; selectedAnswer?: unknown };

const optionValue = (option: any) => typeof option === "object" && option !== null && "value" in option ? option.value : option;
const optionLabel = (option: any) => typeof option === "object" && option !== null && "label" in option ? String(option.label) : String(option);
const equal = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item, index) => equal(item, right[index]));
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && equal(leftRecord[key], rightRecord[key]));
};
const readableScalar = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value.toLocaleString("en-US");
  if (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value.trim())) return Number(value).toLocaleString("en-US");
  return String(value);
};

export function strategyAnswerLabel(options: unknown, answer: unknown): string {
  const configuredOptions: any[] = Array.isArray(options) ? options : [];
  const configured = configuredOptions.find((option) => equal(optionValue(option), answer));
  if (configured !== undefined) return optionLabel(configured);
  if (answer && typeof answer === "object" && !Array.isArray(answer) && "action" in answer) {
    const decision = answer as { action?: unknown; quantity?: unknown };
    const action = configuredOptions.find((option) => equal(optionValue(option), decision.action));
    const actionText = action === undefined ? readableScalar(decision.action) : optionLabel(action);
    return decision.quantity === undefined || String(decision.quantity).trim() === "" ? actionText : `${actionText} ${readableScalar(decision.quantity)}`;
  }
  if (answer === null || answer === undefined) return "Not selected";
  if (typeof answer !== "object") return readableScalar(answer);
  return JSON.stringify(answer);
}
export function resolvedStrategyLabel(question: Pick<MobileQuestion, "type" | "options" | "selectedAnswer">): string {
  return question.type === "REFLECTION" ? "Reasoning submitted" : `Selected strategy: ${strategyAnswerLabel(question.options, question.selectedAnswer)}`;
}
const typeLabels: Record<string, string> = { TAP: "SELECTION", DRAG: "SELECT CARD → SELECT SCOPE", ORDER: "PROCESS ORDER", SC: "SINGLE CHOICE", MC: "MULTIPLE CHOICE", NUM: "NUMERIC", SLIDER: "SLIDER", DECISION: "DECISION", REFLECTION: "REFLECTION" };

export function QuestionCard({ question, draftAnswer, strategyPreview, busy = false, disabled = false, message, onSelect, onReview, onSubmit, onHint, onReveal }: { question: MobileQuestion; draftAnswer: unknown | undefined; strategyPreview?: any; busy?: boolean; disabled?: boolean; message?: string; onSelect: (answer: unknown) => void; onReview?: () => void; onSubmit: () => void; onHint: () => void; onReveal: () => void }) {
  const raw: any = question.options;
  const options: any[] = Array.isArray(raw) ? raw : raw?.destinations ?? [];
  const revealed = question.resolutionMode === "REVEALED";
  const strategyResolved = question.resolutionMode === "STRATEGY";
  const isOrder = question.type === "ORDER";
  const isM5Decision = question.stableId === "M5-Q03";
  const isStrategyDecision = question.answerMode === "STRATEGY" && question.type !== "REFLECTION";
  const isReflection = question.type === "REFLECTION";
  const locked = busy || disabled;
  const order = isOrder ? (Array.isArray(draftAnswer) ? draftAnswer : options.map(optionValue)) : [];
  const decision = draftAnswer && typeof draftAnswer === "object" ? draftAnswer as { action?: string; quantity?: unknown } : {};
  const submitLabel = isOrder ? "Submit Order" : ["M4-Q05", "M4-Q06"].includes(question.stableId) ? "Submit Trade" : isStrategyDecision ? "Submit Decision" : isReflection ? "Submit Reasoning" : "Submit Answer";
  const submitA11y = submitLabel === "Submit Answer" ? `Submit answer for ${question.stableId}` : `${submitLabel} for ${question.stableId}`;
  const hasDraft = isOrder ? order.length > 0 : isM5Decision ? Boolean(decision.action) && String(decision.quantity ?? "").trim() !== "" && Boolean(strategyPreview) : isStrategyDecision ? draftAnswer !== undefined && Boolean(strategyPreview) : isReflection ? typeof draftAnswer === "string" && Boolean(draftAnswer.trim()) : draftAnswer !== undefined;
  return <View style={styles.card}>
    <Text style={styles.kicker}>{question.stableId} · {typeLabels[question.type] ?? "ACTIVITY"}</Text>
    <Text style={styles.title}>{question.promptCn}</Text>
    {question.finalized ? <View style={revealed ? styles.revealedResult : styles.correctResult}><Text style={revealed ? styles.revealedText : styles.correctText}>{revealed ? "Resolved by Reveal" : strategyResolved ? (isReflection ? "Reasoning evaluated" : "Decision resolved") : "Correct"}</Text>{strategyResolved && question.selectedAnswer !== undefined && <Text>{resolvedStrategyLabel(question)}</Text>}<Text style={styles.score}>{formatScore(question.score ?? 0)} / {formatScore(question.baseScore)} pts</Text></View> : <>
      {isOrder ? <View style={styles.options}>{order.map((value, index) => <View key={`${String(value)}-${index}`} style={styles.orderRow}><Text style={styles.orderNumber}>{index + 1}</Text><Text style={styles.orderLabel}>{String(value)}</Text><Pressable accessibilityRole="button" accessibilityLabel={`Move ${String(value)} up`} accessibilityState={{ disabled: locked || index === 0 }} disabled={locked || index === 0} onPress={() => onSelect(moveOrderItem(order, index, -1))} style={[styles.moveButton, (locked || index === 0) && styles.disabled]}><Text style={styles.moveText}>Move Up</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Move ${String(value)} down`} accessibilityState={{ disabled: locked || index === order.length - 1 }} disabled={locked || index === order.length - 1} onPress={() => onSelect(moveOrderItem(order, index, 1))} style={[styles.moveButton, (locked || index === order.length - 1) && styles.disabled]}><Text style={styles.moveText}>Move Down</Text></Pressable></View>)}</View>
        : isM5Decision ? <View style={styles.options}>{options.map((option, index) => { const value = String(optionValue(option)); const label = optionLabel(option); const selected = decision.action === value; return <Pressable key={`${question.stableId}-${index}`} accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ selected, disabled: locked }} disabled={locked} onPress={() => onSelect({ ...decision, action: value })} style={[styles.option, selected && styles.optionSelected]}><Text style={[styles.optionText, selected && styles.optionTextSelected]}>{selected ? "Selected: " : ""}{label}</Text></Pressable>; })}<TextInput accessibilityLabel="Decision quantity" keyboardType="numbers-and-punctuation" value={decision.quantity === undefined ? "" : String(decision.quantity)} onChangeText={(quantity) => onSelect({ ...decision, quantity })} editable={!locked} placeholder="Quantity (tCO2e)" style={styles.numericInput} /><Pressable accessibilityRole="button" accessibilityLabel="Review projected state" disabled={locked || !decision.action || String(decision.quantity ?? "").trim() === ""} onPress={onReview} style={[styles.secondaryButton, (locked || !decision.action || String(decision.quantity ?? "").trim() === "") && styles.disabled]}><Text style={styles.secondaryText}>Review projected state</Text></Pressable>{strategyPreview && <View style={styles.preview}><Text style={styles.previewTitle}>Projected state</Text><Text>Selected strategy: {strategyAnswerLabel(options, decision)}</Text><Text>Final allowances: {formatScore(strategyPreview.finalAllowances)}</Text><Text>Final emissions: {formatScore(strategyPreview.finalEmissions)}</Text><Text>Compliance gap: {formatScore(strategyPreview.complianceGap)}</Text><Text>Status: {strategyPreview.status}</Text><Text>Projected cost: €{formatScore(strategyPreview.projectedCost)}</Text></View>}</View>
        : isStrategyDecision ? <View style={styles.options}>{options.map((option, index) => { const value = optionValue(option); const label = optionLabel(option); const selected = equal(draftAnswer, value); return <Pressable key={`${question.stableId}-${index}`} accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ selected, disabled: locked }} disabled={locked} onPress={() => onSelect(value)} style={[styles.option, selected && styles.optionSelected]}><Text style={[styles.optionText, selected && styles.optionTextSelected]}>{selected ? "Selected: " : ""}{label}</Text></Pressable>; })}<Pressable accessibilityRole="button" accessibilityLabel={`Review strategy for ${question.stableId}`} disabled={locked || draftAnswer === undefined} onPress={onReview} style={[styles.secondaryButton, (locked || draftAnswer === undefined) && styles.disabled]}><Text style={styles.secondaryText}>Review strategy</Text></Pressable>{strategyPreview && <View style={styles.preview}><Text style={styles.previewTitle}>Decision review</Text><Text>Selected strategy: {strategyAnswerLabel(options, strategyPreview.selection)}</Text><Text>This review creates no scored evidence. Submit Decision when ready.</Text></View>}</View>
        : isReflection ? <TextInput accessibilityLabel={`Reasoning for ${question.stableId}`} multiline value={typeof draftAnswer === "string" ? draftAnswer : ""} onChangeText={onSelect} editable={!locked} placeholder="Explain your cost, position and compliance reasoning" style={[styles.numericInput, styles.reflectionInput]} />
        : <View style={styles.options}>{options.map((option, index) => { const value = optionValue(option); const label = optionLabel(option); const selected = question.type === "MC" ? Array.isArray(draftAnswer) && draftAnswer.some((item) => equal(item, value)) : draftAnswer !== undefined && equal(draftAnswer, value); return <Pressable key={`${question.stableId}-${index}`} accessibilityRole={question.type === "MC" ? "checkbox" : "radio"} accessibilityLabel={label} accessibilityState={{ selected, disabled: locked }} disabled={locked} onPress={() => onSelect(value)} style={[styles.option, selected && styles.optionSelected]}><Text style={[styles.optionText, selected && styles.optionTextSelected]}>{selected ? "✓ " : "○ "}{label}</Text></Pressable>; })}</View>}
      {question.type === "NUM" && <TextInput accessibilityLabel={`Numeric answer for ${question.stableId}`} keyboardType="numbers-and-punctuation" value={draftAnswer === undefined ? "" : String(draftAnswer)} onChangeText={onSelect} editable={!locked} placeholder="Enter signed numeric answer" style={styles.numericInput} />}
      <Pressable accessibilityRole="button" accessibilityLabel={submitA11y} accessibilityState={{ disabled: locked || !hasDraft }} disabled={locked || !hasDraft} onPress={onSubmit} style={[styles.submitButton, (locked || !hasDraft) && styles.disabled]}><Text style={styles.submitText}>{busy ? "Submitting…" : submitLabel}</Text></Pressable>
      <View style={styles.actions}><Pressable accessibilityRole="button" accessibilityLabel={`Hint for ${question.stableId}`} disabled={locked} onPress={onHint} style={styles.secondaryButton}><Text style={styles.secondaryText}>Hint</Text></Pressable>{question.revealAvailable && <Pressable accessibilityRole="button" accessibilityLabel={`Reveal answer for ${question.stableId}`} disabled={locked} onPress={onReveal} style={styles.revealButton}><Text style={styles.revealText}>Reveal (50% score)</Text></Pressable>}</View>
      {disabled && <Text style={styles.attempts}>Complete the preceding trade first.</Text>}<Text style={styles.attempts}>Submitted attempts: {question.attemptsUsed}</Text>
    </>}
    {!!message && <Text accessibilityLiveRegion="polite" style={styles.feedback}>{message}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: "white", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border, gap: 12 }, kicker: { color: colors.forest, fontWeight: "900", fontSize: 12, letterSpacing: 1 }, title: { fontSize: 17, fontWeight: "800", color: colors.ink }, options: { gap: 8 },
  option: { minHeight: 48, justifyContent: "center", paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: "white" }, optionSelected: { borderWidth: 2, borderColor: colors.forest, backgroundColor: "#dff1e2" }, optionText: { color: colors.navy, fontWeight: "700" }, optionTextSelected: { color: colors.forest, fontWeight: "900" },
  orderRow: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 8, padding: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 10 }, orderNumber: { width: 20, color: colors.forest, fontWeight: "900" }, orderLabel: { flex: 1, color: colors.navy, fontWeight: "800" }, moveButton: { minHeight: 38, paddingHorizontal: 7, justifyContent: "center", borderRadius: 8, borderWidth: 1, borderColor: colors.border }, moveText: { color: colors.navy, fontWeight: "700", fontSize: 11 },
  numericInput: { minHeight: 48, borderWidth: 2, borderColor: colors.forest, borderRadius: 10, paddingHorizontal: 14, backgroundColor: "white", fontSize: 18 }, submitButton: { minHeight: 46, borderRadius: 10, padding: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.forest }, submitText: { color: "white", fontWeight: "900" }, disabled: { opacity: 0.4 }, actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  reflectionInput: { minHeight: 130, paddingTop: 12, textAlignVertical: "top" }, preview: { gap: 4, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, backgroundColor: "#eef3ef" }, previewTitle: { color: colors.forest, fontWeight: "900" },
  secondaryButton: { minHeight: 42, paddingHorizontal: 15, justifyContent: "center", borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: "white" }, secondaryText: { color: colors.navy, fontWeight: "800" }, revealButton: { minHeight: 42, paddingHorizontal: 15, justifyContent: "center", borderRadius: 10, backgroundColor: colors.navy }, revealText: { color: "white", fontWeight: "800" }, attempts: { color: colors.muted, fontSize: 12, fontWeight: "700" }, feedback: { backgroundColor: "#fff8e8", padding: 10, borderRadius: 8, color: colors.ink, lineHeight: 20 },
  correctResult: { padding: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.forest, backgroundColor: "#eaf6ec" }, revealedResult: { padding: 12, borderRadius: 10, borderWidth: 1, borderColor: "#c88b18", backgroundColor: "#fff8e8" }, correctText: { color: colors.forest, fontWeight: "900", fontSize: 16 }, revealedText: { color: "#805b12", fontWeight: "900", fontSize: 16 }, score: { color: colors.ink, fontWeight: "800", marginTop: 4 }
});
