# BUILD_README — Team Access Control API

> **This file is the single source of truth for the AI agent (Antigravity) building this project.**
> Read it fully before writing any code. Follow it in order. Do not change the stack, scope, or schedule.

---

## 0. Mission

Build a **production-style, IAM-style SaaS backend**: users sign up, create an organization, invite teammates, assign roles, manage permissions, revoke sessions, upload files, run background jobs, and every sensitive action lands in an audit log.

It is a **resume project**, so the goals are: *clean, working, tested, documented, deployed.*

### The 7 Backend Responsibilities (NEVER skip any)

| # | Responsibility | Where it is delivered |
|---|---|---|
| 1 | Auth and refresh tokens | Days 2–3, 6 |
| 2 | RBAC and scoped access | Days 3–5, 12 |
| 3 | Database design and transactions | Days 2, 3, 4, 5 |
| 4 | File upload and storage safety | Days 8–9 |
| 5 | Queues, workers, retries | Days 10–11 |
| 6 | Rate limiting and validation | Days 2 onward, 6, 12 |
| 7 | API docs and tests | Every day (docs + tests in every commit), 13 |

Each day's section ends with a **"Responsibility check"**. If it cannot be ticked, the day is not done.

---

## 1. Locked Decisions (DO NOT CHANGE)

Changing any of these mid-project is the main cause of broken builds. They are final.

| Area | Decision |
|---|---|
| Runtime | Node.js **22 LTS**, TypeScript (strict mode), CommonJS output |
| Framework | **Express 5** (async errors propagate automatically) |
| Database | PostgreSQL 16 |
| ORM | **Prisma 6.x** (pin the exact version; do NOT upgrade to a newer major during this project) |
| Cache / limits / queues | Redis 7 |
| Queue | **BullMQ** (+ `ioredis`) |
| Validation | **Zod 3.x** (pin; check peer deps of the OpenAPI lib before installing) |
| API docs | `@asteasolutions/zod-to-openapi` (version compatible with Zod 3) + `swagger-ui-express`, served at `/docs` |
| Password hashing | **Argon2id** via the `argon2` package |
| Tokens | Access JWT (HS256, 15 min) + opaque refresh token (7 days, rotated) |
| Rate limiting | `rate-limiter-flexible` with Redis store |
| File storage | S3-compatible API via `@aws-sdk/client-s3` everywhere. **MinIO** locally, **Cloudflare R2** in production |
| Upload parsing | `multer` (memory storage with hard size limit) + `file-type` for magic-byte checks |
| Email | `nodemailer` over SMTP. **Mailpit** locally. Any SMTP provider in prod (configured by env) |
| Logging | `pino` + `pino-http` |
| Security headers | `helmet`, `cors` (allowlist) |
| Tests | **Jest + ts-jest + Supertest** |
| Lint/format | ESLint (flat config) + Prettier |
| CI | GitHub Actions (Postgres + Redis service containers) |
| Containers | Docker + docker-compose for local dev |
| Deployment | **Railway** (web service + worker service + Postgres + Redis). Fallback: Render. Verify current free-tier/trial limits before Day 7 |
| Package manager | npm (commit `package-lock.json`) |
| Base image | `node:22-slim` (NOT alpine — `argon2` and Prisma break more often there) |

---

## 2. Working Rules for the Agent

1. **One day at a time.** Only do the tasks listed under the current day. Never pull work forward.
2. **Exactly the listed commits** (2 per day, 3–4 on Days 1–3). Each commit must be **atomic and green**: `npm run lint`, `npm run build`, and `npm test` all pass before committing.
3. **Conventional Commits** format: `type(scope): message` — types: `feat, fix, chore, test, docs, refactor, ci, build`.
4. **Branch per day**: `day-01-foundation`, `day-02-auth-core`, … Merge to `main` at the end of the day using **rebase-and-merge** (keeps every commit visible in history). Never force-push `main`.
5. **Docs and tests ride with the code.** Any new endpoint is registered in OpenAPI and has tests **in the same commit**.
6. **Never commit secrets.** `.env` is git-ignored; `.env.example` is always up to date.
7. **Never fake or backdate commits.** Real work, real timestamps. (Recruiters read commit history; honesty matters.)
8. **No new dependencies** outside the Locked Decisions without a written reason in `docs/DECISIONS.md`.
9. **If blocked**: do not switch the stack. Write the problem in `docs/BLOCKERS.md`, apply the fallback from §11 (Known Pitfalls), and continue.
10. At the end of each day, update the **Progress Log** (§13) and verify the Definition of Done (§12).

