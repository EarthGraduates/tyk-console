# Tyk Console

**A management console for Tyk Gateway OSS** — persistent storage, self-managed state, China Cybersecurity Level-3 compliance, and healthcare data exchange built-in.

**Tyk Gateway OSS 管理控制台** — 弥补社区版缺少持久化存储与自管状态的短板，内置等保三级安全合规与医疗数据共享能力。

---

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-v0.9.0-informational)](#)

> ⚠️ **This project is under active development (v0.9.0).** Not yet recommended for production use.
> ⚠️ **UI is currently Chinese-only.** i18n support is tracked as a [good first issue](https://github.com/EarthGraduates/tyk-console/issues).

---

## Screenshots

<!-- TODO: add 4-5 screenshots of Dashboard, API Management, Key Management, and Interfaces pages -->

*Coming soon.*

---

## Why Tyk Console?

Tyk Gateway OSS is a powerful API gateway, but its community edition has notable gaps:

| Limitation | How Tyk Console solves it |
|------------|---------------------------|
| **No persistent storage** — API definitions live only in Redis | PostgreSQL as source of truth; all API/Key definitions survive restarts |
| **No built-in RBAC** — single admin user | Three-role separation (system admin / security admin / audit admin), JWT auth, row-level security |
| **No audit trail** — who changed what and when? | Full operation audit logging with HMAC integrity verification |
| **No security compliance** | Implements China Cybersecurity Level-3 (等保 2.0 三级) requirements out of the box |
| **No API lifecycle management** | Activate / deactivate / archive / re-sync APIs with a click |
| **No healthcare-specific tooling** | Built-in validation engine, 5 medical business domains (LAB/IMG/PATH/ECG/CSSD), interface contract management |

---

## Features

### Gateway Management
- **API Definitions** — Full CRUD, batch operations (activate/deactivate/delete), one-click register from interface catalog, sync status tracking
- **Key Management** — Create/edit/revoke keys, rate limits, quotas, expiry, per-API access rights
- **Gateway Monitor** — Container health, start/stop/restart, hot reload

### Security & Compliance (等保 2.0 三级)
- **Three-Role Separation** (三员分立) — System Admin / Security Admin / Audit Admin
- **Row-Level Security** — PostgREST + PostgreSQL RLS enforces data isolation
- **Audit Logging** — HMAC-signed immutable audit trail, searchable by user/module/time range
- **Password Policy** — Configurable complexity, expiration, and session timeout

### Healthcare Data Exchange
- **5 Business Domains** — Laboratory (LAB), Medical Imaging (IMG), Pathology (PATH), ECG, Central Sterile Supply (CSSD)
- **Validation Engine** — Chain-of-responsibility: Regex → Domain → Cross-Field validation
- **Interface Contract Management** — Interface ID catalog (`LAB-DEMO-MD-O001`), field-level metadata, test data generation

### Developer Experience
- **PostgREST Bridge** — Auto-generated REST APIs from PostgreSQL schemas
- **One-command Start** — `docker compose up` spins up the entire stack
- **Test Data Generator** — Python scripts for full-column test coverage across 22 lab tables

---

## Quick Start

### Prerequisites

- Docker & Docker Compose
- Node.js 20+
- Tyk Gateway OSS (v5.12+)

### 1. Clone & Configure

```bash
git clone https://github.com/EarthGraduates/tyk-console.git
cd tyk-console
cp .env.example .env
# Edit .env with your settings (defaults work for local dev)
```

### 2. Start Infrastructure

```bash
# PostgreSQL + PostgREST + Redis
docker compose up -d
```

### 3. Start Frontend

```bash
npm install
npm run dev          # → http://localhost:5173
```

### 4. Default Accounts

| Email | Password | Role |
|-------|----------|------|
| `dev_admin@ichse.local` | `Test1234!` | System Admin |
| `dev_sec@ichse.local` | `Test1234!` | Security Admin |
| `dev_audit@ichse.local` | `Test1234!` | Audit Admin |

> ⚠️ **Development defaults only.** Change passwords immediately for any non-local deployment.

---

## Architecture

```
Browser (localhost:5173)
  ├── /tyk/*  → Tyk Gateway (localhost:8080)     ← API/Key CRUD
  ├── /hello  → Tyk Gateway                      ← Health check
  └── /db/*   → PostgREST (localhost:3001)       ← Database REST API
                   └── PostgreSQL (localhost:5433)

               ┌──────────────────────────────────┐
               │         Tyk Gateway (:8080)       │
               │   API routing, keyless passthrough│
               └──────────────┬───────────────────┘
                              │
               ┌──────────────▼───────────────────┐
               │   Python FastAPI Services (:8000) │
               │   Validation Engine + Router      │
               └──────┬────────────┬─────────────┘
                      │            │
       ┌──────────────▼──┐  ┌──────▼──────────────┐
       │ PostgREST (:3001)│  │ PG Functions (ichse)│
       │ Table CRUD       │  │ Complex transactions│
       └────────┬─────────┘  └──────┬──────────────┘
                │                   │
       ┌────────▼───────────────────▼──────────┐
       │         PostgreSQL (:5433)             │
       │  ┌──────────┐  ┌────────────────────┐  │
       │  │ ichse    │  │ biz                 │  │
       │  │ 管理数据  │  │ 业务数据 (lab/img/…) │  │
       │  └──────────┘  └────────────────────┘  │
       └────────────────────────────────────────┘
       ┌──────────┐
       │ Redis    │  Rule cache + log queue
       └──────────┘
```

---

## Tech Stack

| Component | Version | Purpose |
|-----------|---------|---------|
| Refine + Ant Design | v6 | Frontend framework (Data + Auth providers) |
| React | v19 | UI runtime |
| TypeScript | v5.8 | Type system |
| Vite | v6.3 | Build tool |
| Tyk Gateway OSS | v5.12 | API Gateway (managed target) |
| PostgreSQL | v17 | Source of truth |
| PostgREST | v14 | DB → REST API bridge |
| Redis | v7 | Rule cache + async log queue |
| Python FastAPI | — | Validation engine services |
| Docker Compose | — | Local dev environment |

---

## Documentation

| Document | Description |
|----------|-------------|
| [CONTEXT.md](CONTEXT.md) | Domain glossary and terminology |
| [docs/architecture.md](docs/architecture.md) | System architecture overview |
| [docs/conventions.md](docs/conventions.md) | Coding conventions (naming, DB schema, API registration) |
| [docs/security.md](docs/security.md) | Security compliance design (等保 2.0 三级) |
| [docs/adr/](docs/adr/) | Architectural Decision Records |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, commit conventions, and PR guidelines.

We follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat` / `fix` / `docs` / `chore`).

> **UI is currently Chinese-only.** We welcome contributions for i18n internationalization!

---

## License

[Apache 2.0](LICENSE) © 2026 EarthGraduates
