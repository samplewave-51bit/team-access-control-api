# Team Access Control API

[![CI](https://github.com/samplewave-51bit/team-access-control-api/actions/workflows/ci.yml/badge.svg)](https://github.com/samplewave-51bit/team-access-control-api/actions/workflows/ci.yml)
[![Node Version](https://img.shields.io/badge/node-22%20LTS-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/typescript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Express](https://img.shields.io/badge/express-5.x-lightgrey.svg)](https://expressjs.com/)
[![Prisma](https://img.shields.io/badge/prisma-6.x-indigo.svg)](https://www.prisma.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A production-grade, multi-tenant **IAM-style SaaS backend API** built with Node.js 22 LTS, TypeScript, Express 5, PostgreSQL 16, and Redis 7.

---

## Overview

The **Team Access Control API** implements enterprise-grade authentication, role-based access control (RBAC), session lifecycle management, audit logging, and secure file operations across multi-tenant organizations.

### The 7 Backend Responsibilities

| #     | Responsibility                  | Architecture & Implementation                                                                                                                                                                                                |
| ----- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | **Auth & Refresh Tokens**       | JWT HS256 (15 min) + opaque rotating refresh tokens (7 days) with family reuse detection and instant Redis revocation (`revoked:sid:*`). Argon2id password hashing with account lockout after 5 consecutive failed attempts. |
| **2** | **RBAC & Scoped Access**        | Org-scoped permission checks with 4 system roles (`owner`, `admin`, `member`, `viewer`), role hierarchy, last-owner protection, and tenant leak protection (non-members receive `404 Not Found`, not `403 Forbidden`).       |
| **3** | **Database & Transactions**     | PostgreSQL 16 with Prisma 6. Atomic multi-table `$transaction` operations for organization creation with automated system roles and permission catalog bindings.                                                             |
| **4** | **File Storage Safety**         | Private S3-compatible object storage (MinIO locally, Cloudflare R2 in prod), magic-byte MIME verification, 60-second presigned URLs, and per-org quotas.                                                                     |
| **5** | **Queues & Workers**            | Dedicated BullMQ background worker service with exponential backoff retries for invitation dispatch and virus scanning.                                                                                                      |
| **6** | **Rate Limiting & Validation**  | Redis-backed distributed rate limiters (`rate-limiter-flexible`) with `Retry-After` headers and strict Zod runtime schema validation on all inputs.                                                                          |
| **7** | **API Documentation & Testing** | Interactive OpenAPI 3.0 / Swagger UI served at `/docs`, with exhaustive Jest + Supertest integration test suites.                                                                                                            |

---

## Tech Stack

| Component             | Technology                                              | Version        |
| --------------------- | ------------------------------------------------------- | -------------- |
| Runtime               | Node.js (CommonJS output)                               | 22 LTS         |
| Language              | TypeScript (Strict mode)                                | 5.7+           |
| Framework             | Express                                                 | 5.x            |
| Database              | PostgreSQL                                              | 16             |
| ORM                   | Prisma                                                  | 6.x            |
| Cache & Session Store | Redis                                                   | 7              |
| Password Hashing      | Argon2id                                                | via `argon2`   |
| Token Management      | JSON Web Tokens & Crypto                                | `jsonwebtoken` |
| Validation            | Zod                                                     | 3.x            |
| API Documentation     | `@asteasolutions/zod-to-openapi` + `swagger-ui-express` | OpenAPI 3.0    |
| Testing               | Jest + `ts-jest` + Supertest                            | 29.x           |
| Logging               | Pino + `pino-http`                                      | 9.x            |

---

## Quick Start

### 1. Prerequisites

- [Node.js 22 LTS](https://nodejs.org/)
- [Docker](https://www.docker.com/) & Docker Compose (or local PostgreSQL 16 & Redis 7)

### 2. Environment Setup

Clone the repository and copy the example environment file:

```bash
git clone https://github.com/samplewave-51bit/team-access-control-api.git
cd team-access-control-api
cp .env.example .env
```

### 3. Start Infrastructure Services

Start PostgreSQL, Redis, MinIO, and Mailpit:

```bash
docker compose up -d
```

### 4. Install Dependencies & Migrate Database

```bash
npm install
npm run db:migrate
npm run db:seed
```

### 5. Start Development Server

```bash
npm run dev
```

The server will boot at `http://localhost:3000`.

---

## API Documentation

Once the server is running, explore the interactive Swagger documentation:

- **Swagger UI:** [http://localhost:3000/docs](http://localhost:3000/docs)
- **OpenAPI 3.0 JSON:** [http://localhost:3000/docs/openapi.json](http://localhost:3000/docs/openapi.json)

### Core Endpoints Implemented

| Method  | Endpoint                      | Access        | Description                                     |
| ------- | ----------------------------- | ------------- | ----------------------------------------------- |
| `GET`   | `/api/v1/health`              | Public        | Service health status and uptime                |
| `POST`  | `/api/v1/auth/register`       | Public        | Register new user account with Argon2id         |
| `POST`  | `/api/v1/auth/login`          | Public        | Authenticate user, receive JWT & refresh cookie |
| `POST`  | `/api/v1/auth/refresh`        | Cookie        | Rotate refresh token with reuse detection       |
| `POST`  | `/api/v1/auth/logout`         | Bearer        | Revoke active session via Redis and DB          |
| `POST`  | `/api/v1/auth/logout-all`     | Bearer        | Revoke all active sessions for current user     |
| `GET`   | `/api/v1/auth/me`             | Bearer        | Get authenticated user profile                  |
| `POST`  | `/api/v1/orgs`                | Bearer        | Atomically create org with 4 system roles       |
| `GET`   | `/api/v1/orgs`                | Bearer        | List organizations user belongs to              |
| `GET`   | `/api/v1/orgs/:orgId`         | Bearer        | Get organization details (member-only)          |
| `PATCH` | `/api/v1/orgs/:orgId`         | `org:update`  | Update organization details                     |
| `GET`   | `/api/v1/orgs/:orgId/members` | `member:read` | Cursor-paginated members listing                |
| `GET`   | `/api/v1/permissions`         | Bearer        | Global permissions catalog                      |

---

## Testing & Quality Assurance

Run the complete test suite:

```bash
# Run unit & integration tests
npm test

# Run linter
npm run lint

# Check code formatting
npm run format

# Compile TypeScript
npm run build
```

---

## Status & Roadmap

- [x] **Day 1: Foundation** — Tooling, Docker Compose, Zod env validation, Express 5 skeleton, central error handling, health endpoint.
- [x] **Day 2: Data + Auth Core** — Full Prisma schema, PostgreSQL 16 migration, permission catalog seed, Argon2id registration, login with session tracking, account lockout, OpenAPI setup.
- [x] **Day 3: Refresh, Orgs, RBAC Base & CI** — Refresh token rotation with family reuse detection, logout, logout-all, atomic organization creation with system roles, org-scoped RBAC middleware, members listing with cursor pagination, GitHub Actions CI workflow. _(Snapshot v0.1.0)_
- [ ] **Day 4: RBAC Deep** — Custom role CRUD, member role modification, last-owner protection.
- [ ] **Day 5: Invitations & Audit Logs** — Hashed invitation links, atomic acceptance, transactional append-only audit trail.
- [ ] **Day 6: Sessions & Rate Limiting** — Session management, Redis distributed rate limiters with headers.
- [ ] **Day 7: Production Deploy v1** — Multi-stage Dockerfile, Railway deployment, smoke tests.
- [ ] **Day 8: Storage & Secure Uploads** — S3 client, MinIO integration, multipart file validation, magic-byte checks.
- [ ] **Day 9: File Access & Signed URLs** — Scoped access (`:own` vs `:any`), 60s signed download URLs, per-org quotas.
- [ ] **Day 10: Background Queues & Workers** — BullMQ worker process, transactional email, antivirus file scanner.
- [ ] **Day 11: Maintenance Jobs & Worker Deploy** — Scheduled session purge and file cleanup, worker deployment.
- [ ] **Day 12: Security Hardening** — Helmet headers, CORS allowlist, exhaustive authz matrix test suite.
- [ ] **Day 13: Documentation & Coverage** — 80%+ test coverage threshold, ERD diagrams, Postman collection.
- [ ] **Day 14: Release v1.0.0** — Demo seed data, walkthrough guide, release tagging.

---

## License

This project is licensed under the [MIT License](LICENSE).
