# Legal Intelligence Platform — Implementation Plan

Internal system for the Legal Department. Monitors official legal and regulatory
sources across the GCC, classifies and summarizes updates with AI, publishes them
to an internal archive, and mails a weekly digest.

Not a SaaS product. No public pages. No registration. No billing.

---

## 1. Architecture

Three components, nothing else.

```
                 ┌──────────────────────────────────────────┐
                 │                  n8n                     │
                 │  (the only orchestrator)                 │
                 │                                          │
   schedule ────►│  crawl → extract → AI → classify →       │
                 │  hash → ingest → log → notify → digest   │
                 └───────────┬──────────────────────────────┘
                             │ service_role (REST / RPC)
                             ▼
                 ┌──────────────────────────────────────────┐
                 │               Supabase                   │
                 │  Postgres · Auth · Storage · RLS         │
                 │  publishing rule lives in one RPC        │
                 └───────────┬──────────────────────────────┘
                             │ anon key + user JWT (RLS enforced)
                             ▼
                 ┌──────────────────────────────────────────┐
                 │               Next.js                    │
                 │  dashboard · archive · search · admin    │
                 │  read-mostly. no orchestration.          │
                 └──────────────────────────────────────────┘
```

### Deliberate constraints

| Rule | Reason |
|---|---|
| No Express/Nest/Django/etc. | n8n is the backend. A second orchestrator would duplicate logic and drift. |
| No Redis / queue / broker | n8n already queues and retries. Postgres is the only state store. |
| No Next.js route handlers for ingestion | Next.js never writes `legal_updates`. Writes flow through the Supabase RPC only. |
| Publishing rule in Postgres, not in n8n nodes | The 5-condition rule is enforced once, in `ingest_legal_update()`. n8n cannot bypass it, and it stays correct when workflows are edited. |
| Server Components + Server Actions | No client-side data layer, no React Query, no API layer to maintain. |

### Repository layout

```
/
├─ app/                     Next.js App Router (RTL, Arabic-first)
│  ├─ (auth)/login/
│  ├─ (app)/                authenticated shell
│  │  ├─ page.tsx           dashboard
│  │  ├─ updates/           internal blog / legal archive
│  │  ├─ sources/           source registry (admin)
│  │  ├─ newsletters/       newsletter history
│  │  └─ users/             role management (admin)
│  └─ layout.tsx
├─ components/              UI primitives + feature components
├─ lib/
│  ├─ supabase/             server / browser / middleware clients
│  ├─ auth/                 session + role guards
│  ├─ queries/              typed data access (server-only)
│  └─ constants/            country, category, status label maps (AR/EN)
├─ types/
│  ├─ database.ts           generated from schema
│  └─ domain.ts             hand-written domain types
├─ supabase/
│  ├─ migrations/           ordered, idempotent SQL
│  └─ seed/                 source registry seed
├─ n8n/
│  ├─ workflows/            importable JSON exports
│  ├─ prompts/              versioned AI prompts
│  └─ README.md             import + credential setup
├─ docs/
└─ .env.example
```

---

## 2. Data model

Five tables. No junction tables, no audit tables, no soft-delete tables.

### `sources` — the trusted registry
```
id                uuid pk
country           country_code        -- SA AE KW QA BH OM GCC
authority_ar      text
authority_en      text
source_type       source_type         -- official_gazette government regulator approved_news gcc
base_url          text
feed_url          text null           -- rss/atom when available
parser_type       parser_type         -- rss html pdf api
allowed_domains   text[]              -- hard domain allow-list, enforced on ingest
selectors         jsonb null          -- css selectors for html parser
priority          smallint 1..5
active            boolean
last_checked_at / last_success_at / consecutive_failures
```

### `legal_updates` — the archive
```
id                uuid pk
source_id         uuid fk → sources
content_hash      text UNIQUE         -- sha256(source_id|url|title|publication_date)
source_url        text
title_ar / summary_ar          text   -- AI generated, Arabic
country           country_code
category          legal_category
document_type     document_type
legal_status      legal_status
is_legal_update   boolean
confidence        numeric(3,2)
effective_date    date null
publication_date  date
affected_entities text[]
keywords          text[]
raw_excerpt       text                -- verbatim source text, never AI-modified
document_path     text null           -- Supabase Storage key for archived PDF
ai_model          text
search_vector     tsvector GENERATED  -- GIN indexed
created_at        timestamptz
```

### `newsletter_history`
```
id, period_start, period_end, subject, recipients text[], recipient_count,
update_ids uuid[], html_body, status, error_message, sent_at
```

### `workflow_logs`
```
id, workflow_name, execution_id, source_id null, status,
items_fetched, items_published, items_rejected, rejection_reason jsonb,
error_message, duration_ms, started_at, finished_at
```

### `users`
```
id uuid pk → auth.users(id), email, full_name, role user_role (admin|viewer), active, created_at
```