---

## 3. Domain Model (Prisma schema — create fully on Day 2)

All IDs are `uuid` (use `@default(uuid())`). All tables have `createdAt`, and `updatedAt` where mutable.

| Model | Key fields | Notes |
|---|---|---|
| `User` | `email` (unique, lowercased), `passwordHash`, `name`, `isActive`, `failedLoginCount`, `lockedUntil` | |
| `Organization` | `name`, `slug` (unique), `createdById` | |
| `Membership` | `userId`, `orgId`, `roleId`, `status` | `@@unique([userId, orgId])` |
| `Role` | `orgId`, `name`, `priority` (int), `isSystem` | `@@unique([orgId, name])`. Higher priority = more power |
| `Permission` | `key` (unique, e.g. `member:invite`), `description` | Global catalog, seeded |
| `RolePermission` | `roleId`, `permissionId` | composite PK |
| `Invitation` | `orgId`, `email`, `roleId`, `tokenHash`, `expiresAt`, `acceptedAt`, `revokedAt`, `invitedById` | Token stored hashed |
| `Session` | `userId`, `familyId`, `refreshTokenHash` (unique), `expiresAt`, `revokedAt`, `replacedById`, `userAgent`, `ip`, `lastUsedAt` | One row per refresh token in a rotation chain |
| `AuditLog` | `orgId?`, `actorId?`, `action`, `targetType`, `targetId`, `metadata` (Json), `ip`, `createdAt` | Append-only. Index `(orgId, createdAt desc)` |
| `File` | `orgId`, `uploadedById`, `storageKey` (unique), `originalName`, `mimeType`, `sizeBytes`, `sha256`, `status` (`PENDING_SCAN`/`CLEAN`/`INFECTED`/`FAILED`), `deletedAt` | Soft delete |

Add indexes for every foreign key and every column used in filters.

### Permission catalog (seed on Day 2, extend only as listed)

```
org:update
member:read    member:invite    member:remove    member:role.update
role:read      role:manage
session:revoke
audit:read
file:upload    file:read:own    file:read:any    file:delete:own    file:delete:any
```

### System roles (created per organization inside the org-creation transaction)

| Role (priority) | Permissions |
|---|---|
| **owner (100)** | all |
| **admin (80)** | all except `role:manage`, `org:update` |
| **member (50)** | `member:read`, `role:read`, `file:upload`, `file:read:own`, `file:delete:own` |
| **viewer (10)** | `member:read`, `role:read`, `file:read:own` |

### Scoped-access rules (this is the heart of Responsibility #2)

1. **Org scope:** every permission is checked against the caller's membership **in the org from the URL**. Non-members get **404** (not 403) so org existence isn't leaked.
2. **Resource scope:** `:own` vs `:any` permissions (files). Listing with only `:own` returns only the caller's files.
3. **Hierarchy rule:** a user can only assign, change, or remove a member whose role priority is **strictly lower** than their own, and can only assign roles with priority **lower than or equal to their own** (owner excepted for assigning owner is NOT allowed; there is no owner transfer in v1).
4. **Last-owner rule:** the last owner can never be demoted, removed, or leave.
5. **System roles** (`isSystem = true`) cannot be edited or deleted. Custom roles cannot get priority ≥ the creator's own.
6. Permissions are loaded **from the database on every request** (no caching in v1 — correctness over speed).

---

## 4. API Surface (`/api/v1`)

| Method & path | Auth | Permission |
|---|---|---|
| `GET /health`, `GET /health/ready` | none | — |
| `POST /auth/register` | none | — |
| `POST /auth/login` | none | — |
| `POST /auth/refresh` | refresh cookie | — |
| `POST /auth/logout` | access | — |
| `POST /auth/logout-all` | access | — |
| `GET /auth/me` | access | — |
| `GET /sessions` · `DELETE /sessions/:sessionId` | access | own sessions only |
| `GET /permissions` | access | — (catalog) |
| `POST /orgs` · `GET /orgs` | access | — |
| `GET /orgs/:orgId` | access | membership |
| `PATCH /orgs/:orgId` | access | `org:update` |
| `GET /orgs/:orgId/members` | access | `member:read` |
| `PATCH /orgs/:orgId/members/:userId/role` | access | `member:role.update` |
| `DELETE /orgs/:orgId/members/:userId` | access | `member:remove` |
| `POST /orgs/:orgId/members/:userId/revoke-sessions` | access | `session:revoke` |
| `GET /orgs/:orgId/roles` | access | `role:read` |
| `POST /orgs/:orgId/roles` · `PATCH/DELETE /orgs/:orgId/roles/:roleId` | access | `role:manage` |
| `POST/GET /orgs/:orgId/invitations` · `DELETE /orgs/:orgId/invitations/:id` | access | `member:invite` |
| `POST /invitations/accept` | access | token must match caller's email |
| `GET /orgs/:orgId/audit-logs` | access | `audit:read` |
| `POST /orgs/:orgId/files` (multipart) | access | `file:upload` |
| `GET /orgs/:orgId/files` · `GET /orgs/:orgId/files/:fileId` | access | `file:read:own` / `file:read:any` |
| `GET /orgs/:orgId/files/:fileId/download` (returns short-lived signed URL) | access | `file:read:own` / `file:read:any` |
| `DELETE /orgs/:orgId/files/:fileId` | access | `file:delete:own` / `file:delete:any` |

