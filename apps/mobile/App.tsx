import AsyncStorage from "@react-native-async-storage/async-storage";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, formatScore } from "@carbon/ui-tokens";
import { MissionHeader } from "./MissionHeader";
import { MissionCardStatus } from "./MissionCardStatus";
import { QuestionCard, type MobileQuestion as Question } from "./QuestionCard";
import { ValueChainExplorer } from "./ValueChainExplorer";
import { backToHomeFromMission, resolveMissionOpen, resumeMission } from "./mission-navigation";
import { allQuestionsResolved, commitValueChainDraft, formatQuestionRevealResult, formatQuestionSubmissionResult, setQuestionDraft, toggleDraftAnswer, toggleValueChainNode, type QuestionRevealResult, type QuestionSubmissionResult } from "./mission-interactions";
import { FeedbackFooter, HomeRefreshControl, StudentHomeHeader } from "./StudentControls";
import { StudentHistory } from "./StudentHistory";
import { backToStudentHome, buildFeedbackResponses, emptyFeedbackDraft, fetchStudentHomeState, initializeStudentRuntime, isFeedbackComplete, normalizeHistoryPayload, screenAfterLogin, userFacingError, type FeedbackDraft, type HistoryItem, type StudentMission as Mission, type StudentScreen, type StudentSession as Session } from "./student-state";

const API = process.env.EXPO_PUBLIC_API_URL;
if (!API) throw new Error("EXPO_PUBLIC_API_URL must be configured");
const INITIAL_STUDENT_RUNTIME = initializeStudentRuntime();
const VALUE_CHAIN_NODES = ["Raw materials", "Dyeing", "Assembly", "Logistics", "Retail", "Use phase", "End of life"];

const submissionId = () => "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
  const value = Math.floor(Math.random() * 16);
  return (character === "x" ? value : (value & 0x3) | 0x8).toString(16);
});

function Button({ title, onPress, disabled = false, tone = "green" }: { title: string; onPress: () => void; disabled?: boolean; tone?: "green" | "navy" | "plain" }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.button, tone === "navy" && styles.navy, tone === "plain" && styles.plain, disabled && styles.disabled]}><Text style={[styles.buttonText, tone === "plain" && styles.plainText]}>{title}</Text></Pressable>;
}

