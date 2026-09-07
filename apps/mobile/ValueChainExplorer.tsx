import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "@carbon/ui-tokens";
import { valueChainCanContinue } from "./mission-interactions";

export function ValueChainExplorer({
  nodes,
  selectedNodes,
  required = 4,
  busy = false,
  onToggle,
  onContinue
}: {
  nodes: string[];
  selectedNodes: string[];
  required?: number;
  busy?: boolean;
  onToggle: (nodeId: string) => void;
  onContinue: () => void;
}) {
  const canContinue = valueChainCanContinue(selectedNodes, required);
  return <View style={styles.card}>
    <Text style={styles.title}>Value Chain Map</Text>
    <Text style={styles.body}>Select at least four emission hotspots, then confirm your exploration.</Text>
    <View style={styles.options}>{nodes.map((node) => {
      const selected = selectedNodes.includes(node);
      return <Pressable
        key={node}
        accessibilityRole="button"
        accessibilityLabel={node}
        accessibilityState={{ selected, disabled: busy }}
        disabled={busy}
        onPress={() => onToggle(node)}
        style={[styles.option, selected && styles.optionSelected]}
      ><Text style={[styles.optionText, selected && styles.optionTextSelected]}>{selected ? "✓ " : "○ "}{node}</Text></Pressable>;
    })}</View>
    <Text accessibilityLabel="Value Chain selection count" style={styles.counter}>Selected: {new Set(selectedNodes).size} / {required}</Text>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Continue Value Chain exploration"
      accessibilityState={{ disabled: busy || !canContinue }}
      disabled={busy || !canContinue}
      onPress={onContinue}
      style={[styles.continueButton, (busy || !canContinue) && styles.disabled]}
    ><Text style={styles.continueText}>{busy ? "Saving…" : "Continue"}</Text></Pressable>
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: "white", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border, gap: 12 },
  title: { fontSize: 23, fontWeight: "800", color: colors.ink },
  body: { color: colors.muted, lineHeight: 21 },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  option: { minHeight: 48, minWidth: "47%", flexGrow: 1, justifyContent: "center", paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 11, backgroundColor: "white" },
  optionSelected: { borderWidth: 2, borderColor: colors.forest, backgroundColor: "#dff1e2" },
  optionText: { color: colors.navy, fontWeight: "700" },
  optionTextSelected: { color: colors.forest, fontWeight: "900" },
  counter: { color: colors.ink, fontSize: 15, fontWeight: "800" },
  continueButton: { minHeight: 48, backgroundColor: colors.forest, paddingHorizontal: 15, paddingVertical: 12, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  continueText: { color: "white", fontWeight: "800" },
  disabled: { opacity: 0.4 }
});
