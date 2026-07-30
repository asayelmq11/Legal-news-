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
| `npm run verify` | typecheck → lint → build. **This is what CI runs.** |

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
app/                Next.js App Router (RTL, Arabic-first)
components/         UI primitives and feature components
lib/
  constants/        country and taxonomy registries, Arabic labels
  env.ts            validated server environment (server-only)
  utils.ts          shared helpers
supabase/migrations/  ordered SQL — integrity constraints only
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
| M2 Database schema | ⬜ next |
| M3 Source registry | ⬜ |
| M4 Auth + app shell | ⬜ |
| M5 Internal legal archive | ⬜ |
| M6 Dashboard + health | ⬜ |
| M7 Admin: sources / users / settings | ⬜ |
| M8 n8n: scheduler + parsers | ⬜ |
| M9 n8n: AI + publishing gate | ⬜ |
| M10 n8n: retry, health, manual run | ⬜ |
| M11 n8n: newsletter | ⬜ |
| M12 Hardening + docs | ⬜ |
