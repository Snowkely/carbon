import React from "react";
import { StyleSheet, Text } from "react-native";
import { colors } from "@carbon/ui-tokens";
import { StudentHomeHeader } from "./StudentControls";

export const MISSION_BACK_LABEL = "‹ Home";

export function MissionHeader({ onBack, missionId = "M1", step, totalSteps }: { onBack: () => void; missionId?: string; step: number; totalSteps: number }) {
  return <StudentHomeHeader onHome={onBack}>
    <Text style={styles.kicker}>{missionId} · STEP {step}/{totalSteps}</Text>
  </StudentHomeHeader>;
}

const styles = StyleSheet.create({
  kicker: { color: colors.forest, fontWeight: "900", fontSize: 12, letterSpacing: 1 }
});
