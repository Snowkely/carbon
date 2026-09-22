import { ClassroomClient } from "./ClassroomClient";

// Installation links are supplied by the classroom launcher at container runtime.
export const dynamic = "force-dynamic";

const publicInstallUrl = (value: string | undefined) => {
  const candidate = value?.trim();
  if (!candidate) return null;
  if (candidate.startsWith("/downloads/")) return candidate;
  try {
    const url = new URL(candidate);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
};

export default async function ClassroomPage() {
  const android = publicInstallUrl(process.env.ANDROID_APP_INSTALL_URL);
  const ios = publicInstallUrl(process.env.IOS_APP_INSTALL_URL);
  const androidVersion = android ? process.env.ANDROID_APP_VERSION?.trim() || null : null;
  return <ClassroomClient androidUrl={android} androidVersion={androidVersion} iosUrl={ios} />;
}
