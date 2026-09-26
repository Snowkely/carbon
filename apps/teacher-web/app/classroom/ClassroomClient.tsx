"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { classroomUrls, type ClassroomUrls } from "./classroom-origin";

type Props = {
  androidUrl: string | null;
  androidVersion: string | null;
  iosUrl: string | null;
};

export function ClassroomClient({ androidUrl, androidVersion, iosUrl }: Props) {
  const [urls, setUrls] = useState<ClassroomUrls | null>(null);
  const [studentWebQr, setStudentWebQr] = useState<string | null>(null);
  const [connectionQr, setConnectionQr] = useState<string | null>(null);

  useEffect(() => {
    const current = classroomUrls(window.location.origin);
    setUrls(current);
    void Promise.all([
      QRCode.toDataURL(current.studentWeb, { errorCorrectionLevel: "M", margin: 2, width: 320 }),
      QRCode.toDataURL(current.connectionDeepLink, { errorCorrectionLevel: "M", margin: 2, width: 320 }),
    ]).then(([studentWeb, connection]) => {
      setStudentWebQr(studentWeb);
      setConnectionQr(connection);
    });
  }, []);

  if (!urls) return <main className="classroomPage"><p>Preparing classroom connection…</p></main>;

  return <main className="classroomPage">
    <section className="classroomHero"><p className="eyebrow">CARBON TRADER I</p><h1>Classroom Server</h1><p>Students can scan once and play in Safari or Chrome. The Android app remains available as an optional alternative.</p></section>
    <section className="classroomGrid">
      <article className="card stack classroomPrimary">
        <p className="stepBadge">1</p><h2>Student Web</h2>
        <p><strong>Open in Safari or Chrome</strong><br/><a className="breakable" href={urls.studentWeb}>{urls.studentWeb}</a></p>
        {studentWebQr && <img className="classroomQr" src={studentWebQr} alt={`Student Web QR code for ${urls.studentWeb}`} />}
        <p className="muted">Scan this one QR code. No app installation or server setup is required.</p>
      </article>
      <article className="card stack">
        <p className="stepBadge">A</p><h2>Android App download</h2>
        <p><strong>Teacher Web</strong><br/><a href={urls.teacherWeb}>{urls.teacherWeb}</a></p>
        {androidUrl ? <><a className="button installLink" href={androidUrl} download>Download Android App</a>{androidVersion && <p><strong>Version:</strong> {androidVersion}</p>}<p><strong>File:</strong> CarbonTrader.apk</p></> : <p className="notice">Android test build not configured.</p>}
        <h3>iOS</h3>{iosUrl ? <a className="button installLink" href={iosUrl}>Open TestFlight</a> : <p className="notice">iOS TestFlight link not configured.</p>}
      </article>
      <article className="card stack">
        <p className="stepBadge">B</p><h2>Android Connection QR</h2>
        <p><strong>Student API</strong><br/><code>{urls.api}</code></p>
        {connectionQr && <img className="classroomQr" src={connectionQr} alt={`Classroom connection QR code for ${urls.connectionDeepLink}`} />}
        <p className="muted">Only students using the optional Android app need this second QR after installation.</p>
        <details><summary>Manual connection link</summary><code className="breakable">{urls.connectionDeepLink}</code></details>
      </article>
    </section>
  </main>;
}