**Conventions**
- Error shape (always): `{ "error": { "code": "STRING_CODE", "message": "…", "details": [] , "requestId": "…" } }`
- Pagination: cursor-based (`?limit=20&cursor=…`), max `limit` = 100.
- Every response carries `X-Request-Id`.
- Status codes: 400 validation, 401 unauthenticated, 403 forbidden, 404 not found/not a member, 409 conflict, 413 too large, 415 bad file type, 422 business-rule violation, 429 rate limited.

---

## 5. Security Design (Responsibilities 1, 4, 6)

### Auth & refresh tokens
- **Access token:** JWT HS256, 15 min, claims `sub` (userId), `sid` (session id), `jti`. Secret ≥ 32 bytes from env.
- **Refresh token:** 32 random bytes (base64url), stored only as a **SHA-256 hash**. Delivered as an **httpOnly, Secure (prod), SameSite=Strict cookie** scoped to path `/api/v1/auth`. Lifetime 7 days.
- **Rotation:** every `/auth/refresh` consumes the old token and issues a new one in the same `familyId`; the old row gets `revokedAt` + `replacedById`.
- **Reuse detection:** presenting an already-rotated token revokes the **entire family** and returns 401.
- **Instant revocation:** on revoke/logout, set Redis key `revoked:sid:<sid>` with TTL = access-token lifetime. The auth middleware rejects any access token whose `sid` is in Redis (plus a DB-validity fallback if Redis is down: fail **closed** for revoked check errors in production).
- **Passwords:** Argon2id, min 10 chars, must not equal email. Constant-time-ish responses: login failure message is always `Invalid email or password`.
- **Lockout:** 5 failed logins → 15 min lock (`lockedUntil`), reset on success.

### File upload & storage safety
- Allowlist types: `image/png`, `image/jpeg`, `application/pdf`, `text/plain`. Max **5 MB**, 1 file per request.
- Verify **magic bytes** with `file-type` — reject if detected type ≠ allowlist or ≠ declared MIME (415).
- Never use the client filename for storage: key = `orgs/<orgId>/<uuid>` (no extension trust). Sanitize and length-limit `originalName` for display; strip path separators and control characters.
- Compute `sha256`; store metadata in DB; object bucket is **private**; downloads only through **signed URLs (60 s)** after an authorization check; `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`.
- New files start as `PENDING_SCAN`; downloads blocked until `CLEAN`.
- Per-org storage quota (default 50 MB total) enforced inside a transaction.
- Deletion is soft in DB; a scheduled job removes the object later.

### Rate limiting & validation
- Global: 100 req/min per IP. Authenticated: 300 req/min per user. Login: 5 / 15 min per `ip+email`. Register: 5/hour per IP. Upload: 10/min per user. Invitations: 20/hour per org.
- Return `429` with `Retry-After`, `RateLimit-Limit`, `RateLimit-Remaining` headers.
- **All** input (body, params, query) validated with Zod via a single `validate()` middleware. Unknown keys rejected (`.strict()`). JSON body limit 100 KB.

---

## 6. Queue Design (Responsibility 5)

Separate process: `src/worker.ts` (own Dockerfile command / Railway service).

| Queue | Jobs | Retry policy |
|---|---|---|
| `email` | `send-invitation-email` | 5 attempts, exponential backoff starting at 5 s |
| `files` | `scan-file` (SHA-256 re-verify + EICAR test-signature check; sets `CLEAN`/`INFECTED`) | 3 attempts, exponential backoff, idempotent |
| `maintenance` | repeatable: `purge-expired-sessions`, `expire-invitations`, `purge-deleted-files` | 3 attempts |

