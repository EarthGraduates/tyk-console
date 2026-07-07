# Contributing to Tyk Console

Thanks for your interest in contributing! This document outlines the development workflow.

**也可以用中文交流。** Issues and PRs in Chinese are welcome.

---

## Getting Started

```bash
git clone https://github.com/EarthGraduates/tyk-console.git
cd tyk-console
cp .env.example .env
npm install
docker compose up -d    # PostgreSQL + PostgREST + Redis
npm run dev              # → http://localhost:5173
```

## Development Workflow

1. **Find or create an issue** — check [existing issues](https://github.com/EarthGraduates/tyk-console/issues) first
2. **Create a feature branch** — `git checkout -b feat/my-feature`
3. **Make your changes** — follow [docs/conventions.md](docs/conventions.md)
4. **Add tests** — if your change affects behavior, add or update tests
5. **Run checks** — `npm run test:run && npm run build`
6. **Commit** — follow [Conventional Commits](https://www.conventionalcommits.org/) (see below)
7. **Open a PR** — fill out the PR template checklist

## Commit Conventions

This project uses [Conventional Commits](https://www.conventionalcommits.org/) in English:

| Prefix | Use for |
|--------|---------|
| `feat:` | New features |
| `fix:` | Bug fixes |
| `docs:` | Documentation changes |
| `chore:` | Maintenance, dependencies, build config |
| `refactor:` | Code restructuring without behavior change |
| `test:` | Adding or updating tests |

**Examples:**
- `feat: add batch API deactivation`
- `fix: handle empty response in user list query`
- `docs: update README with Docker setup instructions`

## Code Conventions

All naming, directory structure, DB schema, and API design must follow [docs/conventions.md](docs/conventions.md). Key rules:

- Business domains: uppercase English codes (`LAB` / `IMG` / `PATH` / `ECG` / `CSSD`)
- Database tables: `biz.{domain}_{table}`
- PG functions: `ichse.{domain}_{platform}_{category}_{bizid}_{op}`
- Frontend routes: `/business/{domain}/{resource}`
- Frontend pages: `src/pages/business/{domain}/{resource}/index.tsx`

## Testing

```bash
npm run test:run       # run all tests once
npm run test           # watch mode
npm run test:coverage  # with coverage report
```

## Good First Issues

Looking for a place to start? Search issues labeled [`good first issue`](https://github.com/EarthGraduates/tyk-console/issues?q=label%3A%22good+first+issue%22).

Suggested first contribution: **i18n internationalization** — the UI is currently Chinese-only and needs multi-language support.

## Questions?

Open a [GitHub Issue](https://github.com/EarthGraduates/tyk-console/issues/new/choose) with type `question`.
