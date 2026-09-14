# Container deployment and rehearsal

This runbook covers the production-like container layout added in Hardening C. It is not authorization to deploy externally. Mobile remains an Expo application outside Docker.

## Architecture

The only published service is the unprivileged Nginx reverse proxy. It routes `/v1/*`, `/health`, and `/ready` to NestJS and all other paths to the standalone Next.js Teacher Web server. API, Teacher Web, PostgreSQL, and Redis use Compose networks; PostgreSQL and Redis have no host port mappings. Swagger remains available in local development but `/docs` is intentionally not routed by the production proxy. Decide whether to expose authenticated documentation before a real release.

The API and Teacher Web images use Node 22 Alpine, deterministic pnpm workspace installs, multi-stage builds, non-root runtime users, read-only filesystems, dropped Linux capabilities, and no source bind mounts. The migration job reuses the API image and runs exactly once with `prisma migrate deploy`; API startup waits for successful migration completion.

`NEXT_PUBLIC_API_URL` is embedded in the browser bundle during `next build`. Set it to the final public reverse-proxy URL before building the Teacher Web image. Rebuilding is required when that public URL changes. The Dockerfile enables `NEXT_OUTPUT_STANDALONE=true`; ordinary Windows workspace builds leave it unset to avoid unsupported local pnpm symlink creation.

## Local isolated rehearsal

Use the dedicated production Compose file, a unique project name, a unique ingress port, and an ignored environment file. Never point `DATABASE_URL` at the development database and never reuse `carbon_carbon_postgres`.

```powershell
Copy-Item deploy/.env.example deploy/.env.rehearsal
# Edit deploy/.env.rehearsal: generate unique strong database/JWT secrets.
# Keep COMPOSE_PROJECT_NAME=carbon-trader-rehearsal and use a free local INGRESS_PORT.

$ComposeArgs = @(
  "--env-file", "deploy/.env.rehearsal",
  "-p", "carbon-trader-rehearsal",
  "-f", "docker-compose.production.yml"
)
docker compose @ComposeArgs config --services
docker compose @ComposeArgs build
docker compose @ComposeArgs up -d postgres redis
```

Before restoring, verify the exact mounts. Expected rehearsal volumes are `carbon-trader-rehearsal_postgres_data` and `carbon-trader-rehearsal_redis_data`; the development volume is `carbon_carbon_postgres` and must remain untouched.

```powershell
docker volume inspect carbon-trader-rehearsal_postgres_data
docker volume inspect carbon-trader-rehearsal_redis_data
docker volume inspect carbon_carbon_postgres
```

Restore the sensitive Hardening B dump only into the newly initialized rehearsal database:

```powershell
$Backup = (Resolve-Path "backups/carbon-trader-hardening-b-20260912-restore-rehearsal.dump").Path
docker compose @ComposeArgs cp $Backup postgres:/tmp/rehearsal.dump
docker compose @ComposeArgs exec -T postgres sh -c 'pg_restore --exit-on-error --no-owner --no-privileges --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" /tmp/rehearsal.dump'
docker compose @ComposeArgs exec -T postgres rm -f /tmp/rehearsal.dump
docker compose @ComposeArgs run --rm migrate
docker compose @ComposeArgs up -d
docker compose @ComposeArgs ps
```

Do not print `docker compose config` after inserting real secrets into the environment file in shared logs or CI output: Compose expands runtime values. The committed example contains placeholders only.

Check through the proxy, not container-published application ports:

```powershell
Invoke-RestMethod http://localhost:8088/proxy-health
Invoke-RestMethod http://localhost:8088/health
Invoke-RestMethod http://localhost:8088/ready
Invoke-WebRequest http://localhost:8088/
```

Perform teacher and student login/read smoke tests without printing access or refresh tokens. Verify Teacher dashboard, Workshop/Session/student/history/Gradebook reads and Student profile, active/history, and Mission-state reads. Do not replay M1-M6.

## Restart and persistence rehearsal

Restart one service at a time, waiting for health after each, then stop and restart the whole project without deleting volumes:

```powershell
docker compose @ComposeArgs restart api teacher-web redis postgres
docker compose @ComposeArgs ps
docker compose @ComposeArgs stop
docker compose @ComposeArgs start
docker compose @ComposeArgs ps
```

Re-run readiness, authentication/read checks, migration status, and key row counts. Never use `docker compose down -v`. A normal `down` preserves named volumes, but prefer `stop` during rehearsal to make intent explicit.

## Safe failure checks

- Stop PostgreSQL, call `/ready` through the proxy or directly from the edge network, confirm a non-ready/controlled upstream response, restart PostgreSQL, and wait for recovery.
- Stop Redis, confirm readiness becomes unhealthy because `REDIS_URL` is configured, restart Redis, and wait for recovery.
- Stop API and confirm Nginx returns the controlled 502/503/504 page without internal details; restart it and verify recovery.
- Test migration failure with a one-off migration container using an intentionally unreachable temporary `DATABASE_URL`. Do not alter schema or data to force failure. A non-zero migration result must prevent normal API startup sequencing.

## Ingress and TLS

The rehearsal listens on loopback HTTP only. Nginx applies 30 login/refresh requests per minute per IP with a burst of 60, 20 Teacher requests per second with a burst of 80, and 100 general API requests per second with a burst of 200. The general allowance accommodates a classroom submitting concurrently. These are IP-based safeguards, not identity-aware application controls; reassess using real traffic and add account-aware login controls before public exposure.

The real deployment should terminate HTTPS at Nginx or a managed ingress, then use internal HTTP to application containers. Add the real hostname, managed certificate, HTTP-to-HTTPS redirect, and HSTS only after HTTPS is active. The rehearsal includes `nosniff`, same-origin referrer policy, and same-origin frame protection; it intentionally omits HSTS and an untested restrictive CSP.

## Real production sequence

1. Provision and harden the host; install supported Docker Engine and Compose.
2. Configure DNS when the real hostname is approved.
3. Store database and JWT secrets outside Git with least-privilege access.
4. Set `NEXT_PUBLIC_API_URL` and build/pull immutable versioned images.
5. Create and verify a PostgreSQL backup.
6. Start isolated PostgreSQL/Redis or connect approved managed services.
7. Run the one-shot `prisma migrate deploy` job and require exit code zero.
8. Start API and require `/health` and `/ready` success.
9. Start Teacher Web, then the reverse proxy.
10. Configure certificate, HTTPS redirect, TLS policy, and HSTS.
11. Run authenticated Teacher and Student read smoke tests.
12. Enable traffic and monitor readiness, 5xx/429 rates, database capacity, and storage.

For Mobile, supply `EXPO_PUBLIC_API_URL=https://<real-domain>/v1` to the Expo/EAS production build environment. It is public configuration, not a secret. LAN values remain suitable only for local Expo development; application logic has no fixed `192.168.1.103` dependency.

## Backup, rollback, and resources

Use scheduled `pg_dump` and/or provider-native backups, encryption at rest and in transit, storage outside the application host, access controls, documented retention/rotation, and periodic restore rehearsals. Never upload the existing rehearsal dump to an unapproved destination.

Size CPU/memory from observed production traffic. Initial planning guidance is at least 512 MiB each for API and Teacher Web during startup, with database memory and storage sized separately; do not impose smaller Compose limits without load testing.

Rollback means disabling traffic to the new application, restoring the previous immutable images, and assessing forward/backward database compatibility. Never blindly reverse or drop migrations. Restore a verified backup only when the compatibility assessment requires it.