- Jobs must be **idempotent** (use `jobId` = deterministic key where applicable).
- After final failure, a job is kept in BullMQ's failed set (`removeOnFail: { age: 7 days }`) **and** logged with `requestId`/`jobId`. `/health/ready` reports Redis, DB, and queue connectivity.
- Graceful shutdown: worker closes after in-flight jobs finish.

---

## 7. Folder Structure

```
.
├── BUILD_README.md          # this file
├── README.md                # public project README (created Day 3, finished Day 14)
├── docker-compose.yml       # postgres, redis, minio, mailpit
├── Dockerfile
├── .github/workflows/ci.yml
├── prisma/{schema.prisma, migrations/, seed.ts}
├── docs/{DECISIONS.md, BLOCKERS.md, ARCHITECTURE.md, ERD.md, DEMO.md}
├── src/
│   ├── app.ts  server.ts  worker.ts
│   ├── config/        # env (zod-validated), constants
│   ├── lib/           # prisma, redis, logger, errors, tokens, hashing, storage, mailer, audit
│   ├── middleware/    # authenticate, requirePermission, validate, rateLimit, errorHandler, requestId
│   ├── queues/        # definitions, producers, processors
│   ├── docs/          # openapi registry + swagger setup
│   └── modules/
│       ├── auth/  sessions/  orgs/  members/  roles/  invitations/  audit/  files/  health/
│       └── (each: *.routes.ts, *.controller.ts, *.service.ts, *.schemas.ts)
└── tests/
    ├── helpers/ (factories, test app, db reset)
    └── (mirrors src/modules)
```

Layering rule: **routes → controller → service → prisma**. Controllers never touch Prisma. Services own transactions.

---

## 8. Environment Variables (`.env.example` must contain all)

```
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://tac:tac@localhost:5432/tac
TEST_DATABASE_URL=postgresql://tac:tac@localhost:5432/tac_test
REDIS_URL=redis://localhost:6379
JWT_ACCESS_SECRET=change-me-min-32-bytes-long-xxxxxxxx
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL_DAYS=7
COOKIE_SECURE=false
CORS_ORIGINS=http://localhost:3000
S3_ENDPOINT=http://localhost:9000
S3_REGION=auto
S3_BUCKET=tac-files
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_FORCE_PATH_STYLE=true
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_USER=
SMTP_PASS=
MAIL_FROM=no-reply@tac.local
APP_URL=http://localhost:3000
```

Env is parsed by Zod at startup; the app **refuses to boot** with invalid config.

---

## 9. Schedule Overview

| Day | Theme | Commits | Milestone |
|---|---|---|---|
| 1 | Foundation | 3 | Repo, tooling, Docker, running API |
| 2 | Data + Auth core | 3 | Full schema, register, login |
| 3 | Refresh, Orgs, CI | 4 | **Resume-ready snapshot** (auth + orgs + RBAC base + CI + README) |
| 4 | RBAC deep | 2 | Custom roles, role assignment |
| 5 | Invitations + Audit | 2 | Invite flow, audit logs |
| 6 | Sessions + Rate limiting | 2 | Session control, Redis limits |
| 7 | **Deploy v1** | 2 | Live URL + Swagger on Railway |
| 8 | Storage + Upload | 2 | Safe upload |
| 9 | Files access | 2 | Signed downloads, scopes, quota |
| 10 | Queues + Worker | 2 | Email + scan jobs with retries |
| 11 | Maintenance + Deploy worker | 2 | Scheduled jobs, worker live |
| 12 | Hardening | 2 | Security headers, authz matrix tests |
| 13 | Docs + Coverage | 2 | ≥80% coverage, ERD, Postman |
| 14 | Release | 2 | Final README, demo data, `v1.0.0` |

Total: **33 commits** over 14 days.

> **Why Days 1–3 are heavier:** by the end of Day 3 the repo must already show a real, tested, CI-passing backend (auth with refresh rotation, orgs, RBAC middleware, README) so it is resume-ready early. From Day 4 the pace drops to a steady 2/day.

---

## 10. Day-by-Day Plan

### DAY 1 — Foundation (branch `day-01-foundation`)

**C1** `chore: initialize TypeScript project with lint, format and test tooling`
- `git init`, `.gitignore`, `.editorconfig`, `LICENSE` (MIT), `package.json` scripts: `dev, build, start, lint, format, test, test:watch, db:migrate, db:seed`.
- TypeScript strict, ESLint flat config, Prettier, Jest + ts-jest + Supertest configured, `tests/` with one trivial passing test.

