# Carbon Trader I — Phase 1

Phase 1 is a real, database-backed vertical slice of the Carbon Trader learning platform. A teacher creates a Workshop, starts an audience-controlled Session, and receives an audited M1 INITIAL unlock. Students discover that Session automatically, complete Mission 1 with server-authoritative evaluation and scoring, submit versioned experience Feedback, and wait for a teacher to unlock the Mission 2 availability placeholder.

Mission 2–6 gameplay is intentionally not present.

## Repository structure

```text
apps/
  api/             NestJS REST API, Prisma schema/migration/seed, Swagger
  mobile/          Expo React Native student application
  teacher-web/     Next.js teacher console
  worker/          Optional BullMQ worker; core gameplay does not depend on Redis
packages/
  contracts/       Shared Zod request schemas and DTO types
  content-schema/  Versioned question/scoring content schemas
  game-rules/      Pure evaluators and frozen M1 scoring rules
  ui-tokens/       Shared visual tokens
```

## Prerequisites

- Node.js 22 or newer
- Corepack and pnpm 10
- PostgreSQL 16 with permission to install the `citext` extension
- Redis 7 is optional for Phase 1 core gameplay
- Docker Desktop is the simplest way to run PostgreSQL and Redis locally
- Expo Go or an Android/iOS simulator for native mobile testing

## Install and configure

From the repository root:

```powershell
corepack enable
pnpm install
Copy-Item .env.example .env
```

Replace both JWT secrets in `.env` for any environment beyond an isolated local demo. Do not use the example secrets in production.

The mobile app defaults to `http://localhost:3001/v1`. For a physical phone, change `EXPO_PUBLIC_API_URL` in `.env` to the development computer's LAN address, for example `http://192.168.1.20:3001/v1`.

## PostgreSQL and Redis

Start the supplied services:

```powershell
docker compose up -d postgres redis
```

Redis is optional. If `REDIS_URL` is absent or Redis is unavailable, authentication, gameplay, scoring, grading, polling, and database-backed CSV export continue to work. The worker stays idle.

Apply the checked-in migration and seed the versioned content:

```powershell
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

The three migrations include PostgreSQL features Prisma cannot express directly: partial unique Session-audience indexes, same-stream composite adjustment foreign keys, selected-submission ownership, MissionUnlock validation, immutable QuestionAttempt/ScoreAdjustment/Feedback evidence, and same-form Feedback response constraints.

## Run

Run all applications together:

```powershell
pnpm dev
```

Or run each process in its own terminal:

```powershell
pnpm dev:api
pnpm dev:web
pnpm dev:mobile
pnpm dev:worker
```

- Teacher console: `http://localhost:3000`
- API: `http://localhost:3001/v1`
- Swagger UI: `http://localhost:3001/docs`
- Expo: follow the QR/simulator instructions printed by Expo

## Local seed accounts

These credentials are development data only:

| Account | Username | Password | Profile |
|---|---|---|---|
| Teacher | `teacher.demo` | `Carbon123!` | Demo Teacher |
| Student | `student.alex` | `Carbon123!` | Alex Chen / Class A |
| Student | `student.ben` | `Carbon123!` | Ben Lee / Class A |

To demonstrate first-login Profile Setup, register a STUDENT through `POST /v1/auth/register`, then use the mobile app to select a backend-managed School and Class.

## Verify

```powershell
pnpm typecheck
pnpm test
pnpm build
```

Production configuration, health/readiness, migration ordering, and PostgreSQL backup/restore procedures are documented in [`docs/production-operations.md`](docs/production-operations.md).

The automated suite covers pure scoring/evaluation behavior, the final 15/15/15/15/20/20 IQ configuration, Option B availability, inactive-Session mutation blocking, answer secrecy, submission idempotency, versioned retry/Hint/Reveal rules, low-score completion, teacher authorization and transactions, ScoreAdjustment supersede concurrency/bounds, Feedback validation/version isolation, and SQL-enforced structural invariants. Database integration requires applying the migrations to PostgreSQL; the unit and structural suites do not require Redis.

## Manual Phase 1 demo

1. Open the teacher console and sign in as `teacher.demo`.
2. In **Workshops**, create a Workshop for Class A using the published `v5.0-phase1-final` content. OWNER controls can rename the Workshop, assign teachers/roles, or archive it when no Session is active.
3. In **Session Control**, create and start Session 1. Start atomically freezes the audience, checks ACTIVE audience conflicts, activates the Session, and creates the M1 INITIAL unlock.
4. Open the Expo student app and sign in as `student.alex`.
5. Refresh Home. The active Session is discovered without a code or QR, and M1 is AVAILABLE.
6. Start M1. Inspect four value-chain nodes, resolve Q01 and the Round A/B Scope cards, resolve the three boundary questions, and submit a non-empty reflection.
7. Open the single **Hint** on any question to verify that the Question retry score remains unchanged while the Mission assistance bonus changes from 8 to 6. To verify Reveal, answer one question incorrectly three times, then use Reveal. Its QuestionResult receives 50% of the snapshotted v5 base score and the Mission assistance bonus becomes zero.
8. Complete M1. The app displays the immutable system result and returns to the Mission Map with M1 COMPLETED and M2 waiting for teacher unlock.
9. In the teacher console, open **Live Monitor**, **Students**, and **Gradebook**. Review the selected result and all append-only submissions.
10. Apply a Question or Mission adjustment with an audit reason. A later adjustment must explicitly supersede the currently effective adjustment.
11. Export CSV. It contains both system and effective scores.
12. In **Mission Control**, unlock M2. Alex now sees M2 AVAILABLE with gameplay marked deferred. A student who has not completed M1 still sees `PREREQUISITE_NOT_COMPLETED`.
13. From the Mission Complete screen, submit all four experience Feedback questions. Q2 is single-choice; choosing **Other** requires non-whitespace detail. Feedback never changes gameplay or scores.
14. In Teacher Web, open **Feedback** to review response counts, option distributions, Q2 Other responses, and Q4 suggestions. VIEWER access is denied.
15. End the Session. Historical IN_PROGRESS/COMPLETED states remain visible, but every gameplay mutation returns `409 SESSION_INACTIVE`.

## Phase 1 scope and deferred work

Implemented: Student/Teacher login, controlled student profile, Workshop/Session lifecycle and OWNER management, conflict-safe audience activation, M1 unlock/availability/gameplay/scoring/completion, M2 Option B availability, append-only evidence and adjustments, versioned Feedback with Student/Teacher UI, live polling monitor, read-only Question Bank, and CSV export. Scoring policies are content-versioned; M1 uses one Hint (assistance 8/6/0), and the final IQ weights are stored as 15/15/15/15/20/20. M6's future internal 50/25/25 round weights are stored without inventing its deferred gameplay mappings.

Explicitly deferred: M2–M6 gameplay, Online Chat, a content authoring/publishing UI, completed Carbon Market IQ (the frozen six-Mission configuration is seeded but missing scores are never fabricated), XLSX/PDF export, certificates, advanced analytics/privacy workflows, offline gameplay, and production object-storage/retention processing.

Because M2–M6 scores do not exist in Phase 1, no `Attempt.systemTotalScore` is fabricated. The `FINAL_TOTAL` adjustment path and bounds are implemented for a real completed IQ target, but Phase 1 cannot create such a target without violating the frozen “do not fake missing scores” rule.
