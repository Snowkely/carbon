import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, formatScore } from "@carbon/ui-tokens";

export type MobileQuestion = {
  questionTemplateId: string;
  stableId: string;
  promptCn: string;
  type: string;
  options: unknown;
  baseScore: number;
  finalized: boolean;
  attemptsUsed: number;
  revealAvailable: boolean;
  score?: number | null;
  resolutionMode?: string | null;
};

function answerEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function QuestionCard({
  question,
  draftAnswer,
  busy = false,
  message,
  onSelect,
  onSubmit,
  onHint,
  onReveal
}: {
  question: MobileQuestion;
  draftAnswer: unknown | undefined;
  busy?: boolean;
  message?: string;
  onSelect: (answer: unknown) => void;
  onSubmit: () => void;
  onHint: () => void;
  onReveal: () => void;
}) {
  const rawOptions: any = question.options;
  const options: any[] = Array.isArray(rawOptions) ? rawOptions : rawOptions?.destinations ?? [];
  const resolvedByReveal = question.resolutionMode === "REVEALED";

  return <View style={styles.card}>
    <Text style={styles.kicker}>{question.stableId} · {question.type === "DRAG" ? "SELECT CARD → SELECT SCOPE" : question.type}</Text>
    <Text style={styles.title}>{question.promptCn}</Text>
    {question.finalized ? <View style={resolvedByReveal ? styles.revealedResult : styles.correctResult}>
      <Text style={resolvedByReveal ? styles.revealedText : styles.correctText}>{resolvedByReveal ? "Resolved by Reveal" : "Correct"}</Text>
      <Text style={styles.score}>{formatScore(question.score ?? 0)} / {formatScore(question.baseScore)} pts</Text>
    </View> : <>
      <View style={styles.options}>{options.map((option, index) => {
        const value = typeof option === "object" && option !== null && "value" in option ? option.value : option;
        const label = typeof option === "object" && option !== null && "label" in option ? String(option.label) : String(option);
        const selected = draftAnswer !== undefined && answerEqual(draftAnswer, value);
        return <Pressable
          key={`${question.stableId}-${index}`}
          accessibilityRole="radio"
          accessibilityLabel={label}
          accessibilityState={{ selected, disabled: busy }}
          disabled={busy}
          onPress={() => onSelect(value)}
          style={[styles.option, selected && styles.optionSelected]}
        ><Text style={[styles.optionText, selected && styles.optionTextSelected]}>{selected ? "✓ " : "○ "}{label}</Text></Pressable>;
      })}</View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Submit answer for ${question.stableId}`}
        accessibilityState={{ disabled: busy || draftAnswer === undefined }}
        disabled={busy || draftAnswer === undefined}
        onPress={onSubmit}
        style={[styles.submitButton, (busy || draftAnswer === undefined) && styles.disabled]}
      ><Text style={styles.submitText}>{busy ? "Submitting…" : "Submit Answer"}</Text></Pressable>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Hint for ${question.stableId}`} disabled={busy} onPress={onHint} style={styles.secondaryButton}><Text style={styles.secondaryText}>Hint</Text></Pressable>
        {question.revealAvailable && <Pressable accessibilityRole="button" accessibilityLabel={`Reveal answer for ${question.stableId}`} disabled={busy} onPress={onReveal} style={styles.revealButton}><Text style={styles.revealText}>Reveal (50% score)</Text></Pressable>}
      </View>
      <Text style={styles.attempts}>Submitted attempts: {question.attemptsUsed}</Text>
    </>}
    {!!message && <Text accessibilityLiveRegion="polite" style={styles.feedback}>{message}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: "white", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border, gap: 12 },
  kicker: { color: colors.forest, fontWeight: "900", fontSize: 12, letterSpacing: 1 },
  title: { fontSize: 17, fontWeight: "800", color: colors.ink },
  options: { gap: 8 },
  option: { minHeight: 48, justifyContent: "center", paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: "white" },
  optionSelected: { borderWidth: 2, borderColor: colors.forest, backgroundColor: "#dff1e2" },
  optionText: { color: colors.navy, fontWeight: "700" },
  optionTextSelected: { color: colors.forest, fontWeight: "900" },
  submitButton: { minHeight: 46, borderRadius: 10, padding: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.forest },
  submitText: { color: "white", fontWeight: "900" },
  disabled: { opacity: 0.4 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  secondaryButton: { minHeight: 42, paddingHorizontal: 15, justifyContent: "center", borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: "white" },
  secondaryText: { color: colors.navy, fontWeight: "800" },
  revealButton: { minHeight: 42, paddingHorizontal: 15, justifyContent: "center", borderRadius: 10, backgroundColor: colors.navy },
  revealText: { color: "white", fontWeight: "800" },
  attempts: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  feedback: { backgroundColor: "#fff8e8", padding: 10, borderRadius: 8, color: colors.ink, lineHeight: 20 },
  correctResult: { padding: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.forest, backgroundColor: "#eaf6ec" },
  revealedResult: { padding: 12, borderRadius: 10, borderWidth: 1, borderColor: "#c88b18", backgroundColor: "#fff8e8" },
  correctText: { color: colors.forest, fontWeight: "900", fontSize: 16 },
  revealedText: { color: "#805b12", fontWeight: "900", fontSize: 16 },
  score: { color: colors.ink, fontWeight: "800", marginTop: 4 }
});
