import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors } from "@carbon/ui-tokens";

function AuthButton({ label, onPress, disabled = false, secondary = false }: { label: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.button, secondary && styles.secondaryButton, disabled && styles.disabled]}><Text style={[styles.buttonText, secondary && styles.secondaryButtonText]}>{label}</Text></Pressable>;
}

function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return <View style={styles.card}><Text style={styles.title}>{title}</Text>{children}</View>;
}

export function StudentLoginView({ username, password, busy, onUsernameChange, onPasswordChange, onSubmit, onCreateAccount }: {
  username: string; password: string; busy: boolean; onUsernameChange: (value: string) => void; onPasswordChange: (value: string) => void; onSubmit: () => void; onCreateAccount: () => void;
}) {
  return <AuthShell title="Student Login"><Text style={styles.label}>Username</Text><TextInput accessibilityLabel="Username" autoCapitalize="none" autoCorrect={false} textContentType="username" returnKeyType="next" style={styles.input} value={username} onChangeText={onUsernameChange} /><Text style={styles.label}>Password</Text><TextInput accessibilityLabel="Password" autoCapitalize="none" textContentType="password" secureTextEntry returnKeyType="done" onSubmitEditing={onSubmit} style={styles.input} value={password} onChangeText={onPasswordChange} /><AuthButton label={busy ? "Signing in…" : "Sign in"} onPress={onSubmit} disabled={busy} /><Text style={styles.prompt}>New student?</Text><AuthButton label="Create student account" onPress={onCreateAccount} disabled={busy} secondary /></AuthShell>;
}

export function StudentRegistrationView({ username, password, confirmPassword, busy, error, onUsernameChange, onPasswordChange, onConfirmPasswordChange, onSubmit, onSignIn }: {
  username: string; password: string; confirmPassword: string; busy: boolean; error: string | null; onUsernameChange: (value: string) => void; onPasswordChange: (value: string) => void; onConfirmPasswordChange: (value: string) => void; onSubmit: () => void; onSignIn: () => void;
}) {
  return <AuthShell title="Create Student Account"><Text style={styles.label}>Username</Text><TextInput accessibilityLabel="Registration username" autoCapitalize="none" autoCorrect={false} textContentType="username" returnKeyType="next" style={styles.input} value={username} onChangeText={onUsernameChange} /><Text style={styles.label}>Password</Text><TextInput accessibilityLabel="Registration password" autoCapitalize="none" textContentType="newPassword" secureTextEntry returnKeyType="next" style={styles.input} value={password} onChangeText={onPasswordChange} /><Text style={styles.label}>Confirm password</Text><TextInput accessibilityLabel="Confirm password" autoCapitalize="none" textContentType="newPassword" secureTextEntry returnKeyType="done" onSubmitEditing={onSubmit} style={styles.input} value={confirmPassword} onChangeText={onConfirmPasswordChange} />{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}<AuthButton label={busy ? "Creating account…" : "Create account"} onPress={onSubmit} disabled={busy} /><Text style={styles.prompt}>Already have an account?</Text><AuthButton label="Sign in" onPress={onSignIn} disabled={busy} secondary /></AuthShell>;
}

const styles = StyleSheet.create({ card: { backgroundColor: "white", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border, gap: 10 }, title: { fontSize: 23, fontWeight: "800", color: colors.ink, marginBottom: 2 }, label: { fontWeight: "700", color: colors.ink }, input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, backgroundColor: "white" }, button: { minHeight: 48, backgroundColor: colors.forest, paddingHorizontal: 15, paddingVertical: 12, borderRadius: 10, alignItems: "center", justifyContent: "center" }, secondaryButton: { backgroundColor: "white", borderWidth: 1, borderColor: colors.border }, disabled: { opacity: 0.4 }, buttonText: { color: "white", fontWeight: "800" }, secondaryButtonText: { color: colors.navy }, prompt: { color: colors.muted, textAlign: "center", marginTop: 4 }, error: { color: "#9b2c2c", backgroundColor: "#fff0f0", borderRadius: 8, padding: 10 } });
