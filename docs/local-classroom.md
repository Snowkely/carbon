# Carbon Trader I local classroom

This package is for internal classroom testing on one trusted LAN/Wi-Fi. The classroom computer runs Nginx, Teacher Web, API, PostgreSQL, and Redis in Docker. Only TCP port 8088 is published; databases and application containers remain private inside Docker.

## Windows

1. Install and start Docker Desktop.
2. Unzip the Carbon Trader classroom ZIP into a normal writable folder.
3. Double-click `CarbonTrader-Start.cmd`.
4. Select the classroom LAN address if prompted.
5. On a fresh installation, enter the first OWNER username, display name, and password. Password input is hidden and is never written to the runtime environment file.
6. Wait until every service reports Healthy. The Teacher Web opens automatically.
7. Open `http://<classroom-ip>:8088/classroom`. Students scan the prominent **Student Web** QR once to open `http://<classroom-ip>:8088/student` in Safari or Chrome.

If phones cannot connect, allow inbound TCP 8088 for **Private networks only** in Windows Firewall. Do not disable the firewall and do not expose PostgreSQL or Redis ports.

## macOS

1. Install and start Docker Desktop.
2. Unzip the classroom package.
3. Open `CarbonTrader-Start.command` and wait for Healthy status.
4. If Gatekeeper blocks the unsigned internal script, Control-click it, choose **Open**, and confirm. Do not disable Gatekeeper globally. If archive extraction removed executable permission, run `chmod +x CarbonTrader-*.command deploy/local-classroom/*.sh` once from Terminal.
5. Show students the Classroom page and Student Web QR.

The macOS launcher uses standard macOS shell tools and Docker Desktop; Homebrew, Node.js, pnpm, Prisma, PostgreSQL, and Redis are not required.

## Start, stop, status, and logs

- `CarbonTrader-Stop`: stops containers only. It never deletes volumes or classroom data.
- `CarbonTrader-Status`: shows containers and health/readiness.
- `CarbonTrader-Logs`: follows safe container logs. Passwords and JWT secrets are not printed by the launchers.
- Starting again reuses the dedicated `carbon-trader-classroom` named volumes. Users, Workshops, Sessions, attempts, adjustments, feedback, content, and migrations survive restart and reboot.

If the computer LAN IP changes, Start detects it again and updates only local CORS/address state. Teacher Web uses the same-origin `/v1` API and does not require rebuilding.

## Student Web and optional app installation

Student Web is the default classroom path. It is a production Expo Web export served by Docker at `/student`; student devices need only a current browser. The page derives its API URL from the browser origin, so the same ZIP works on arbitrary LAN addresses and ports without rebuilding. Student login survives ordinary page refreshes, while logout or an invalid refresh session clears the stored browser session.

The Android application remains an optional alternative. Its saved-server, optional environment fallback, and unconfigured-state behavior is unchanged.

The Student App supports a saved classroom server independently of its default build URL. Scan the classroom QR with the normal device camera. The app displays the exact URL and changes it only after confirmation and a successful `/health` check. Changing or resetting the server clears authentication so a token from Server A is never sent to Server B. A manual **Server** screen is available when QR linking is unavailable.

Classroom HTTP is accepted only for loopback/development or RFC1918 private IPv4 addresses. HTTPS remains supported for production URLs. `file:`, `javascript:`, `data:`, credentials, malformed paths, queries, and fragments are rejected.

### Build and distribute the Android classroom APK

The Android application is a standalone internal build; it does not require Expo Go, Metro, or Node.js on student or classroom computers. From a developer computer:

```powershell
cd apps/mobile
npx eas init
npx eas build --platform android --profile classroom
```

`eas init` is required once because this source tree is not yet linked to an EAS project. It adds the Expo project ID after the developer selects the correct Expo account/project. Do not invent or copy another project's ID. The `classroom` profile produces an APK; the production profile retains the Google Play/store default.

After downloading the completed EAS artifact, return to the repository root and import it:

```powershell
pnpm classroom:set-apk -- C:\path\to\downloaded-build.apk
```

This validates and copies it to `deploy/local-classroom/downloads/CarbonTrader.apk` and reports its SHA-256. Restart the classroom stack. The file is then available read-only at `/downloads/CarbonTrader.apk` with Android's APK content type. APK files remain ignored by Git.

To create the normal source-only classroom ZIP:

```powershell
pnpm classroom:package
```

To deliberately create a separate Android ZIP with one supplied APK:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-classroom.ps1 -IncludeApk C:\path\to\downloaded-build.apk
```

The Android ZIP is named `CarbonTrader-LocalClassroom-<version>-android.zip`. The packager never silently includes an APK already present in the working directory.

On the classroom page, **Student Web QR** opens the complete browser experience. **Android App download** installs the optional APK, and **Android Connection QR** opens `carbontrader://connect?...` in that installed app. Android may ask the student to allow **Install unknown apps** for the browser or download manager. Do not bypass this warning; approve only the trusted classroom APK and turn the permission off again if required by school policy.

The classroom/preview EAS profiles enable LAN cleartext only for internal builds so addresses such as `http://192.168.1.103:8088/v1` work after explicit confirmation. The production profile does not inherit this relaxation. The APK contains no fixed classroom-computer IP and remains reusable at another school/LAN.

For iOS, configure `IOS_APP_INSTALL_URL` in the ignored `deploy/.env.classroom` with an approved TestFlight URL. Arbitrary unsigned IPA installation is not supported, and Apple credentials are never stored in this package. The iOS classroom build includes a local-network usage message and local-network ATS allowance; production keeps normal HTTPS assumptions.

The installation link/QR installs the application. The classroom QR selects the current classroom server; students may need both steps.

## Backup and restore

Use `CarbonTrader-Backup` to run `pg_dump` inside PostgreSQL. It creates a custom-format `.dump`, prints its path and SHA-256, and does not require host database tools. Treat it as sensitive student/teacher data and store it securely.

Use `CarbonTrader-Restore` with a classroom backup. Restore always displays a warning and requires typing `RESTORE CLASSROOM`. It targets only the dedicated classroom database, recreates that database after confirmation, verifies migrations, and restarts services. It never touches another Compose project or deletes Docker volumes.

## Building a transferable ZIP

On the development computer run `pnpm classroom:package`. The package contains Docker build contexts, workspace lockfiles, Prisma schema/migrations, launchers, classroom Compose/Nginx configuration, safe templates, and documentation. It excludes Git metadata, dependencies, caches, populated environment files, dumps, logs, private keys, signing assets, credentials, and app binaries. The script scans the staging directory and ZIP before reporting success.

Do not place `deploy/.env.classroom`, backups, student data, signing certificates, or TestFlight credentials in a transfer package.
