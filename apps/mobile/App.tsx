import AsyncStorage from "@react-native-async-storage/async-storage";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, formatScore } from "@carbon/ui-tokens";
import { createUnauthorizedCoordinator, type MissionScoreBreakdownDto } from "@carbon/contracts";
import { MissionHeader } from "./MissionHeader";
import { MissionCardStatus } from "./MissionCardStatus";
import { QuestionCard, type MobileQuestion as Question } from "./QuestionCard";
import { ValueChainExplorer } from "./ValueChainExplorer";
import { backToHomeFromMission, missionNavigationKey, resolveMissionOpen, resumeMission, updateMissionScrollPosition } from "./mission-navigation";
import { allQuestionsResolved, clearQuestionEntry, commitValueChainDraft, formatQuestionRevealResult, formatQuestionSubmissionResult, setQuestionDraft, updateQuestionDraft, toggleValueChainNode, type QuestionRevealResult, type QuestionSubmissionResult } from "./mission-interactions";
import { isHandledUnauthorized, mobileApiRequest, type MobileApiResponseContract } from "./mobile-api";
import { MissionScoreBreakdown } from "./MissionScoreBreakdown";
import { FeedbackFooter, HomeRefreshControl, StudentHomeHeader } from "./StudentControls";
import { StudentHistory } from "./StudentHistory";
import { backToStudentHome, buildFeedbackResponses, emptyFeedbackDraft, fetchStudentHomeState, initializeStudentRuntime, isFeedbackComplete, normalizeHistoryPayload, screenAfterLogin, userFacingError, type FeedbackDraft, type HistoryItem, type StudentFinalResult, type StudentMission as Mission, type StudentScreen, type StudentSession as Session } from "./student-state";

const API = process.env.EXPO_PUBLIC_API_URL ?? "";
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

function showMobileError(title: string, error: unknown) { if (!isHandledUnauthorized(error)) Alert.alert(title, String(error)); }

