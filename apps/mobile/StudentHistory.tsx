import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { colors, formatScore } from "@carbon/ui-tokens";
import { StudentHomeHeader } from "./StudentControls";
import { displayDate, displayStatus, type HistoryItem } from "./student-state";

export function StudentHistory({ items, loading, error, onHome }: { items: HistoryItem[]; loading: boolean; error: string | null; onHome: () => void }) {
  return <View style={styles.list}>
    <StudentHomeHeader onHome={onHome} />
    <Text style={styles.title}>Learning History</Text>
    {loading && <ActivityIndicator color={colors.forest} />}
    {error && <Text accessibilityRole="alert" style={styles.error}>Unable to load history: {error}</Text>}
    {!loading && !error && items.length === 0 && <View style={styles.empty}><Text style={styles.cardTitle}>No learning history yet.</Text><Text style={styles.body}>Your Mission attempts will appear here after you begin.</Text></View>}
    {!loading && !error && items.map((item) => {
      const missions = Array.isArray(item.missionAttempts) ? item.missionAttempts : [];
      const attemptCompletedAt = displayDate(item.completedAt);
      return <View key={item.id} style={styles.card}>
        <Text style={styles.cardTitle}>{item.attemptNo ? `Attempt ${item.attemptNo}` : "Learning attempt"}</Text>
        <Text style={styles.body}>{item.session?.workshop?.name?.trim() || "Workshop information unavailable"}</Text>
        <Text style={styles.context}>{item.session?.status ? `Session: ${displayStatus(item.session.status)}` : "Historical Session details unavailable"}</Text>
        {missions.length === 0 && <Text style={styles.body}>No Mission activity recorded.</Text>}
        {missions.map((mission) => {
          const completedAt = displayDate(mission.completedAt) ?? (mission.status === "COMPLETED" ? attemptCompletedAt : null);
          const title = mission.mission?.titleEn?.trim() || mission.mission?.titleCn?.trim();
          return <View key={mission.id} style={styles.mission}>
            <Text style={styles.missionTitle}>{[mission.mission?.stableId, title].filter(Boolean).join(" · ") || "Mission"}</Text>
            <Text style={[styles.status, mission.status === "COMPLETED" ? styles.complete : styles.inProgress]}>{displayStatus(mission.status)}</Text>
            {typeof mission.systemScore === "number" && <Text style={styles.body}>System score: {formatScore(mission.systemScore)}/100.00</Text>}
            {completedAt && <Text style={styles.context}>Completed: {completedAt}</Text>}
          </View>;
        })}
        {typeof item.systemTotalScore === "number" && <Text style={styles.body}>Total system score: {formatScore(item.systemTotalScore)}</Text>}
      </View>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  list: { gap: 14 },
  title: { fontSize: 23, fontWeight: "800", color: colors.ink },
  card: { backgroundColor: "white", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border, gap: 10 },
  empty: { backgroundColor: "white", borderRadius: 16, padding: 20, borderWidth: 1, borderColor: colors.border, gap: 8 },
  cardTitle: { fontSize: 17, fontWeight: "800", color: colors.ink },
  mission: { borderTopWidth: 1, borderColor: colors.border, paddingTop: 10, gap: 4 },
  missionTitle: { fontWeight: "800", color: colors.ink },
  status: { fontSize: 12, fontWeight: "900" },
  inProgress: { color: colors.navy },
  complete: { color: colors.forest },
  body: { color: colors.muted, lineHeight: 21 },
  context: { color: colors.muted, fontSize: 12 },
  error: { color: "#a32121", lineHeight: 20 }
});