**C2** `build: add docker-compose for postgres, redis, minio and mailpit; validated env config`
- `docker-compose.yml` with healthchecks and named volumes; a one-shot service/script that creates the MinIO bucket and the `tac_test` database.
- `src/config/env.ts` (Zod), `.env.example` exactly as §8.

**C3** `feat(api): express app skeleton with health, logging and error handling`
- `app.ts` (no listen) + `server.ts` (listen + graceful shutdown), `pino-http`, `X-Request-Id`, 404 handler, central error handler using the standard error shape, `AppError` class hierarchy, `GET /api/v1/health`.
- Test: health returns 200; unknown route returns standard 404 body.

**Responsibility check:** (7) test pipeline running, (6) env validation in place.

---

### DAY 2 — Data model + Auth core (branch `day-02-auth-core`)

**C4** `feat(db): add full prisma schema, initial migration and permission seed`
- Entire §3 schema, indexes, migration, `seed.ts` that upserts the permission catalog.
- `lib/prisma.ts` singleton; test helper that truncates all tables between tests.

**C5** `feat(auth): registration with argon2id and zod validation; openapi + swagger setup`
- `validate()` middleware; OpenAPI registry + `/docs` + `/docs/openapi.json`.
- `POST /auth/register` (email uniqueness → 409, password policy). Registered in OpenAPI. Tests: success, duplicate, weak password, extra fields rejected.

**C6** `feat(auth): login with access jwt and hashed refresh-token sessions`
- `POST /auth/login`, `GET /auth/me`, `authenticate` middleware, lockout after 5 failures.
- Session row created with hashed refresh token; cookie set per §5. Tests: success, wrong password, lockout, expired/invalid token.

**Responsibility check:** (1) login + session storage, (3) schema + indexes, (6) Zod everywhere, (7) Swagger live.

---

### DAY 3 — Refresh, Orgs, RBAC base, CI (branch `day-03-orgs-rbac-base`)

**C7** `feat(auth): refresh token rotation with reuse detection, logout and logout-all`
- `/auth/refresh`, `/auth/logout`, `/auth/logout-all`; family revocation on reuse; Redis `revoked:sid` key written on logout.
- Tests: rotation works, old token rejected, **reuse revokes whole family**, logout invalidates access token immediately.

**C8** `feat(orgs): create organization in a single transaction with system roles`
- `POST /orgs` creates org + 4 system roles + role permissions + owner membership **atomically** (Prisma `$transaction`); `GET /orgs`, `GET /orgs/:orgId`, `PATCH /orgs/:orgId`.
- Slug generation with collision handling. Tests: transaction rollback when a step fails (simulate), non-member gets 404.

**C9** `feat(rbac): permission middleware and members listing`
- `requirePermission(key | [keys])` loads membership+permissions from DB, org-scoped, returns 404 for non-members and 403 for missing permission.
- `GET /orgs/:orgId/members` (cursor pagination), `GET /permissions`.
- Tests: owner/admin/member/viewer matrix on these endpoints.

**C10** `ci: add github actions workflow; docs: project README with architecture and setup`
- `.github/workflows/ci.yml` (lint, build, migrate, test with Postgres + Redis services). Badge in README.
- Public `README.md`: overview, feature list, tech stack, quick start, "Status & roadmap" checklist, link to `/docs`.

**Responsibility check:** (1) refresh rotation + reuse detection ✔, (2) org-scoped permission checks ✔, (3) first real transaction ✔, (7) CI green ✔. **→ Resume-ready snapshot. Tag `v0.1.0`.**

---

### DAY 4 — RBAC deep (branch `day-04-rbac`)

**C11** `feat(roles): custom role CRUD with permission assignment`
- Endpoints per §4. Enforce §3 rules 3 & 5 (no editing system roles, no privilege escalation, cannot delete a role that has members → 409).
- Tests: escalation attempts rejected, duplicate names, invalid permission keys.

**C12** `feat(members): change member role and remove member with hierarchy and last-owner rules`
- `PATCH …/members/:userId/role`, `DELETE …/members/:userId` inside transactions with row locking on the org's owner count (`SELECT … FOR UPDATE` via `$queryRaw` or serializable isolation).
- Tests: cannot demote higher/equal role, last owner protected, concurrent demotion race test.

**Responsibility check:** (2) hierarchy + scoped rules ✔, (3) transactions with locking ✔.

---

### DAY 5 — Invitations + Audit logs (branch `day-05-invites-audit`)