export default function App() {
  const [token, setToken] = useState<string | null>(INITIAL_STUDENT_RUNTIME.token);
  const [screen, setScreen] = useState<StudentScreen>(INITIAL_STUDENT_RUNTIME.screen);
  const [session, setSession] = useState<Session | null>(null);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [missionAttemptId, setMissionAttemptId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [homeError, setHomeError] = useState<string | null>(null);
  const [feedbackDrafts, setFeedbackDrafts] = useState<Record<string, FeedbackDraft>>({});

  const request = async (path: string, options: RequestInit = {}) => {
    const response = await fetch(`${API}${path}`, { ...options, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } });
    const data = response.status === 204 ? null : await response.json();
    if (!response.ok) throw new Error(data?.error?.message ?? "Request failed");
    return data;
  };
  const loadHome = async () => {
    setRefreshing(true); setHomeError(null);
    try {
      const next = await fetchStudentHomeState(request); setSession(next.session); setMissions(next.missions);
    } catch (error) { if (String(error).toLowerCase().includes("profile")) setScreen("profile"); else { const message = userFacingError(error); setHomeError(message); Alert.alert("Refresh failed", message); } }
    finally { setRefreshing(false); }
  };
  useEffect(() => { if (token && screen === "home") void loadHome(); }, [token, screen]);
  const logout = async () => { await AsyncStorage.removeItem("accessToken"); setToken(null); setScreen("login"); };
  return <SafeAreaView style={styles.safe}><StatusBar style="dark" />
    <View style={styles.header}><View><Text style={styles.brand}>CARBON TRADER I</Text><Text style={styles.subtitle}>Carbon Market Explorer</Text></View>{token && <Pressable onPress={logout}><Text style={styles.link}>Logout</Text></Pressable>}</View>
    {screen === "login" && <Login onLoggedIn={async (value, profileRequired) => { await AsyncStorage.setItem("accessToken", value); setToken(value); setScreen(screenAfterLogin(profileRequired)); }} />}
    {screen === "profile" && <Profile token={token!} onDone={() => setScreen("home")} />}
    {screen === "home" && <Home session={session} missions={missions} refreshing={refreshing} refreshError={homeError} onRefresh={loadHome} onOpen={async (mission) => { const action = resolveMissionOpen(mission); if (action.kind === "BLOCKED") { if (mission.accessState === "ACTIVE_ATTEMPT") Alert.alert("Continue", "The active attempt could not be resolved. Refresh and try again."); else if (mission.accessState === "AVAILABLE") Alert.alert("Mission unavailable", "This Mission's gameplay is not available in Phase 1 yet."); return; } if (action.kind === "RESUME") { const target = resumeMission(action.missionAttemptId); setMissionAttemptId(target.missionAttemptId); setScreen(target.screen); return; } const attempt = await request(`/student/sessions/${session!.id}/missions/${mission.missionTemplateId}/attempts`, { method: "POST" }); setMissionAttemptId(attempt.id); setScreen("mission"); }} onHistory={() => setScreen("history")} onFeedback={() => setScreen("feedback")} />}
    {screen === "mission" && missionAttemptId && <MissionPlayer token={token!} missionAttemptId={missionAttemptId} onBack={() => { const target = backToHomeFromMission(missionAttemptId); setMissionAttemptId(target.missionAttemptId); setScreen(target.screen); }} onDone={() => { setMissionAttemptId(null); setScreen("home"); }} onFeedback={() => setScreen("feedback")} />}
    {screen === "history" && <History token={token!} onBack={() => setScreen(backToStudentHome())} />}
    {screen === "feedback" && session && <Feedback token={token!} sessionId={session.id} draft={feedbackDrafts[session.id] ?? emptyFeedbackDraft()} onDraftChange={(draft) => setFeedbackDrafts((current) => ({ ...current, [session.id]: draft }))} onBack={() => setScreen(backToStudentHome())} />}
  </SafeAreaView>;
}

