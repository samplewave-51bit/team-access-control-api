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
| 3 | | | | |
| 4 | | | | |
| 5 | | | | |
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
