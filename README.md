# منصة الرصد القانوني الخليجي — Legal Intelligence Platform

Internal platform for the Legal Department. Continuously monitors official legal
and regulatory sources across the GCC, classifies and summarizes updates with AI,
publishes them to a searchable internal archive, and mails a weekly digest.

**Internal system.** No public pages, no registration, no SEO, no billing.

---

## Architecture

Three components. n8n is the only orchestrator.

| Component | Owns | Never does |
|---|---|---|
| **n8n** | Scheduling, crawling, parsing, AI, classification, publishing rules, retries, notifications, logging | — |
| **Supabase** | Postgres, Auth, Storage, RLS. Integrity constraints only | Hold business rules |
| **Next.js** | Dashboard, archive, search, admin (sources / users / settings) | Write `legal_updates`. Orchestrate anything |

`legal_updates` is write-sealed against the web application: no write policy
exists for `authenticated`, and INSERT/UPDATE/DELETE are explicitly revoked. Only
n8n, holding the `service_role` key, writes the archive.

Full design — data model, parser strategy, publishing gate, retry and scheduling
policy — is in [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md).

---

## Requirements

- Node.js >= 20.9 (developed on 22.x)
- A Supabase project
- An n8n instance that can reach Supabase and the AI provider

---

## Getting started

```bash
npm install
cp .env.example .env.local     # fill in Supabase values
npm run dev
```

| Script | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build (fails on type errors) |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | vitest — 175 assertions across auth, guards, search, filters, links, dashboard, admin |
| `npm run verify` | typecheck → lint → test → build. **This is what CI runs.** |
| `npm run db:check` | applies all migrations to a scratch Postgres and runs 61 SQL assertions |
| `npm run db:types` | regenerates `types/database.ts` from a live schema |

Next 16 no longer runs ESLint during `next build`, which is why `verify` exists
as a separate composite step rather than relying on the build alone.

---

## Secrets

The web application needs only the Supabase URL and anon key — both safe for the
browser, because every table is protected by RLS.

These belong in **n8n Credentials** and must never appear in `.env.local`, in
`app_settings`, or in committed files:

- `SUPABASE_SERVICE_ROLE_KEY` — bypasses RLS; sole write path to the archive
- AI provider API key
- SMTP / Microsoft 365 credentials

The `N8N_TRIGGER_SECRET` used by the admin "Run now" control is server-side only
and is deliberately not `NEXT_PUBLIC_`. When it is missing the control fails
closed — disabled with an explanation, never an unauthenticated request.

---

## Project layout

```
app/
  (app)/            authenticated shell — guarded by requireActiveUser()
  login/            sign-in (no self-provisioning)
  no-access/        unprovisioned and deactivated states
  unauthorized/     insufficient role
  configuration-error/  missing environment, fails closed
components/         UI primitives and feature components
lib/
  auth/             session resolution, role guards, sign-in/out actions
  queries/          server-only typed reads (no raw SQL)
  search/           Arabic normalisation — contract shared with Postgres
  updates/          filter parsing, external-link verification
  supabase/         browser / server / proxy clients
  sources/          source status derivation
  constants/        country and taxonomy registries, Arabic labels
  env.ts            validated server environment (server-only)
  nav.ts            role-aware navigation
proxy.ts            Next 16 proxy — session refresh + coarse redirect
scripts/            database type generator
tests/              vitest — auth, guards, status derivation
types/database.ts   GENERATED from the live schema
supabase/
  migrations/         ordered SQL — integrity constraints only
  fixtures/           dev-only fake data — NEVER applied to production
  tests/              SQL verification suite (89 assertions)
n8n/workflows/        importable workflow JSON
docs/                 implementation plan and runbooks
```

`lib/constants/` is the source of truth for the country and taxonomy values that
become Postgres enums in M2 and constrained AI outputs in M9. Changing a value
means changing all three together.

---

## Build status

| Milestone | Status |
|---|---|
| M1 Project foundation | ✅ complete |
| M2 Database schema | ✅ complete |
| M3 Source registry | ✅ complete |
| M4 Auth + app shell | ✅ complete |
| M5 Internal legal archive | ✅ complete |
| M6 Dashboard + health | ✅ complete |
| M7 Admin: sources / users / settings | ✅ complete |
| M7.5 Egress verification (blocks M8) | ⬜ next |
| M8 n8n: scheduler + parsers | ⬜ |
| M9 n8n: AI + publishing gate | ⬜ |
| M10 n8n: retry, health, manual run | ⬜ |
| M11 n8n: newsletter | ⬜ |
| M12 Hardening + docs | ⬜ |