function Login({ onLoggedIn }: { onLoggedIn: (token: string, profileRequired: boolean) => void }) {
  const [username, setUsername] = useState("student.alex"); const [password, setPassword] = useState("Carbon123!"); const [busy, setBusy] = useState(false);
  const login = async () => { setBusy(true); try { const response = await fetch(`${API}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error?.message); onLoggedIn(data.accessToken, data.profileRequired); } catch (error) { Alert.alert("Login failed", String(error)); } finally { setBusy(false); } };
  return <ScrollView contentContainerStyle={styles.page}><Text style={styles.hero}>Learn the market. Change the future.</Text><View style={styles.card}><Text style={styles.title}>Student Login / 学生登录</Text><TextInput accessibilityLabel="Username" style={styles.input} value={username} onChangeText={setUsername} autoCapitalize="none" /><TextInput accessibilityLabel="Password" style={styles.input} value={password} onChangeText={setPassword} secureTextEntry /><Button title={busy ? "Signing in…" : "Enter Carbon Trader"} onPress={login} disabled={busy} /></View></ScrollView>;
}

function Profile({ token, onDone }: { token: string; onDone: () => void }) {
  const [refs, setRefs] = useState<any[]>([]); const [name, setName] = useState(""); const [studentId, setStudentId] = useState(""); const [classId, setClassId] = useState("");
  useEffect(() => { fetch(`${API}/reference/schools`).then((r) => r.json()).then((data) => { setRefs(data); setClassId(data[0]?.classes[0]?.id ?? ""); }); }, []);
  const school = refs[0];
  const save = async () => { const response = await fetch(`${API}/student/profile`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ name, studentId, schoolId: school.id, classId }) }); const data = await response.json(); if (!response.ok) return Alert.alert("Profile", data.error?.message); onDone(); };
  return <ScrollView contentContainerStyle={styles.page}><View style={styles.card}><Text style={styles.kicker}>FIRST LOGIN</Text><Text style={styles.title}>Complete your profile</Text><Text style={styles.label}>School</Text><Text style={styles.readonly}>{school?.name ?? "Loading…"}</Text><Text style={styles.label}>Name</Text><TextInput style={styles.input} value={name} onChangeText={setName} /><Text style={styles.label}>Student ID</Text><TextInput style={styles.input} value={studentId} onChangeText={setStudentId} /><Text style={styles.label}>Class</Text>{school?.classes.map((item: any) => <Pressable key={item.id} onPress={() => setClassId(item.id)} style={[styles.choice, classId === item.id && styles.choiceSelected]}><Text>{item.name}</Text></Pressable>)}<Button title="Save profile" onPress={save} disabled={!name.trim() || !studentId.trim() || !classId} /></View></ScrollView>;
}

function Home({ session, missions, refreshing, refreshError, onRefresh, onOpen, onHistory, onFeedback }: { session: Session | null; missions: Mission[]; refreshing: boolean; refreshError: string | null; onRefresh: () => void; onOpen: (m: Mission) => void; onHistory: () => void; onFeedback: () => void }) {
  return <ScrollView contentContainerStyle={styles.page}><View style={styles.heroCard}><Text style={styles.kicker}>CURRENT WORKSHOP</Text><Text style={styles.title}>{session?.workshopName ?? "Waiting for an active class"}</Text><Text style={styles.body}>{session ? "Your teacher controls Mission access." : "Your active Workshop will appear automatically — no code or QR required."}</Text></View>
    <View style={styles.row}><View style={styles.grow}><HomeRefreshControl refreshing={refreshing} error={refreshError} onRefresh={onRefresh} /></View><Button title="History" tone="plain" onPress={onHistory} />{session && <Button title="Feedback" tone="plain" onPress={onFeedback} />}</View>
    <Text style={styles.section}>Learning journey / 学习旅程</Text>{missions.map((mission) => <View key={mission.missionTemplateId} style={styles.missionCard}><View style={styles.badge}><Text style={styles.badgeText}>{mission.missionStableId}</Text></View><View style={styles.grow}><Text style={styles.cardTitle}>{mission.titleEn}</Text><Text style={styles.body}>{mission.titleCn}</Text></View><MissionCardStatus mission={mission} onOpen={onOpen} /></View>)}</ScrollView>;
}

function MissionPlayer({ token, missionAttemptId, onBack, onDone, onFeedback }: { token: string; missionAttemptId: string; onBack: () => void; onDone: () => void; onFeedback: () => void }) {
  const [data, setData] = useState<any>(null); const [step, setStep] = useState(0); const [busy, setBusy] = useState(false); const [reflection, setReflection] = useState(""); const [completedScore, setCompletedScore] = useState<number | null>(null);
  const [valueChainDraft, setValueChainDraft] = useState<string[]>([]); const [valueChainDraftReady, setValueChainDraftReady] = useState(false); const [valueChainBusy, setValueChainBusy] = useState(false);
  const [questionDrafts, setQuestionDrafts] = useState<Record<string, unknown>>({}); const [questionMessages, setQuestionMessages] = useState<Record<string, string>>({}); const [questionBusy, setQuestionBusy] = useState<Record<string, boolean>>({});
  const [localQuestionResults, setLocalQuestionResults] = useState<Record<string, { score: number; resolutionMode: "INDEPENDENT" | "REVEALED" }>>({});
  const reflectionDraftKey = `missionAttempt:${missionAttemptId}:reflectionDraft`;
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  const refresh = () => fetch(`${API}/student/mission-attempts/${missionAttemptId}`, { headers }).then((r) => r.json()).then(setData);
  useEffect(() => { void refresh(); }, []);
  useEffect(() => { let mounted = true; void AsyncStorage.getItem(reflectionDraftKey).then((value) => { if (mounted && value !== null) setReflection(value); }); return () => { mounted = false; }; }, [reflectionDraftKey]);
  useEffect(() => { const savedReflection = data?.runtimeState?.reflection; if (typeof savedReflection === "string") setReflection((current) => current || savedReflection); }, [data?.runtimeState?.reflection]);
  useEffect(() => { if (data && !valueChainDraftReady) { setValueChainDraft(Array.isArray(data.runtimeState?.viewedNodes) ? data.runtimeState.viewedNodes : []); setValueChainDraftReady(true); } }, [data, valueChainDraftReady]);
  useEffect(() => { const stableId = data?.currentScreen?.stableId; const index = ["M1-S01", "M1-S02", "M1-S03", "M1-S04", "M1-S05", "M1-S06", "M1-S07"].indexOf(stableId); if (index >= 0) setStep(index); }, [data?.currentScreen?.stableId]);
  if (!data) return <View style={styles.center}><ActivityIndicator /></View>;
  const screens = ["M1-S01", "M1-S02", "M1-S03", "M1-S04", "M1-S05", "M1-S06", "M1-S07"];
  const screen = screens[step]!;
  const screenQuestions = data.questions.filter((q: Question) => {
    const ranges: Record<string, (id: string) => boolean> = { "M1-S03": (id) => id === "M1-Q01", "M1-S04": (id) => /^M1-Q0[2-7]$/.test(id), "M1-S05": (id) => /^M1-Q(0[8-9]|1[0-3])$/.test(id), "M1-S06": (id) => ["M1-Q14", "M1-Q15", "M1-Q16"].includes(id) }; return ranges[screen]?.(q.stableId) ?? false;
  });
  const post = async (path: string, body?: unknown) => { const response = await fetch(`${API}${path}`, { method: "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) }); const result = await response.json(); if (!response.ok) throw new Error(result.error?.message); return result; };
  const next = async () => { const target = Math.min(6, step + 1); await post(`/student/mission-attempts/${missionAttemptId}/screens/${screens[target]}`); setStep(target); await refresh(); };
  const chooseQuestionAnswer = (question: Question, answer: unknown) => setQuestionDrafts((current) => setQuestionDraft(current, question.questionTemplateId, toggleDraftAnswer(current[question.questionTemplateId], answer)));
  const submitQuestionAnswer = async (question: Question) => {
    const answer = questionDrafts[question.questionTemplateId]; if (answer === undefined || question.finalized) return;
    setQuestionBusy((current) => ({ ...current, [question.questionTemplateId]: true }));
    try {
      const result = await post(`/student/mission-attempts/${missionAttemptId}/questions/${question.questionTemplateId}/submissions`, { clientSubmissionId: submissionId(), answer, timeSpentMs: 1000 }) as QuestionSubmissionResult;
      setQuestionMessages((current) => ({ ...current, [question.questionTemplateId]: formatQuestionSubmissionResult(result, question.baseScore) }));
      setQuestionDrafts((current) => setQuestionDraft(current, question.questionTemplateId, undefined));
      if (result.correct) setLocalQuestionResults((current) => ({ ...current, [question.questionTemplateId]: { score: result.score, resolutionMode: "INDEPENDENT" } }));
      await refresh();
    } catch (error) { setQuestionMessages((current) => ({ ...current, [question.questionTemplateId]: String(error) })); }
    finally { setQuestionBusy((current) => ({ ...current, [question.questionTemplateId]: false })); }
  };
  const requestQuestionHint = async (question: Question) => {
    setQuestionBusy((current) => ({ ...current, [question.questionTemplateId]: true }));
    try { const result = await post(`/student/mission-attempts/${missionAttemptId}/questions/${question.questionTemplateId}/hint`); setQuestionMessages((current) => ({ ...current, [question.questionTemplateId]: result.hint })); await refresh(); }
    catch (error) { setQuestionMessages((current) => ({ ...current, [question.questionTemplateId]: String(error) })); }
    finally { setQuestionBusy((current) => ({ ...current, [question.questionTemplateId]: false })); }
  };
  const revealQuestionAnswer = async (question: Question) => {
    setQuestionBusy((current) => ({ ...current, [question.questionTemplateId]: true }));
    try { const result = await post(`/student/mission-attempts/${missionAttemptId}/questions/${question.questionTemplateId}/reveal`) as QuestionRevealResult; setQuestionMessages((current) => ({ ...current, [question.questionTemplateId]: formatQuestionRevealResult(result, question.baseScore) })); setQuestionDrafts((current) => setQuestionDraft(current, question.questionTemplateId, undefined)); setLocalQuestionResults((current) => ({ ...current, [question.questionTemplateId]: { score: result.score, resolutionMode: "REVEALED" } })); await refresh(); }
    catch (error) { setQuestionMessages((current) => ({ ...current, [question.questionTemplateId]: String(error) })); }
    finally { setQuestionBusy((current) => ({ ...current, [question.questionTemplateId]: false })); }
  };
  const confirmValueChain = async () => {
    setValueChainBusy(true);
    try {
      const persistedNodes = Array.isArray(data.runtimeState?.viewedNodes) ? data.runtimeState.viewedNodes : [];
      await commitValueChainDraft(valueChainDraft, persistedNodes, (nodeId) => post(`/student/mission-attempts/${missionAttemptId}/value-chain/nodes`, { nodeId }));
      await next();
    } catch (error) { Alert.alert("Value Chain Map", String(error)); }
    finally { setValueChainBusy(false); }
  };
  const displayedQuestions = screenQuestions.map((question: Question) => {
    const localResult = localQuestionResults[question.questionTemplateId];
    return localResult ? { ...question, finalized: true, score: localResult.score, resolutionMode: localResult.resolutionMode } : question;
  });
  if (completedScore !== null) return <ScrollView contentContainerStyle={styles.page}><View style={styles.heroCard}><Text style={styles.kicker}>MISSION 1 COMPLETE</Text><Text style={styles.hero}>{formatScore(completedScore)} / 100.00</Text><Text style={styles.title}>Boundary Detective</Text><Text style={styles.body}>Your result is saved. Mission 2 stays locked until your teacher explicitly unlocks it.</Text><Button title="Share workshop feedback" onPress={onFeedback} /><Button title="Return to Mission Map" tone="plain" onPress={onDone} /></View></ScrollView>;
  return <ScrollView contentContainerStyle={styles.page}><MissionHeader onBack={onBack} step={step + 1} totalSteps={7} /><View style={styles.progress}><View style={[styles.progressFill, { width: `${((step + 1) / 7) * 100}%` }]} /></View>
    {screen === "M1-S01" && <View style={styles.card}><Text style={styles.title}>Boundary Detective</Text><Text style={styles.body}>Map GreenThread’s emissions and classify Scope 1, 2 and 3. The reporting boundary — not just location — decides the answer.</Text><Button title="Start Mission" onPress={() => void next()} /></View>}
    {screen === "M1-S02" && <ValueChainExplorer nodes={VALUE_CHAIN_NODES} selectedNodes={valueChainDraft} busy={valueChainBusy} onToggle={(nodeId) => setValueChainDraft((current) => toggleValueChainNode(current, nodeId))} onContinue={() => void confirmValueChain()} />}
    {displayedQuestions.map((question: Question) => <QuestionCard key={question.questionTemplateId} question={question} draftAnswer={questionDrafts[question.questionTemplateId]} busy={questionBusy[question.questionTemplateId]} message={questionMessages[question.questionTemplateId]} onSelect={(answer) => chooseQuestionAnswer(question, answer)} onSubmit={() => void submitQuestionAnswer(question)} onHint={() => void requestQuestionHint(question)} onReveal={() => void revealQuestionAnswer(question)} />)}
    {["M1-S03", "M1-S04", "M1-S05", "M1-S06"].includes(screen) && <Button title="Continue" onPress={() => void next()} disabled={!allQuestionsResolved(displayedQuestions)} />}
    {screen === "M1-S07" && <View style={styles.card}><Text style={styles.title}>Reality Check & Reflection</Text><Text style={styles.body}>Why can the same physical emission be Scope 1 for one company and Scope 3 for another?</Text><TextInput multiline style={[styles.input, styles.multiline]} value={reflection} onChangeText={(value) => { setReflection(value); void AsyncStorage.setItem(reflectionDraftKey, value); }} placeholder="Write your reflection…" /><Button title="Submit reflection" onPress={async () => { try { await post(`/student/mission-attempts/${missionAttemptId}/reflection`, { response: reflection }); await refresh(); Alert.alert("Reflection saved", "Completion evidence recorded — semantic quality is not AI graded."); } catch (error) { Alert.alert("Reflection", String(error)); } }} disabled={!reflection.trim()} /><Button title={busy ? "Calculating…" : "Complete Mission 1"} onPress={async () => { setBusy(true); try { const result = await post(`/student/mission-attempts/${missionAttemptId}/complete`); await AsyncStorage.removeItem(reflectionDraftKey); setCompletedScore(Number(result.systemScore)); } catch (error) { Alert.alert("Not complete", String(error)); } finally { setBusy(false); } }} disabled={busy || !data.runtimeState.reflection} /></View>}
  </ScrollView>;
}

function Feedback({ token, sessionId, draft, onDraftChange, onBack }: { token: string; sessionId: string; draft: FeedbackDraft; onDraftChange: (draft: FeedbackDraft) => void; onBack: () => void }) {
  const [form, setForm] = useState<any>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { fetch(`${API}/student/sessions/${sessionId}/feedback-form`, { headers: { Authorization: `Bearer ${token}` } }).then((response) => response.json().then((data) => { if (!response.ok) throw new Error(data.error?.message); setForm(data); })).catch((error) => Alert.alert("Feedback", String(error))); }, [sessionId, token]);
  if (!form) return <ScrollView contentContainerStyle={styles.page}><StudentHomeHeader onHome={onBack} /><View style={styles.center}><ActivityIndicator /></View></ScrollView>;
  if (form.submission) return <ScrollView contentContainerStyle={styles.page}><StudentHomeHeader onHome={onBack} /><View style={styles.heroCard}><Text style={styles.kicker}>FEEDBACK RECEIVED</Text><Text style={styles.title}>Thank you.</Text><Text style={styles.body}>Your response is saved with Feedback Form version {form.version}. It does not change any Mission score or Carbon Market IQ.</Text></View></ScrollView>;
  const submit = async () => {
    setBusy(true);
    try {
      const responses = buildFeedbackResponses(form.questions, draft);
      const response = await fetch(`${API}/student/sessions/${sessionId}/feedback`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ responses }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error?.message); setForm({ ...form, submission: result });
    } catch (error) { Alert.alert("Feedback", String(error)); } finally { setBusy(false); }
  };
  const complete = isFeedbackComplete(draft);
  return <ScrollView contentContainerStyle={styles.page}><StudentHomeHeader onHome={onBack} /><Text style={styles.kicker}>POST-WORKSHOP FEEDBACK · VERSION {form.version}</Text><Text style={styles.hero}>Help us improve the experience.</Text>{form.questions.map((question: any) => <View style={styles.card} key={question.id}><Text style={styles.cardTitle}>{question.prompt}</Text>{question.type === "SINGLE_CHOICE" ? <>{question.options.map((option: string) => <Pressable key={option} style={[styles.choice, draft.selected[question.stableId] === option && styles.choiceSelected]} onPress={() => onDraftChange({ ...draft, selected: { ...draft.selected, [question.stableId]: option } })}><Text>{option}</Text></Pressable>)}{question.stableId === "FB-Q02" && draft.selected[question.stableId] === "Other" && <TextInput style={styles.input} value={draft.other} onChangeText={(other) => onDraftChange({ ...draft, other })} placeholder="Please specify" />}</> : <TextInput multiline style={[styles.input, styles.multiline]} value={draft.suggestion} onChangeText={(suggestion) => onDraftChange({ ...draft, suggestion })} placeholder="Optional suggestion" />}</View>)}<FeedbackFooter busy={busy} complete={complete} onSubmit={submit} /></ScrollView>;
}

function History({ token, onBack }: { token: string; onBack: () => void }) {
  const [items, setItems] = useState<HistoryItem[]>([]); const [loadingHistory, setLoadingHistory] = useState(true); const [historyError, setHistoryError] = useState<string | null>(null);
  useEffect(() => { let mounted = true; fetch(`${API}/student/history`, { headers: { Authorization: `Bearer ${token}` } }).then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data?.error?.message ?? "History request failed"); if (mounted) setItems(normalizeHistoryPayload(data)); }).catch((error) => { if (mounted) setHistoryError(userFacingError(error)); }).finally(() => { if (mounted) setLoadingHistory(false); }); return () => { mounted = false; }; }, [token]);
  return <ScrollView contentContainerStyle={styles.page}><StudentHistory items={items} loading={loadingHistory} error={historyError} onHome={onBack} /></ScrollView>;
}

const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.canvas }, center: { flex: 1, alignItems: "center", justifyContent: "center" }, header: { padding: 16, borderBottomWidth: 1, borderColor: colors.border, backgroundColor: "white", flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, brand: { color: colors.forest, fontSize: 20, fontWeight: "900" }, subtitle: { color: colors.leaf, fontWeight: "700" }, link: { color: colors.navy }, page: { padding: 16, gap: 14, paddingBottom: 48 }, hero: { fontSize: 28, lineHeight: 36, fontWeight: "900", color: colors.navy, marginVertical: 24 }, heroCard: { backgroundColor: "#eaf6ec", borderRadius: 22, padding: 22, borderWidth: 1, borderColor: "#bfd9c4" }, card: { backgroundColor: "white", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border, gap: 12 }, title: { fontSize: 23, fontWeight: "800", color: colors.ink }, cardTitle: { fontSize: 17, fontWeight: "800", color: colors.ink }, section: { color: colors.navy, fontSize: 18, fontWeight: "800", marginTop: 8 }, kicker: { color: colors.forest, fontWeight: "900", fontSize: 12, letterSpacing: 1 }, body: { color: colors.muted, lineHeight: 21 }, input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, backgroundColor: "white" }, multiline: { minHeight: 120, textAlignVertical: "top" }, label: { fontWeight: "700", color: colors.ink }, readonly: { padding: 12, backgroundColor: "#eef3ef", borderRadius: 10 }, button: { backgroundColor: colors.forest, paddingHorizontal: 15, paddingVertical: 12, borderRadius: 10, alignItems: "center", justifyContent: "center" }, navy: { backgroundColor: colors.navy }, plain: { backgroundColor: "white", borderWidth: 1, borderColor: colors.border }, disabled: { opacity: 0.4 }, buttonText: { color: "white", fontWeight: "800" }, plainText: { color: colors.navy }, choice: { padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 10 }, choiceSelected: { backgroundColor: "#dff1e2", borderColor: colors.forest }, row: { flexDirection: "row", gap: 8 }, wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, grow: { flex: 1 }, missionCard: { flexDirection: "row", gap: 12, alignItems: "center", backgroundColor: "white", borderWidth: 1, borderColor: colors.border, padding: 14, borderRadius: 16 }, badge: { backgroundColor: colors.navy, borderRadius: 20, width: 42, height: 42, alignItems: "center", justifyContent: "center" }, badgeText: { color: "white", fontWeight: "900" }, state: { color: colors.muted, marginTop: 5, fontSize: 12, fontWeight: "700" }, available: { color: colors.forest }, success: { color: colors.forest, fontWeight: "800" }, feedback: { backgroundColor: "#fff8e8", padding: 10, borderRadius: 8, color: colors.ink }, progress: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: "hidden" }, progressFill: { height: 6, backgroundColor: colors.forest } });