**C13** `feat(invitations): create, list, revoke and accept invitations`
- Token = 32 random bytes, stored as SHA-256 hash, expires in 7 days. Create response includes a one-time `inviteUrl` (`APP_URL/accept-invite?token=…`) — kept permanently as a "copy link" feature.
- `POST /invitations/accept` requires the logged-in user's email to match; creates membership + marks accepted **in one transaction**; token single-use.
- Tests: expired, revoked, wrong email, reused token, duplicate pending invite → 409.

**C14** `feat(audit): append-only audit log service and query endpoint`
- `lib/audit.ts` `recordAudit(tx, event)` — always called **inside the same transaction** as the change it describes. Wire into: org create/update, member role change/remove, role CRUD, invitation create/revoke/accept, login success/failure (org-less), logout-all.
- `GET /orgs/:orgId/audit-logs` with filters (`action`, `actorId`, `from`, `to`) + cursor pagination.
- Tests: audit row exists for each action; rollback also removes audit row; non-permitted user blocked.

**Responsibility check:** (3) audit-in-transaction ✔, (2) `audit:read` scope ✔.

---

### DAY 6 — Sessions + Rate limiting (branch `day-06-sessions-ratelimit`)

**C15** `feat(sessions): list and revoke own sessions; admin revoke of member sessions`
- `GET /sessions`, `DELETE /sessions/:id`, `POST …/members/:userId/revoke-sessions` (requires `session:revoke` + hierarchy). Revocation writes Redis `revoked:sid:*` and audit log.
- Tests: revoked session's access token fails immediately; cannot revoke another user's session via own-session endpoint.

**C16** `feat(security): redis-backed rate limiting for global, auth and per-user limits`
- Limits from §5, `Retry-After` + RateLimit headers; limiter keys namespaced; limiter tests use a separate Redis DB index (`/1`) and are flushed between tests.
- Tests: login brute force → 429; headers present; limits reset after window (use short test window via config).

**Responsibility check:** (1) instant revocation ✔, (6) rate limiting ✔.

---

### DAY 7 — DEPLOY v1 (branch `day-07-deploy`)

**C17** `build: multi-stage dockerfile, production config and migration-on-release`
- `Dockerfile` (`node:22-slim`, install `openssl`, `npm ci`, `prisma generate`, build, run as non-root, `HEALTHCHECK`). `npm run start:prod`. Migrations run via `prisma migrate deploy` as the release/pre-deploy command, **never** `migrate dev`.
- Trust-proxy configured (`app.set('trust proxy', 1)`) so rate limiting sees real IPs; `COOKIE_SECURE=true` in prod.

**C18** `docs: deploy v1 to railway with live swagger and smoke tests`
- Railway project: web service, Postgres, Redis. Set env vars. Add `scripts/smoke.sh` (register → login → create org → list members) run against the live URL.
- README: live URL, Swagger URL, deployment section, `/api/v1/health` badge or note.
- Tag `v0.2.0`.

**Responsibility check:** Deployed ✔, docs publicly reachable ✔. *(File storage/worker not yet deployed — that is intentional.)*

---

### DAY 8 — Storage + Upload (branch `day-08-uploads`)

**C19** `feat(storage): s3-compatible storage provider with minio and bucket bootstrap`
- `lib/storage.ts` interface `{ put, getSignedUrl, delete, exists }` implemented with `@aws-sdk/client-s3` (+ `@aws-sdk/s3-request-presigner`). Integration test against local MinIO.

**C20** `feat(files): secure multipart upload with type, size and magic-byte validation`
- `POST /orgs/:orgId/files`; rules from §5; file row `PENDING_SCAN`; quota check in transaction; audit log.
- Tests: oversize → 413; spoofed MIME (exe renamed `.png`) → 415; double extension (`a.php.png`); path traversal filename (`../../x`); empty file; wrong field name; unauthenticated.

**Responsibility check:** (4) validation + safe keys ✔.

---

### DAY 9 — Files access (branch `day-09-files-access`)

**C21** `feat(files): list, get, signed download and soft delete with own/any scopes`
- Scoping from §3 rule 2; download blocked unless `CLEAN`; signed URL 60 s; cross-org access → 404.
- Tests: member sees only own, admin sees all, viewer cannot upload, cross-org isolation.

**C22** `feat(files): per-org quota and storage-safety hardening tests`
- Quota enforcement under concurrency (transactional check), headers (`nosniff`, attachment), bucket never publicly accessible (documented + test that raw key URL is not usable without signature).

