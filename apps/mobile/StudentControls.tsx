import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "@carbon/ui-tokens";

export function StudentSubpageHeader({ label, accessibilityLabel, onPress, children }: { label: string; accessibilityLabel: string; onPress: () => void; children?: React.ReactNode }) {
  return <View style={styles.subpageHeader}>
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} hitSlop={8} onPress={onPress} style={({ pressed }) => [styles.outlineButton, pressed && styles.pressed]}>
      <Text style={styles.outlineText}>{label}</Text>
    </Pressable>
    {children}
  </View>;
}

export function StudentHomeHeader({ onHome, children }: { onHome: () => void; children?: React.ReactNode }) {
  return <StudentSubpageHeader label="‹ Home" accessibilityLabel="Back to Home" onPress={onHome}>{children}</StudentSubpageHeader>;
}

export function HomeRefreshControl({ refreshing, error, onRefresh }: { refreshing: boolean; error: string | null; onRefresh: () => void }) {
  return <View style={styles.refreshArea}>
    <Pressable accessibilityRole="button" accessibilityLabel="Refresh student home" accessibilityState={{ disabled: refreshing, busy: refreshing }} disabled={refreshing} onPress={onRefresh} style={[styles.outlineButton, refreshing && styles.disabled]}>
      <Text style={styles.outlineText}>{refreshing ? "Refreshing…" : "Refresh"}</Text>
    </Pressable>
    {error && <Text accessibilityRole="alert" style={styles.error}>Refresh failed: {error}</Text>}
  </View>;
}

export function FeedbackFooter({ busy, complete, onSubmit }: { busy: boolean; complete: boolean; onSubmit: () => void }) {
  return <View style={styles.footer}>
    <Text style={styles.body}>Feedback is separate from scoring and will not change your Mission results.</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Submit feedback" accessibilityState={{ disabled: busy || !complete }} disabled={busy || !complete} onPress={onSubmit} style={[styles.submitButton, (busy || !complete) && styles.disabled]}>
      <Text style={styles.submitText}>{busy ? "Submitting…" : "Submit feedback"}</Text>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  subpageHeader: { alignItems: "flex-start", gap: 8 },
  refreshArea: { gap: 8 },
  outlineButton: { minHeight: 44, minWidth: 112, justifyContent: "center", alignItems: "center", paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: "white" },
  outlineText: { color: colors.navy, fontSize: 16, fontWeight: "800" },
  pressed: { opacity: 0.65 },
  disabled: { opacity: 0.4 },
  error: { color: "#a32121", lineHeight: 20 },
  footer: { gap: 12 },
  body: { color: colors.muted, lineHeight: 21 },
  submitButton: { minHeight: 44, backgroundColor: colors.forest, paddingHorizontal: 15, paddingVertical: 12, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  submitText: { color: "white", fontWeight: "800" }
});