### RLS posture
- `service_role` (n8n) bypasses RLS — the only writer of `legal_updates`.
- `authenticated` + row in `users` with `active = true` → read everything.
- `admin` → write `sources`, `users`.
- `viewer` → read only.
- Anonymous → nothing. No table is publicly readable.

---

## 3. The publishing rule

Enforced in a single `SECURITY DEFINER` function, `ingest_legal_update(payload jsonb)`.
It returns `{status, id, reason}` so n8n can log outcomes without owning the logic.

Publish only if **all** hold:

1. `source_id` exists in `sources` **and** `active = true`
2. hostname of `source_url` ∈ `sources.allowed_domains`
3. `content_hash` not already present (also protected by the UNIQUE constraint)
4. `confidence >= 0.90`
5. `is_legal_update = true`

Anything else → `rejected`, with a reason recorded in `workflow_logs`. Never a partial write.

---

## 4. AI contract

The model summarizes, classifies, and extracts metadata. It never interprets,
never infers legal effect, never fills unknown fields with guesses.

Strict JSON, no markdown, no prose:

```json
{
  "title_ar": "",
  "summary_ar": "",
  "country": "",
  "category": "",
  "document_type": "",
  "legal_status": "",
  "is_legal_update": true,
  "confidence": 0.98,
  "effective_date": null,
  "affected_entities": [],
  "keywords": []
}
```

Guardrails:
- Enum values are constrained in the prompt and re-validated in n8n before ingest; an out-of-enum value is a rejection, not a coercion.
- Unknown date → `null`. Never a guessed date.
- Low certainty → low `confidence`, which the DB rule then filters out.
- Noise classes (conferences, MoUs, visits, interviews, statistics, opinion, marketing) → `is_legal_update: false`.

---

## 5. Milestones

Each milestone ends with a green `npm run build` (and `tsc --noEmit` where relevant),
a commit, and a push. No milestone starts before the previous one is confirmed.

| # | Milestone | Output | Done when |
|---|---|---|---|
| **M1** | Project foundation | Next.js 15 + TS strict + Tailwind, RTL/Arabic base layout, lint config, `.env.example`, README skeleton | `npm run build` passes on a clean checkout |
| **M2** | Database schema | Migrations: extensions, enums, 5 tables, indexes, `search_vector`, RLS policies, `ingest_legal_update()`, `dashboard_stats()` | SQL applies cleanly top to bottom on an empty Postgres |
| **M3** | Source registry | Seed migration with every listed authority for SA/AE/KW/QA/BH/OM + GCC, with domains, parser types, priorities | Seed inserts idempotently; row counts verified per country |
| **M4** | Auth + app shell | Supabase server/browser/middleware clients, login page, session guard, role guard, nav shell, generated `types/database.ts` | Unauthenticated hits redirect to `/login`; build passes |
| **M5** | Internal legal archive | `/updates` list with full-text search, country/category/type/date filters, timeline grouping, badges; `/updates/[id]` detail with official link | Filters and search work against seeded data; build passes |
| **M6** | Dashboard | Counts, updates by country/category, workflow health, failed sources, last execution, recent updates — server-rendered, no chart library | Renders from `dashboard_stats()`; build passes |
| **M7** | Admin: sources + users | Source CRUD via Server Actions with Zod validation, activate/deactivate, role assignment; admin-only guards | Viewer role is blocked at both UI and RLS layers |
| **M8** | n8n ingestion workflows | Source crawler (RSS/HTML/PDF branches), AI classification, hash generation, RPC ingest, per-source logging, retry/backoff | Workflow JSON imports cleanly; dry-run documented |
| **M9** | n8n newsletter + health | Weekly digest grouped by country → category, HTML template, send via M365 or Gmail, history write; daily health/failed-source alert | Newsletter renders and records a `newsletter_history` row |
| **M10** | Hardening + docs | Error boundaries, empty/loading states, deployment runbook, credential/rotation notes, final verification | Full build + typecheck green; runbook complete |

---

## 6. Open decisions

Not blocking — will be confirmed at the milestone where each is needed.

1. **Mail transport** (M9): Microsoft 365 Graph or Gmail. Both are a single-node swap in the newsletter workflow; I will implement M365 by default and document the Gmail alternative.
2. **AI provider** (M8): the prompt and JSON contract are provider-agnostic. Default to Claude via HTTP Request node, with the OpenAI variant documented.
3. **Arabic full-text search** (M2): Postgres ships no Arabic dictionary. Plan uses the `simple` configuration plus `pg_trgm` for fuzzy matching — correct and dependency-free. Revisit only if recall proves insufficient in practice.
4. **Recipient list** (M9): stored as an env-configured list in n8n rather than a sixth table, to keep the schema at five tables as specified.

---

## 7. Non-goals

Explicitly out of scope, and will not appear in the codebase: public pages, SEO,
registration, comments, reactions, multi-tenancy, billing, GraphQL, microservices,
containers/orchestrators, message brokers, event bus, CQRS, or any second backend.