**Responsibility check:** (4) signed URLs, private bucket, scoping ✔, (2) own/any scope ✔.

---

### DAY 10 — Queues + Worker (branch `day-10-queues`)

**C23** `feat(queue): bullmq infrastructure, worker entrypoint and invitation email job`
- `queues/` definitions + producers; `src/worker.ts`; `send-invitation-email` with Nodemailer → Mailpit; retries/backoff per §6; invitation creation enqueues the job **after** the DB transaction commits.
- Tests: processor unit test with mocked mailer; retry test (fail twice then succeed); producer enqueues exactly once.

**C24** `feat(queue): file scan job with idempotent status transitions`
- Upload enqueues `scan-file`; worker streams object, recomputes SHA-256, checks EICAR test string → `INFECTED`, else `CLEAN`; failure after retries → `FAILED`. Re-running the job is harmless.
- Tests: clean file, EICAR file, hash mismatch → `FAILED`, idempotency.

**Responsibility check:** (5) queues, worker, retries, idempotency ✔.

---

### DAY 11 — Maintenance jobs + Worker deploy (branch `day-11-maintenance`)

**C25** `feat(queue): scheduled maintenance jobs for sessions, invitations and deleted files`
- Repeatable jobs per §6, graceful worker shutdown, `/health/ready` extended with queue connectivity. Tests with fake clocks where possible.

**C26** `build: deploy worker service and r2 storage; update smoke tests and docs`
- Second Railway service from same image (`npm run start:worker`). Create Cloudflare R2 bucket + API token, set `S3_*` env vars (`S3_FORCE_PATH_STYLE=false`). SMTP provider creds in env.
- Extend `scripts/smoke.sh`: upload → wait for `CLEAN` → signed download. Tag `v0.3.0`.

**Responsibility check:** (5) worker live in production ✔, (4) production storage ✔.

---

### DAY 12 — Hardening (branch `day-12-hardening`)

**C27** `feat(security): helmet, cors allowlist, body limits and consistent error mapping`
- `helmet`, CORS allowlist from env, JSON limit, map Prisma errors (P2002 → 409, P2025 → 404) and Zod errors to the standard shape; never leak stack traces in prod; sensitive fields (password, tokens) redacted in logs.

**C28** `test(rbac): table-driven authorization matrix across all endpoints and roles`
- A test that iterates **every protected route × {owner, admin, member, viewer, non-member, anonymous}** and asserts the expected status. Includes cross-org tenant-isolation checks.

**Responsibility check:** (2) full RBAC matrix ✔, (6) validation/error mapping ✔.

---

### DAY 13 — Docs + Coverage (branch `day-13-docs-coverage`)

**C29** `test: raise coverage to 80%+ and enforce threshold in CI`
- Jest `coverageThreshold` (80% lines/branches/functions/statements), fill gaps, add a test asserting **every Express route is present in the OpenAPI document**.

**C30** `docs: erd, architecture overview, decisions log and postman collection`
- `docs/ERD.md` (Mermaid ER diagram), `docs/ARCHITECTURE.md` (request flow, token lifecycle sequence diagram, queue flow), `docs/DECISIONS.md` (why Argon2id, why opaque refresh tokens, why BullMQ, why signed URLs), Postman collection exported from OpenAPI.

**Responsibility check:** (7) docs + tests complete ✔.

---

### DAY 14 — Release (branch `day-14-release`)

**C31** `feat(seed): demo seed data and demo walkthrough`
- `npm run db:seed:demo` creates: 1 org, 4 users (one per role), sample files, sample audit history. `docs/DEMO.md` with a 5-minute curl/Swagger walkthrough and demo credentials (demo env only).

**C32** `docs: final README with screenshots, live links and release notes`
- Final public README: architecture diagram, feature table mapping to the 7 responsibilities, security design summary, test/coverage badge, live URLs, "What I'd do next".
- Redeploy, run smoke test, tag **`v1.0.0`**, create GitHub Release.

> **C33** (optional buffer commit, only if needed): `chore: fix issues found during final smoke test`.

---

## 11. Known Pitfalls — Pre-decided Fixes (so nothing "suddenly" breaks)

