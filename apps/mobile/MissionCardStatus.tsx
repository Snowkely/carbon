import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { colors } from "@carbon/ui-tokens";
import { missionPresentation, type StudentMission } from "./student-state";

export function MissionCardStatus({ mission, onOpen }: { mission: StudentMission; onOpen: (mission: StudentMission) => void }) {
  const presentation = missionPresentation(mission);
  if (presentation.kind === "ACTION") {
    return <Pressable accessibilityRole="button" accessibilityLabel={`${presentation.label} ${mission.missionStableId}`} onPress={() => onOpen(mission)} style={styles.action}>
      <Text style={styles.actionText}>{presentation.label}</Text>
    </Pressable>;
  }
  return <Text accessibilityLabel={`${mission.missionStableId} ${presentation.label}`} style={[styles.badge, styles[presentation.tone]]}>{presentation.label}</Text>;
}

const styles = StyleSheet.create({
  action: { minHeight: 44, minWidth: 100, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.forest },
  actionText: { color: "white", fontWeight: "900" },
  badge: { minWidth: 100, overflow: "hidden", paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, borderWidth: 1, textAlign: "center", fontSize: 12, fontWeight: "900" },
  locked: { color: "#a32121", borderColor: "#d98787", backgroundColor: "#fff1f1" },
  neutral: { color: colors.muted, borderColor: colors.border, backgroundColor: "#f2f4f3" },
  comingSoon: { color: colors.navy, borderColor: "#9aa8d3", backgroundColor: "#eef1fb" },
  completed: { color: colors.forest, borderColor: "#8fbe98", backgroundColor: "#eaf6ec" }
});
