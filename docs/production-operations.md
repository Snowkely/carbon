# Production operations

This document is an operator checklist, not an automated deployment. API and Teacher Web containerization is intentionally deferred to Hardening C.

## Runtime configuration

Keep production values in the deployment platform's secret/config store. Do not create or commit a production `.env` file.

| Variable | Visibility | Production status | Purpose |
|---|---|---|---|
| `NODE_ENV` | Server/build | Required value: `production` | Enables strict production validation. |
| `DATABASE_URL` | Server secret | Required | PostgreSQL connection used by Prisma and migration commands. |
| `JWT_ACCESS_SECRET` | Server secret | Required, 32+ characters | HS256 access-token signing. |
| `JWT_REFRESH_SECRET` | Server secret | Required, 32+ characters and different | HS256 refresh-token signing. |
| `CORS_ALLOWED_ORIGINS` | Server config | Required | Comma-separated Teacher Web HTTP(S) origins, without paths. Wildcards are rejected. |
| `REDIS_URL` | Server secret | Optional | Optional export worker/readiness integration. Core gameplay does not require Redis. |
| `ACCESS_TOKEN_TTL` | Server config | Optional (`15m`) | Access-token lifetime. |
| `REFRESH_TOKEN_TTL_DAYS` | Server config | Optional (`7`) | Refresh-session lifetime in days. |
| `PORT` | Server config | Optional (`3001`) | API listener port. |
| `PRESENCE_OFFLINE_SECONDS` | Server config | Optional (`30`) | Teacher presence threshold. |
| `HEALTH_TIMEOUT_MS` | Server config | Optional (`1500`) | Database/Redis readiness probe timeout. |
| `NEXT_PUBLIC_API_URL` | Public build config | Required for production Teacher Web build | Public API URL ending in `/v1`. Never place secrets here. |
| `EXPO_PUBLIC_API_URL` | Public build config | Required for Mobile builds | Public API URL ending in `/v1`. Never place secrets here. |

Local development may use localhost or a private LAN address explicitly. When local JWT secrets are omitted, the API generates process-local random secrets, so tokens expire when that development process restarts. Production has no default JWT secrets, database URL, CORS origin, or Teacher API URL. The checked-in seed is development-only and refuses to run when `NODE_ENV=production`.

## Controlled release order

1. Create and verify a PostgreSQL backup.
2. Deploy the immutable application artifact, but do not route traffic yet.
3. Run `prisma migrate deploy` with the production `DATABASE_URL`. Never run `prisma migrate dev` in production.
4. Start the compiled API and check `/health` and `/ready`.
5. Start the built Teacher Web artifact and perform an authenticated read smoke test.
6. Route traffic only after readiness succeeds.

Migration failure must stop the release. Application boot does not run migrations automatically.

## PostgreSQL backup

Use PostgreSQL client tools matching or newer than the server. In PowerShell, with `DATABASE_URL` supplied securely by the operator:

```powershell
$BackupPath = Join-Path (Resolve-Path .) "backups/carbon-trader-$(Get-Date -Format yyyyMMdd-HHmmss).dump"
New-Item -ItemType Directory -Force (Split-Path $BackupPath) | Out-Null
if (Test-Path -LiteralPath $BackupPath) { throw "Refusing to overwrite an existing backup" }
pg_dump --format=custom --file=$BackupPath --dbname=$env:DATABASE_URL
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed" }
```

The custom-format dump includes application schemas/data and `_prisma_migrations`. Protect the artifact as sensitive data and apply retention/encryption controls appropriate to student records.

## Restore rehearsal

Always restore into a newly created, explicitly named database. `RESTORE_DATABASE_URL` must not equal `DATABASE_URL`.

```powershell
if (-not $env:RESTORE_DATABASE_URL) { throw "RESTORE_DATABASE_URL is required" }
if ($env:RESTORE_DATABASE_URL -eq $env:DATABASE_URL) { throw "Refusing to restore over the source database" }
createdb --maintenance-db=$env:DATABASE_URL carbon_trader_restore_rehearsal
pg_restore --exit-on-error --no-owner --no-privileges --dbname=$env:RESTORE_DATABASE_URL $BackupPath
if ($LASTEXITCODE -ne 0) { throw "pg_restore failed" }
```

Verify `_prisma_migrations`, published content, Workshops, Sessions, Attempts, MissionAttempts, QuestionAttempts, score-adjustment streams/history, and Feedback. Run `prisma migrate status` and an authenticated read against an API instance pointed only at the restored database. Drop the rehearsal database only after verification; never delete the backup as part of the restore procedure.

For the supplied local Docker Compose environment, PostgreSQL persists in the named `carbon_postgres` volume mounted at `/var/lib/postgresql/data` inside the database container. Never use `docker compose down -v` for routine shutdown, backup, migration, or deployment.

## Health and diagnostics

- `GET /health` is process liveness and returns no dependency or secret details.
- `GET /ready` checks PostgreSQL and, when configured, Redis. Optional Redis is reported as `disabled`.
- A non-ready dependency returns HTTP 503 with only `ok`, `unavailable`, or `disabled` states.
- Unexpected API failures are logged server-side with method/path and redacted diagnostics; clients receive a generic 500 response.

## Abuse-protection recommendation

The application currently relies on authentication, authorization, bounded validation, transactional conflict checks, and classroom workflow controls; it has no endpoint rate limiter. Before public internet exposure, configure conservative rate limits at the ingress/WAF for login and teacher mutations. Use per-account/IP login limits and generous authenticated submission bursts so a classroom submitting simultaneously is not blocked. Reassess before adding framework-level throttling.