| Problem | Fix |
|---|---|
| Prisma fails in Docker with OpenSSL error | Install `openssl` in the slim image; keep `binaryTargets` default |
| `argon2` install fails | Use `node:22-slim`, not Alpine; ensure build tools only in the build stage if a compile is needed |
| Jest hangs ("open handles") | Export `app` separately from `server`; close Prisma, Redis, and BullMQ connections in `afterAll`; run with `--runInBand` for DB tests |
| Tests interfere with each other | Truncate tables (`TRUNCATE … RESTART IDENTITY CASCADE`) in `beforeEach`; use `TEST_DATABASE_URL` and Redis DB index 1 |
| Refresh cookie not sent by Swagger/tests | Supertest `agent()` persists cookies; Swagger UI same-origin works with cookies; document `curl -c/-b` usage |
| Rate limiter blocks tests | Make limits configurable via env; tests set tiny windows only in limiter tests |
| Rate limits use proxy IP in prod | `app.set('trust proxy', 1)` |
| Railway migration timing | Run `prisma migrate deploy` as pre-deploy command, not at app boot |
| R2 presigned URLs fail | `S3_REGION=auto`, `S3_FORCE_PATH_STYLE=false`, use the account endpoint URL |
| MinIO presigned URL host mismatch | Use one consistent `S3_ENDPOINT` host reachable by both app and client in dev |
| Express 5 route syntax errors | Use named wildcards if wildcards are needed (`/*splat`); avoid legacy path patterns |
| Zod/OpenAPI peer-dependency conflicts | Check peer deps before install; stay on Zod 3.x with the compatible OpenAPI lib version |
| Lost refresh token due to concurrent refresh calls | On reuse of a token rotated within the last 10 seconds, return 401 **without** revoking the family only if `replacedById` session is unused (grace window); otherwise revoke family. Document in `DECISIONS.md` |

---

## 12. Definition of Done (check at the end of EVERY day)

- [ ] `npm run lint` — 0 errors
- [ ] `npm run build` — success
- [ ] `npm test` — all green
- [ ] New endpoints appear in Swagger `/docs` with request/response schemas
- [ ] `.env.example` and README updated if config/setup changed
- [ ] Day's commits are atomic, correctly named, pushed
- [ ] CI is green on GitHub
- [ ] Progress Log updated (§13)

---

## 13. Progress Log (agent updates this section daily)

| Day | Date | Commits | CI | Notes / blockers |
|---|---|---|---|---|
| 1 | 2026-10-06 | 3 (C1–C3) | Local passed | Foundation complete: TypeScript, tooling, docker-compose, env validation, express skeleton, health & error handling. |
| 2 | 2026-10-07 | 3 (C4–C6) | Local passed | Data model & Auth core: Prisma schema, migration, seed, registration with argon2id, login, session storage, lockout, JWT, Swagger. |
| 3 | 2026-10-08 | 4 (C7–C10) | Local passed | Resume-ready snapshot (v0.1.0): refresh rotation, reuse detection, logout, orgs transaction, RBAC middleware, members listing, GitHub Actions CI, public README. |
| 4 | 2026-10-09 | 2 (C11–C12) | Local passed | RBAC deep: custom role CRUD, privilege escalation checks, member role updates & removal with strict hierarchy, last-owner protection, row locking concurrency safety. |
| 5 | 2026-10-10 | 2 (C13–C14) | Local passed | Invitations & Audit logs: secure 32-byte hashed invitation URLs, atomic accept/revoke, append-only transactional audit trail with filtering and cursor pagination. |
| 6 | | | | |
| 7 | | | | |
| 8 | | | | |
| 9 | | | | |
| 10 | | | | |
| 11 | | | | |
| 12 | | | | |
| 13 | | | | |
| 14 | | | | |

---

## 14. Resume Bullets (use final numbers after Day 14)

- Built a multi-tenant **IAM-style backend** (Node.js, TypeScript, Express, PostgreSQL, Redis) with JWT access tokens, **rotating refresh tokens with reuse detection**, and instant session revocation.
- Designed **org-scoped RBAC** with custom roles, role hierarchy, last-owner protection, and an append-only **audit log written inside the same DB transaction** as each change.
- Implemented **secure file uploads** (magic-byte validation, private S3/R2 storage, 60-second signed URLs, per-org quotas) with **BullMQ workers** for async scanning and email, using retries, exponential backoff, and idempotent jobs.
- Added **Redis-backed rate limiting**, Zod validation, OpenAPI/Swagger docs, and **XX%+ test coverage** (Jest + Supertest) with a CI pipeline; deployed to Railway with a separate worker service.

---

## 15. First Instruction to the Agent

> Read this entire file. Confirm you understand §1 (Locked Decisions) and §2 (Working Rules). Then start **Day 1 only**, create branch `day-01-foundation`, and produce the three commits listed. Stop after Day 1, update the Progress Log, and wait for the next instruction ("Start Day N").
