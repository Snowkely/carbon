import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { missionScoreComponentLabel, type MissionScoreBreakdownDto } from "@carbon/contracts";
import { colors, formatScore } from "@carbon/ui-tokens";

export function MissionScoreBreakdown({ breakdown }: { breakdown: MissionScoreBreakdownDto }) {
  return <View style={styles.card} accessibilityLabel="Mission Score Breakdown">
    <Text style={styles.title}>Mission Score Breakdown</Text>
    {breakdown.components.map((component) => <View key={component.stableId} style={styles.row}>
      <View style={styles.labelBlock}>
        <Text style={styles.label}>{missionScoreComponentLabel(component.stableId)}</Text>
        {component.status === "INACTIVE_UNMAPPED" && <Text style={styles.inactive}>Inactive — not earnable</Text>}
      </View>
      <Text style={component.status === "ACTIVE" ? styles.value : styles.inactiveValue}>
        {component.status === "ACTIVE" && component.earned !== null ? `${formatScore(component.earned)} / ${formatScore(component.maximum)}` : `— / ${formatScore(component.maximum)}`}
      </Text>
    </View>)}
    {breakdown.normalizationApplied && <Text style={styles.note}>Active raw structure: {formatScore(breakdown.rawActiveTotal)} / {formatScore(breakdown.rawActiveMaximum)}, normalized to the Mission total below.</Text>}
    <View style={[styles.row, styles.total]}><Text style={styles.totalLabel}>Total</Text><Text style={styles.totalLabel}>{formatScore(breakdown.normalizedTotal)} / 100.00</Text></View>
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: "white", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border, gap: 10 },
  title: { fontSize: 18, fontWeight: "900", color: colors.navy },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  labelBlock: { flex: 1 }, label: { color: colors.ink, fontWeight: "700" }, value: { color: colors.ink, fontVariant: ["tabular-nums"] },
  inactive: { color: colors.muted, fontSize: 11 }, inactiveValue: { color: colors.muted },
  note: { color: colors.muted, fontSize: 12, lineHeight: 18, paddingTop: 3 },
  total: { borderTopWidth: 1, borderColor: colors.border, paddingTop: 10, marginTop: 2 }, totalLabel: { color: colors.forest, fontWeight: "900", fontSize: 16 }
});