export default function App() {
  const [token, setToken] = useState<string | null>(INITIAL_STUDENT_RUNTIME.token);
  const [screen, setScreen] = useState<StudentScreen>(INITIAL_STUDENT_RUNTIME.screen);
  const [session, setSession] = useState<Session | null>(null);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [finalResult, setFinalResult] = useState<StudentFinalResult | null>(null);
  const [missionAttemptId, setMissionAttemptId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [homeError, setHomeError] = useState<string | null>(null);
  const [feedbackDrafts, setFeedbackDrafts] = useState<Record<string, FeedbackDraft>>({});
  const unauthorized = useRef(createUnauthorizedCoordinator());
  const clearAuthenticatedState = useCallback(async () => {
    await AsyncStorage.removeItem("accessToken"); setToken(null); setSession(null); setMissions([]); setFinalResult(null); setMissionAttemptId(null); setScreen("login");
  }, []);
  const onUnauthorized = useCallback(() => {
    unauthorized.current.notify(
      (confirm) => Alert.alert("Session expired", "Your session has expired. Please sign in again.", [{ text: "OK", onPress: confirm }], { cancelable: false }),
      clearAuthenticatedState
    );
  }, [clearAuthenticatedState]);

  const request = (path: string, options: RequestInit = {}, responseContract?: MobileApiResponseContract) =>
    mobileApiRequest(API, path, { ...options, token: token ?? undefined, responseContract, onUnauthorized });
  const loadHome = async () => {
    setRefreshing(true); setHomeError(null);
    try {
      const next = await fetchStudentHomeState(request); setSession(next.session); setMissions(next.missions); setFinalResult(next.finalResult);
    } catch (error) { if (isHandledUnauthorized(error)) return; if (String(error).toLowerCase().includes("profile")) setScreen("profile"); else { const message = userFacingError(error); setHomeError(message); Alert.alert("Refresh failed", message); } }
    finally { setRefreshing(false); }
  };
  useEffect(() => { if (token && screen === "home") void loadHome(); }, [token, screen]);
  const logout = clearAuthenticatedState;
  return <SafeAreaView style={styles.safe}><StatusBar style="dark" />
    <View style={styles.header}><View><Text style={styles.brand}>CARBON TRADER I</Text><Text style={styles.subtitle}>Carbon Market Explorer</Text></View>{token && <Pressable onPress={logout}><Text style={styles.link}>Logout</Text></Pressable>}</View>
    {screen === "login" && <Login onLoggedIn={async (value, profileRequired) => { unauthorized.current.reset(); await AsyncStorage.setItem("accessToken", value); setToken(value); setScreen(screenAfterLogin(profileRequired)); }} />}
    {screen === "profile" && <Profile token={token!} onUnauthorized={onUnauthorized} onDone={() => setScreen("home")} />}
    {screen === "home" && <Home session={session} missions={missions} finalResult={finalResult} refreshing={refreshing} refreshError={homeError} onRefresh={loadHome} onOpen={async (mission) => { const action = resolveMissionOpen(mission); if (action.kind === "BLOCKED") { if (mission.accessState === "ACTIVE_ATTEMPT") Alert.alert("Continue", "The active attempt could not be resolved. Refresh and try again."); else if (mission.accessState === "AVAILABLE") Alert.alert("Mission unavailable", "This Mission's gameplay is not available yet."); return; } if (action.kind === "RESUME") { const target = resumeMission(action.missionAttemptId); setMissionAttemptId(target.missionAttemptId); setScreen(target.screen); return; } const attempt = await request(`/student/sessions/${session!.id}/missions/${mission.missionTemplateId}/attempts`, { method: "POST" }); setMissionAttemptId(attempt.id); setScreen("mission"); }} onResult={() => setScreen("result")} onHistory={() => setScreen("history")} onFeedback={() => setScreen("feedback")} />}
    {screen === "result" && finalResult && <ScrollView contentContainerStyle={styles.page}><StudentHomeHeader onHome={() => setScreen("home")} /><FinalResultView result={finalResult} onFeedback={() => setScreen("feedback")} /></ScrollView>}
    {screen === "mission" && missionAttemptId && <MissionPlayer token={token!} missionAttemptId={missionAttemptId} onUnauthorized={onUnauthorized} onBack={() => { const target = backToHomeFromMission(missionAttemptId); setMissionAttemptId(target.missionAttemptId); setScreen(target.screen); }} onDone={() => { setMissionAttemptId(null); setScreen("home"); }} onFeedback={() => setScreen("feedback")} />}
    {screen === "history" && <History token={token!} onUnauthorized={onUnauthorized} onBack={() => setScreen(backToStudentHome())} />}
    {screen === "feedback" && session && <Feedback token={token!} onUnauthorized={onUnauthorized} sessionId={session.id} draft={feedbackDrafts[session.id] ?? emptyFeedbackDraft()} onDraftChange={(draft) => setFeedbackDrafts((current) => ({ ...current, [session.id]: draft }))} onBack={() => setScreen(backToStudentHome())} />}
  </SafeAreaView>;
}

function Login({ onLoggedIn }: { onLoggedIn: (token: string, profileRequired: boolean) => void }) {
  const [username, setUsername] = useState("student.alex"); const [password, setPassword] = useState("Carbon123!"); const [busy, setBusy] = useState(false);
  const login = async () => { setBusy(true); try { const data = await mobileApiRequest(API, "/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }); onLoggedIn(data.accessToken, data.profileRequired); } catch (error) { Alert.alert("Login failed", String(error)); } finally { setBusy(false); } };
  return <ScrollView contentContainerStyle={styles.page}><Text style={styles.hero}>Learn the market. Change the future.</Text><View style={styles.card}><Text style={styles.title}>Student Login / 学生登录</Text><TextInput accessibilityLabel="Username" style={styles.input} value={username} onChangeText={setUsername} autoCapitalize="none" /><TextInput accessibilityLabel="Password" style={styles.input} value={password} onChangeText={setPassword} secureTextEntry /><Button title={busy ? "Signing in…" : "Enter Carbon Trader"} onPress={login} disabled={busy} /></View></ScrollView>;
}

function Profile({ token, onUnauthorized, onDone }: { token: string; onUnauthorized: () => void; onDone: () => void }) {
  const [refs, setRefs] = useState<any[]>([]); const [name, setName] = useState(""); const [studentId, setStudentId] = useState(""); const [classId, setClassId] = useState("");
  useEffect(() => { mobileApiRequest(API, "/reference/schools").then((data) => { setRefs(data); setClassId(data[0]?.classes[0]?.id ?? ""); }); }, []);
  const school = refs[0];
  const save = async () => { try { await mobileApiRequest(API, "/student/profile", { method: "PUT", token, onUnauthorized, body: JSON.stringify({ name, studentId, schoolId: school.id, classId }) }); onDone(); } catch (error) { showMobileError("Profile", error); } };
  return <ScrollView contentContainerStyle={styles.page}><View style={styles.card}><Text style={styles.kicker}>FIRST LOGIN</Text><Text style={styles.title}>Complete your profile</Text><Text style={styles.label}>School</Text><Text style={styles.readonly}>{school?.name ?? "Loading…"}</Text><Text style={styles.label}>Name</Text><TextInput style={styles.input} value={name} onChangeText={setName} /><Text style={styles.label}>Student ID</Text><TextInput style={styles.input} value={studentId} onChangeText={setStudentId} /><Text style={styles.label}>Class</Text>{school?.classes.map((item: any) => <Pressable key={item.id} onPress={() => setClassId(item.id)} style={[styles.choice, classId === item.id && styles.choiceSelected]}><Text>{item.name}</Text></Pressable>)}<Button title="Save profile" onPress={save} disabled={!name.trim() || !studentId.trim() || !classId} /></View></ScrollView>;
}

function Home({ session, missions, finalResult, refreshing, refreshError, onRefresh, onOpen, onResult, onHistory, onFeedback }: { session: Session | null; missions: Mission[]; finalResult: StudentFinalResult | null; refreshing: boolean; refreshError: string | null; onRefresh: () => void; onOpen: (m: Mission) => void; onResult: () => void; onHistory: () => void; onFeedback: () => void }) {
  return <ScrollView contentContainerStyle={styles.page}><View style={styles.heroCard}><Text style={styles.kicker}>CURRENT WORKSHOP</Text><Text style={styles.title}>{session?.workshopName ?? "Waiting for an active class"}</Text><Text style={styles.body}>{session ? "Your teacher controls Mission access." : "Your active Workshop will appear automatically — no code or QR required."}</Text></View>
    {finalResult && <View style={styles.heroCard}><Text style={styles.kicker}>CARBON TRADER I · LEVEL COMPLETE</Text><Text style={styles.hero}>{formatScore(finalResult.effectiveScore)} / 100.00</Text><Text style={styles.title}>{finalResult.level}</Text><Button title="View Final Carbon Market IQ" onPress={onResult} /></View>}
    <View style={styles.row}><View style={styles.grow}><HomeRefreshControl refreshing={refreshing} error={refreshError} onRefresh={onRefresh} /></View><Button title="History" tone="plain" onPress={onHistory} />{session && <Button title="Feedback" tone="plain" onPress={onFeedback} />}</View>
    <Text style={styles.section}>Learning journey / 学习旅程</Text>{missions.map((mission) => <View key={mission.missionTemplateId} style={styles.missionCard}><View style={styles.badge}><Text style={styles.badgeText}>{mission.missionStableId}</Text></View><View style={styles.grow}><Text style={styles.cardTitle}>{mission.titleEn}</Text><Text style={styles.body}>{mission.titleCn}</Text></View><MissionCardStatus mission={mission} onOpen={onOpen} /></View>)}</ScrollView>;
}

export function FinalResultView({ result, onFeedback }: { result: StudentFinalResult; onFeedback: () => void }) {
  const rounds = result.m6RoundBreakdown;
  return <View style={styles.heroCard}><Text style={styles.kicker}>CARBON TRADER I — LEVEL COMPLETE</Text><Text style={styles.title}>Final Carbon Market IQ</Text><Text style={styles.hero}>{formatScore(result.effectiveScore)} / 100.00</Text><Text style={styles.cardTitle}>{result.level}</Text>{["M1", "M2", "M3", "M4", "M5", "M6"].map((id) => <View key={id} accessibilityLabel={`${id} ${formatScore(result.missionScores[id] ?? 0)} out of 100`}><Text style={styles.body}>{id}  {formatScore(result.missionScores[id] ?? 0)} / 100.00</Text><View style={styles.progress}><View style={[styles.progressFill, { width: `${Math.max(0, Math.min(100, result.missionScores[id] ?? 0))}%` }]} /></View></View>)}<Text style={styles.section}>Mission 6 round breakdown</Text><Text style={styles.body}>Round 1 Policy Shock  {formatScore(rounds.round1)} / 50.00</Text><Text style={styles.body}>Round 2 Technology Shock  {formatScore(rounds.round2)} / 25.00</Text><Text style={styles.body}>Round 3 Integrated  {formatScore(rounds.round3)} / 25.00</Text><Text style={styles.cardTitle}>M6 Total  {formatScore(rounds.total)} / 100.00</Text><Text style={styles.body}>Top Strength: {result.topStrength}</Text><Text style={styles.body}>Concept to Review: {result.conceptToReview}</Text><Text style={styles.body}>Level II gameplay is not enabled.</Text><Button title="Share workshop feedback" onPress={onFeedback} /></View>;
}

function MissionPlayer({ token, missionAttemptId, onUnauthorized, onBack, onDone, onFeedback }: { token: string; missionAttemptId: string; onUnauthorized: () => void; onBack: () => void; onDone: () => void; onFeedback: () => void }) {
  const [data, setData] = useState<any>(null); const [step, setStep] = useState(0); const [busy, setBusy] = useState(false); const [reflection, setReflection] = useState(""); const [completedScore, setCompletedScore] = useState<number | null>(null); const [completedBreakdown, setCompletedBreakdown] = useState<MissionScoreBreakdownDto | null>(null); const [completedFinalResult, setCompletedFinalResult] = useState<StudentFinalResult | null>(null);
  const [valueChainDraft, setValueChainDraft] = useState<string[]>([]); const [valueChainDraftReady, setValueChainDraftReady] = useState(false); const [valueChainBusy, setValueChainBusy] = useState(false);
  const [questionDrafts, setQuestionDrafts] = useState<Record<string, unknown>>({}); const [questionMessages, setQuestionMessages] = useState<Record<string, string>>({}); const [questionBusy, setQuestionBusy] = useState<Record<string, boolean>>({}); const [strategyPreviews, setStrategyPreviews] = useState<Record<string, unknown>>({});
  const [localQuestionResults, setLocalQuestionResults] = useState<Record<string, { score: number; resolutionMode: "INDEPENDENT" | "REVEALED" | "STRATEGY" }>>({});
  const reflectionDraftKey = `missionAttempt:${missionAttemptId}:reflectionDraft`;
  const scrollRef = useRef<ScrollView>(null); const previousNavigationKey = useRef<string | null>(null);
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  const refresh = () => mobileApiRequest(API, `/student/mission-attempts/${missionAttemptId}`, { headers, onUnauthorized }).then(setData);
  useEffect(() => { void refresh(); }, []);
  useEffect(() => { let mounted = true; void AsyncStorage.getItem(reflectionDraftKey).then((value) => { if (mounted && value !== null) setReflection(value); }); return () => { mounted = false; }; }, [reflectionDraftKey]);
  useEffect(() => { const savedReflection = data?.runtimeState?.reflection; if (typeof savedReflection === "string") setReflection((current) => current || savedReflection); }, [data?.runtimeState?.reflection]);
  useEffect(() => { if (data && !valueChainDraftReady) { setValueChainDraft(Array.isArray(data.runtimeState?.viewedNodes) ? data.runtimeState.viewedNodes : []); setValueChainDraftReady(true); } }, [data, valueChainDraftReady]);
  useEffect(() => { const stableId = data?.currentScreen?.stableId; const index = (data?.screens ?? []).findIndex((item: any) => item.stableId === stableId); if (index >= 0) setStep(index); }, [data?.currentScreen?.stableId, data?.screens]);
  const navigationKey = missionNavigationKey(missionAttemptId, data?.screens?.[step]?.stableId, data?.runtimeState?.currentQuestionStableId);
  useEffect(() => { previousNavigationKey.current = updateMissionScrollPosition(previousNavigationKey.current, navigationKey, () => scrollRef.current?.scrollTo({ y: 0, animated: true })); }, [navigationKey]);
  if (!data) return <View style={styles.center}><ActivityIndicator /></View>;
  const screens = data.screens as Array<{ id: string; stableId: string; sequenceNo: number; displayConfig: { titleEn?: string; titleCn?: string; body?: string; isSimulation?: boolean } }>;
  const screenDefinition = screens[step]!;
  const screen = screenDefinition.stableId;
  const missionId = String(data.mission.stableId);
  const screenQuestions = data.questions.filter((q: Question) => q.screenTemplateId === screenDefinition.id);
  const post = (path: string, body?: unknown) => mobileApiRequest(API, path, { method: "POST", headers, onUnauthorized, body: body === undefined ? undefined : JSON.stringify(body) });
  const next = async () => { const target = Math.min(screens.length - 1, step + 1); await post(`/student/mission-attempts/${missionAttemptId}/screens/${screens[target]!.stableId}`); setStep(target); await refresh(); };
  const chooseQuestionAnswer = (question: Question, answer: unknown) => {
    setQuestionDrafts((current) => setQuestionDraft(current, question.questionTemplateId, question.answerMode === "STRATEGY" || question.type === "REFLECTION" ? answer : updateQuestionDraft(question.type, current[question.questionTemplateId], answer)));
    if (question.answerMode === "STRATEGY") {
      setStrategyPreviews((current) => clearQuestionEntry(current, question.questionTemplateId));
      setQuestionMessages((current) => clearQuestionEntry(current, question.questionTemplateId));
    }
  };
  const reviewStrategyDecision = async (question: Question) => {
    const answer = questionDrafts[question.questionTemplateId];
    if (!answer) return;
    if (question.stableId !== "M5-Q03") {
      setStrategyPreviews((current) => ({ ...current, [question.questionTemplateId]: { selection: answer } }));
      setQuestionMessages((current) => ({ ...current, [question.questionTemplateId]: "Strategy reviewed. Submit Decision to create scored evidence." }));
      return;
    }
    setQuestionBusy((current) => ({ ...current, [question.questionTemplateId]: true }));
    try {
      const result = await post(`/student/mission-attempts/${missionAttemptId}/m5/preview`, { answer });
      setStrategyPreviews((current) => ({ ...current, [question.questionTemplateId]: result.projection }));
      setQuestionMessages((current) => ({ ...current, [question.questionTemplateId]: "Projected state reviewed. Submit Decision to create scored evidence." }));
    } catch (error) { if (!isHandledUnauthorized(error)) setQuestionMessages((current) => ({ ...current, [question.questionTemplateId]: String(error) })); }
    finally { setQuestionBusy((current) => ({ ...current, [question.questionTemplateId]: false })); }
  };
  const submitQuestionAnswer = async (question: Question) => {
    const answer = questionDrafts[question.questionTemplateId] ?? (question.type === "ORDER" && Array.isArray(question.options) ? question.options : undefined); if (answer === undefined || question.finalized) return;
    setQuestionBusy((current) => ({ ...current, [question.questionTemplateId]: true }));
    try {
      const result = await post(`/student/mission-attempts/${missionAttemptId}/questions/${question.questionTemplateId}/submissions`, { clientSubmissionId: submissionId(), answer, timeSpentMs: 1000 }) as QuestionSubmissionResult;
      setQuestionMessages((current) => ({ ...current, [question.questionTemplateId]: formatQuestionSubmissionResult(result, question.baseScore, { answerMode: question.answerMode, questionType: question.type }) }));
      setQuestionDrafts((current) => setQuestionDraft(current, question.questionTemplateId, undefined));
      setStrategyPreviews((current) => clearQuestionEntry(current, question.questionTemplateId));
      if (result.finalized) setLocalQuestionResults((current) => ({ ...current, [question.questionTemplateId]: { score: result.score, resolutionMode: question.answerMode === "STRATEGY" ? "STRATEGY" : "INDEPENDENT" } }));
      await refresh();
    } catch (error) { if (!isHandledUnauthorized(error)) setQuestionMessages((current) => ({ ...current, [question.questionTemplateId]: String(error) })); }
    finally { setQuestionBusy((current) => ({ ...current, [question.questionTemplateId]: false })); }
  };
  const requestQuestionHint = async (question: Question) => {
    setQuestionBusy((current) => ({ ...current, [question.questionTemplateId]: true }));
    try { const result = await post(`/student/mission-attempts/${missionAttemptId}/questions/${question.questionTemplateId}/hint`); setQuestionMessages((current) => ({ ...current, [question.questionTemplateId]: result.hint })); await refresh(); }
    catch (error) { if (!isHandledUnauthorized(error)) setQuestionMessages((current) => ({ ...current, [question.questionTemplateId]: String(error) })); }
    finally { setQuestionBusy((current) => ({ ...current, [question.questionTemplateId]: false })); }
  };
  const revealQuestionAnswer = async (question: Question) => {
    setQuestionBusy((current) => ({ ...current, [question.questionTemplateId]: true }));
    try { const result = await post(`/student/mission-attempts/${missionAttemptId}/questions/${question.questionTemplateId}/reveal`) as QuestionRevealResult; setQuestionMessages((current) => ({ ...current, [question.questionTemplateId]: formatQuestionRevealResult(result, question.baseScore) })); setQuestionDrafts((current) => setQuestionDraft(current, question.questionTemplateId, undefined)); setLocalQuestionResults((current) => ({ ...current, [question.questionTemplateId]: { score: result.score, resolutionMode: "REVEALED" } })); await refresh(); }
    catch (error) { if (!isHandledUnauthorized(error)) setQuestionMessages((current) => ({ ...current, [question.questionTemplateId]: String(error) })); }
    finally { setQuestionBusy((current) => ({ ...current, [question.questionTemplateId]: false })); }
  };
  const confirmValueChain = async () => {
    setValueChainBusy(true);
    try {
      const persistedNodes = Array.isArray(data.runtimeState?.viewedNodes) ? data.runtimeState.viewedNodes : [];
      await commitValueChainDraft(valueChainDraft, persistedNodes, (nodeId) => post(`/student/mission-attempts/${missionAttemptId}/value-chain/nodes`, { nodeId }));
      await next();
    } catch (error) { showMobileError("Value Chain Map", error); }
    finally { setValueChainBusy(false); }
  };
  const displayedQuestions = screenQuestions.map((question: Question) => {
    const localResult = localQuestionResults[question.questionTemplateId];
    return localResult ? { ...question, finalized: true, score: localResult.score, resolutionMode: localResult.resolutionMode } : question;
  });
  const firstTradeResolved = data.questions.some((question: Question) => question.stableId === "M4-Q05" && question.finalized);
  if (completedFinalResult) return <ScrollView contentContainerStyle={styles.page}><FinalResultView result={completedFinalResult} onFeedback={onFeedback} /><Button title="Return to Mission Map" tone="plain" onPress={onDone} /></ScrollView>;
  if (completedScore !== null) return <ScrollView contentContainerStyle={styles.page}><View style={styles.heroCard}><Text style={styles.kicker}>{missionId} COMPLETE</Text><Text style={styles.hero}>{formatScore(completedScore)} / 100.00</Text><Text style={styles.title}>{data.mission.titleEn}</Text><Text style={styles.body}>Your result is saved. The next Mission still requires an explicit Teacher unlock.</Text></View>{completedBreakdown && <MissionScoreBreakdown breakdown={completedBreakdown} />}<Button title="Share workshop feedback" onPress={onFeedback} /><Button title="Return to Mission Map" tone="plain" onPress={onDone} /></ScrollView>;
  const isFirst = step === 0;
  const isLast = step === screens.length - 1;
  const isM1Special = missionId === "M1";
  return <ScrollView ref={scrollRef} contentContainerStyle={styles.page}><MissionHeader onBack={onBack} missionId={missionId} step={step + 1} totalSteps={screens.length} /><View style={styles.progress}><View style={[styles.progressFill, { width: `${((step + 1) / screens.length) * 100}%` }]} /></View>
    {!isM1Special && <View style={styles.card}><Text style={styles.kicker}>{missionId} · {screenDefinition.displayConfig.titleEn}</Text><Text style={styles.title}>{screenDefinition.displayConfig.titleEn}</Text><Text style={styles.body}>{screenDefinition.displayConfig.body}</Text>{screenDefinition.displayConfig.isSimulation && <Text style={styles.simulation}>Training simulation</Text>}{isFirst && displayedQuestions.length === 0 && <Button title="Start Mission" onPress={() => void next()} />}</View>}
    {screen === "M1-S01" && <View style={styles.card}><Text style={styles.title}>Boundary Detective</Text><Text style={styles.body}>Map GreenThread’s emissions and classify Scope 1, 2 and 3. The reporting boundary — not just location — decides the answer.</Text><Button title="Start Mission" onPress={() => void next()} /></View>}
    {screen === "M1-S02" && <ValueChainExplorer nodes={VALUE_CHAIN_NODES} selectedNodes={valueChainDraft} busy={valueChainBusy} onToggle={(nodeId) => setValueChainDraft((current) => toggleValueChainNode(current, nodeId))} onContinue={() => void confirmValueChain()} />}
    {screen === "M4-S02" && data.ets && <View style={styles.heroCard}><Text style={styles.kicker}>TRAINING SIMULATION · CAP & ALLOCATION</Text><Text style={styles.cardTitle}>Total cap  {formatScore(data.ets.cap)}</Text>{data.ets.companies.map((company: any) => <Text key={company.id} style={styles.body}>{company.id}  {formatScore(company.allocation)} allowances</Text>)}</View>}
    {screen === "M4-S03" && data.ets && <View style={styles.heroCard}><Text style={styles.kicker}>TRAINING SIMULATION · VERIFIED EMISSIONS</Text>{data.ets.companies.map((company: any) => <Text key={company.id} style={styles.body}>{company.id}  {formatScore(company.verifiedEmissions)} tCO2e</Text>)}</View>}
    {screen === "M4-S04" && data.ets && <View style={styles.heroCard}><Text style={styles.kicker}>TRAINING SIMULATION · POSITION INPUTS</Text>{data.ets.companies.map((company: any) => <Text key={company.id} style={styles.body}>{company.id}  Allowances {formatScore(company.allocation)} · Verified emissions {formatScore(company.verifiedEmissions)}</Text>)}</View>}
    {screen === "M4-S05" && data.ets && <View style={styles.heroCard}><Text style={styles.kicker}>SERVER-AUTHORITATIVE TRADE POSITION</Text>{data.ets.companies.map((company: any) => <Text key={company.id} style={styles.body}>{company.id}  Surplus {formatScore(company.surplus)} · Shortage {formatScore(company.shortage)}</Text>)}</View>}
    {screen === "M4-S06" && data.ets && <View style={styles.heroCard}><Text style={styles.kicker}>ENGINE-DERIVED COMPLIANCE</Text>{data.ets.companies.map((company: any) => <Text key={company.id} style={styles.body}>{company.id}  Final allowances {formatScore(company.finalAllowances)} · Gap {formatScore(company.complianceGap)} · {company.status}</Text>)}</View>}
    {screen === "M5-S01" && data.m5 && <View style={styles.heroCard}><Text style={styles.kicker}>TRAINING SIMULATION · STARTING POSITION</Text><Text style={styles.body}>Verified emissions  {formatScore(data.m5.scenario.verifiedEmissions)} tCO2e</Text><Text style={styles.body}>Allowances  {formatScore(data.m5.scenario.allowances)}</Text><Text style={styles.body}>Market price  €{formatScore(data.m5.scenario.marketPrice)} / t</Text></View>}
    {screen === "M5-S02" && data.m5 && <View style={styles.heroCard}><Text style={styles.kicker}>TRAINING SIMULATION · PROJECT DATA</Text>{data.m5.scenario.projects.map((project: any) => <View key={project.id}><Text style={styles.cardTitle}>{project.name}</Text><Text style={styles.body}>Capacity {formatScore(project.capacity)} t · MAC €{formatScore(project.marginalAbatementCost)} / t</Text></View>)}</View>}
    {screen === "M5-S03" && data.m5 && <View style={styles.heroCard}><Text style={styles.kicker}>SERVER-AUTHORITATIVE STRATEGY STATE</Text><Text style={styles.body}>Initial shortage  {formatScore(data.m5.scenario.verifiedEmissions - data.m5.scenario.allowances)} tCO2e</Text><Text style={styles.body}>Selected reduction capacity  {formatScore(data.m5.scenario.projects.filter((project: any) => data.m5.selectedProjectIds.includes(project.id)).reduce((sum: number, project: any) => sum + project.capacity, 0))} tCO2e</Text>{data.m5.projection && <Text style={styles.body}>Committed: {data.m5.projection.action} {formatScore(data.m5.projection.quantity)} · {data.m5.projection.status}</Text>}</View>}
    {screen === "M5-S04" && data.m5?.rubricBreakdown && <View style={styles.heroCard}><Text style={styles.kicker}>AUTHORITATIVE MISSION RUBRIC</Text><Text style={styles.body}>Compliance  {formatScore(data.m5.rubricBreakdown.compliance)} / 40.00</Text><Text style={styles.body}>Cost Logic  {formatScore(data.m5.rubricBreakdown.costLogic)} / 30.00</Text><Text style={styles.body}>Position  {formatScore(data.m5.rubricBreakdown.position)} / 20.00</Text><Text style={styles.body}>Reasoning  {formatScore(data.m5.rubricBreakdown.reasoning)} / 10.00</Text><Text style={styles.cardTitle}>Total  {formatScore(data.m5.rubricBreakdown.total)} / 100.00</Text></View>}
    {screen === "M6-S03" && data.m6 && <View style={styles.heroCard}><Text style={styles.kicker}>TRAINING SIMULATION · MARGINAL COMPARISON</Text><Text style={styles.body}>MAC  €{formatScore(data.m6.scenario.mac)} / tCO2e</Text><Text style={styles.body}>EUA  €{formatScore(data.m6.scenario.allowancePrice)} / tCO2e</Text><Text style={styles.cardTitle}>€{formatScore(data.m6.scenario.marginalAdvantage)} / tCO2e marginal advantage for internal abatement</Text></View>}
    {screen === "M6-S03" && data.m6?.roundBreakdown && <View style={styles.heroCard}><Text style={styles.kicker}>MISSION 6 ROUND SCORE</Text><Text style={styles.body}>Round 1 Policy Shock  {formatScore(data.m6.roundBreakdown.round1)} / 50.00</Text><Text style={styles.body}>Round 2 Technology Shock  {formatScore(data.m6.roundBreakdown.round2)} / 25.00</Text><Text style={styles.body}>Round 3 Integrated  {formatScore(data.m6.roundBreakdown.round3)} / 25.00</Text></View>}
    {displayedQuestions.map((question: Question) => <QuestionCard key={question.questionTemplateId} question={question} draftAnswer={questionDrafts[question.questionTemplateId] ?? question.selectedAnswer ?? (question.type === "ORDER" && Array.isArray(question.options) ? question.options : undefined)} strategyPreview={strategyPreviews[question.questionTemplateId]} busy={questionBusy[question.questionTemplateId]} disabled={question.stableId === "M4-Q06" && !firstTradeResolved} message={questionMessages[question.questionTemplateId]} onSelect={(answer) => chooseQuestionAnswer(question, answer)} onReview={() => void reviewStrategyDecision(question)} onSubmit={() => void submitQuestionAnswer(question)} onHint={() => void requestQuestionHint(question)} onReveal={() => void revealQuestionAnswer(question)} />)}
    {["M1-S03", "M1-S04", "M1-S05", "M1-S06"].includes(screen) && <Button title="Continue" onPress={() => void next()} disabled={!allQuestionsResolved(displayedQuestions)} />}
    {!isM1Special && screen === "M2-S05" && allQuestionsResolved(displayedQuestions) && data.footprint && <View style={styles.heroCard}><Text style={styles.kicker}>ENGINE-DERIVED FOOTPRINT</Text><Text style={styles.body}>Scope 1  {formatScore(data.footprint.scope1)} tCO2e</Text><Text style={styles.body}>Scope 2  {formatScore(data.footprint.scope2)} tCO2e</Text><Text style={styles.body}>Scope 3  {formatScore(data.footprint.scope3)} tCO2e</Text><Text style={styles.cardTitle}>Total  {formatScore(data.footprint.total)} tCO2e</Text></View>}
    {!isM1Special && !isLast && (!isFirst || displayedQuestions.length > 0) && <Button title="Continue" onPress={() => void next()} disabled={!allQuestionsResolved(displayedQuestions)} />}
    {!isM1Special && isLast && <Button title={busy ? "Calculating…" : `Complete ${missionId}`} onPress={async () => { setBusy(true); try { const result = await post(`/student/mission-attempts/${missionAttemptId}/complete`); setCompletedScore(Number(result.systemScore)); setCompletedBreakdown(result.scoreBreakdown ?? null); if (result.finalResult) setCompletedFinalResult(result.finalResult); } catch (error) { showMobileError("Not complete", error); } finally { setBusy(false); } }} disabled={busy || !allQuestionsResolved(displayedQuestions)} />}
    {screen === "M1-S07" && <View style={styles.card}><Text style={styles.title}>Reality Check & Reflection</Text><Text style={styles.body}>Why can the same physical emission be Scope 1 for one company and Scope 3 for another?</Text><TextInput multiline style={[styles.input, styles.multiline]} value={reflection} onChangeText={(value) => { setReflection(value); void AsyncStorage.setItem(reflectionDraftKey, value); }} placeholder="Write your reflection…" /><Button title="Submit reflection" onPress={async () => { try { await post(`/student/mission-attempts/${missionAttemptId}/reflection`, { response: reflection }); await refresh(); Alert.alert("Reflection saved", "Completion evidence recorded — semantic quality is not AI graded."); } catch (error) { showMobileError("Reflection", error); } }} disabled={!reflection.trim()} /><Button title={busy ? "Calculating…" : "Complete Mission 1"} onPress={async () => { setBusy(true); try { const result = await post(`/student/mission-attempts/${missionAttemptId}/complete`); await AsyncStorage.removeItem(reflectionDraftKey); setCompletedScore(Number(result.systemScore)); setCompletedBreakdown(result.scoreBreakdown ?? null); } catch (error) { showMobileError("Not complete", error); } finally { setBusy(false); } }} disabled={busy || !data.runtimeState.reflection} /></View>}
  </ScrollView>;
}

function Feedback({ token, onUnauthorized, sessionId, draft, onDraftChange, onBack }: { token: string; onUnauthorized: () => void; sessionId: string; draft: FeedbackDraft; onDraftChange: (draft: FeedbackDraft) => void; onBack: () => void }) {
  const [form, setForm] = useState<any>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { mobileApiRequest(API, `/student/sessions/${sessionId}/feedback-form`, { token, onUnauthorized }).then(setForm).catch((error) => showMobileError("Feedback", error)); }, [sessionId, token, onUnauthorized]);
  if (!form) return <ScrollView contentContainerStyle={styles.page}><StudentHomeHeader onHome={onBack} /><View style={styles.center}><ActivityIndicator /></View></ScrollView>;
  if (form.submission) return <ScrollView contentContainerStyle={styles.page}><StudentHomeHeader onHome={onBack} /><View style={styles.heroCard}><Text style={styles.kicker}>FEEDBACK RECEIVED</Text><Text style={styles.title}>Thank you.</Text><Text style={styles.body}>Your response is saved with Feedback Form version {form.version}. It does not change any Mission score or Carbon Market IQ.</Text></View></ScrollView>;
  const submit = async () => {
    setBusy(true);
    try {
      const responses = buildFeedbackResponses(form.questions, draft);
      const result = await mobileApiRequest(API, `/student/sessions/${sessionId}/feedback`, { method: "POST", token, onUnauthorized, body: JSON.stringify({ responses }) }); setForm({ ...form, submission: result });
    } catch (error) { showMobileError("Feedback", error); } finally { setBusy(false); }
  };
  const complete = isFeedbackComplete(draft);
  return <ScrollView contentContainerStyle={styles.page}><StudentHomeHeader onHome={onBack} /><Text style={styles.kicker}>POST-WORKSHOP FEEDBACK · VERSION {form.version}</Text><Text style={styles.hero}>Help us improve the experience.</Text>{form.questions.map((question: any) => <View style={styles.card} key={question.id}><Text style={styles.cardTitle}>{question.prompt}</Text>{question.type === "SINGLE_CHOICE" ? <>{question.options.map((option: string) => <Pressable key={option} style={[styles.choice, draft.selected[question.stableId] === option && styles.choiceSelected]} onPress={() => onDraftChange({ ...draft, selected: { ...draft.selected, [question.stableId]: option } })}><Text>{option}</Text></Pressable>)}{question.stableId === "FB-Q02" && draft.selected[question.stableId] === "Other" && <TextInput style={styles.input} value={draft.other} onChangeText={(other) => onDraftChange({ ...draft, other })} placeholder="Please specify" />}</> : <TextInput multiline style={[styles.input, styles.multiline]} value={draft.suggestion} onChangeText={(suggestion) => onDraftChange({ ...draft, suggestion })} placeholder="Optional suggestion" />}</View>)}<FeedbackFooter busy={busy} complete={complete} onSubmit={submit} /></ScrollView>;
}

function History({ token, onUnauthorized, onBack }: { token: string; onUnauthorized: () => void; onBack: () => void }) {
  const [items, setItems] = useState<HistoryItem[]>([]); const [loadingHistory, setLoadingHistory] = useState(true); const [historyError, setHistoryError] = useState<string | null>(null);
  useEffect(() => { let mounted = true; mobileApiRequest(API, "/student/history", { token, onUnauthorized }).then((data) => { if (mounted) setItems(normalizeHistoryPayload(data)); }).catch((error) => { if (mounted && !isHandledUnauthorized(error)) setHistoryError(userFacingError(error)); }).finally(() => { if (mounted) setLoadingHistory(false); }); return () => { mounted = false; }; }, [token, onUnauthorized]);
  return <ScrollView contentContainerStyle={styles.page}><StudentHistory items={items} loading={loadingHistory} error={historyError} onHome={onBack} /></ScrollView>;
}

const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.canvas }, center: { flex: 1, alignItems: "center", justifyContent: "center" }, header: { padding: 16, borderBottomWidth: 1, borderColor: colors.border, backgroundColor: "white", flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, brand: { color: colors.forest, fontSize: 20, fontWeight: "900" }, subtitle: { color: colors.leaf, fontWeight: "700" }, link: { color: colors.navy }, page: { padding: 16, gap: 14, paddingBottom: 48 }, hero: { fontSize: 28, lineHeight: 36, fontWeight: "900", color: colors.navy, marginVertical: 24 }, heroCard: { backgroundColor: "#eaf6ec", borderRadius: 22, padding: 22, borderWidth: 1, borderColor: "#bfd9c4" }, card: { backgroundColor: "white", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border, gap: 12 }, title: { fontSize: 23, fontWeight: "800", color: colors.ink }, cardTitle: { fontSize: 17, fontWeight: "800", color: colors.ink }, section: { color: colors.navy, fontSize: 18, fontWeight: "800", marginTop: 8 }, kicker: { color: colors.forest, fontWeight: "900", fontSize: 12, letterSpacing: 1 }, body: { color: colors.muted, lineHeight: 21 }, simulation: { alignSelf: "flex-start", color: "#805b12", backgroundColor: "#fff3d6", borderColor: "#d6a744", borderWidth: 1, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5, fontWeight: "800" }, input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, backgroundColor: "white" }, multiline: { minHeight: 120, textAlignVertical: "top" }, label: { fontWeight: "700", color: colors.ink }, readonly: { padding: 12, backgroundColor: "#eef3ef", borderRadius: 10 }, button: { backgroundColor: colors.forest, paddingHorizontal: 15, paddingVertical: 12, borderRadius: 10, alignItems: "center", justifyContent: "center" }, navy: { backgroundColor: colors.navy }, plain: { backgroundColor: "white", borderWidth: 1, borderColor: colors.border }, disabled: { opacity: 0.4 }, buttonText: { color: "white", fontWeight: "800" }, plainText: { color: colors.navy }, choice: { padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 10 }, choiceSelected: { backgroundColor: "#dff1e2", borderColor: colors.forest }, row: { flexDirection: "row", gap: 8 }, wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, grow: { flex: 1 }, missionCard: { flexDirection: "row", gap: 12, alignItems: "center", backgroundColor: "white", borderWidth: 1, borderColor: colors.border, padding: 14, borderRadius: 16 }, badge: { backgroundColor: colors.navy, borderRadius: 20, width: 42, height: 42, alignItems: "center", justifyContent: "center" }, badgeText: { color: "white", fontWeight: "900" }, state: { color: colors.muted, marginTop: 5, fontSize: 12, fontWeight: "700" }, available: { color: colors.forest }, success: { color: colors.forest, fontWeight: "800" }, feedback: { backgroundColor: "#fff8e8", padding: 10, borderRadius: 8, color: colors.ink }, progress: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: "hidden" }, progressFill: { height: 6, backgroundColor: colors.forest } });
