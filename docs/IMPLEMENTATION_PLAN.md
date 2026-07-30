# Legal Intelligence Platform — Implementation Plan

Internal system for the Legal Department. Monitors official legal and regulatory
sources across the GCC, classifies and summarizes updates with AI, publishes them
to an internal archive, and mails a weekly digest.

Not a SaaS product. No public pages. No registration. No billing.

> **Revision 2** — incorporates the architectural directives: business logic moved
> entirely into n8n, `legal_updates` write-sealed from the web app, explicit parser
> strategy, source health monitoring, retry/backoff, priority-based scheduling, and
> manual execution from the admin dashboard.

---

## 1. Architecture

Three components, nothing else.

```
   ┌─────────────────────────────────────────────────────────────┐
   │                            n8n                              │
   │              the only place business logic lives            │
   │                                                             │
   │  scheduler ─► due-source selection (priority intervals)     │
   │      │                                                      │
   │      ├─► parser router ─► RSS │ HTML │ API │ PDF            │
   │      │                     └── normalized RawItem ──┐       │
   │      ├─► AI classify / summarize / extract ─────────┤       │
   │      ├─► PUBLISHING GATE  (sub-workflow, 5 rules) ──┤       │
   │      ├─► insert · health snapshot · workflow log ───┘       │
   │      ├─► retry queue (exponential backoff)                  │
   │      └─► weekly newsletter · health alerts                  │
   └──────┬──────────────────────────────────────▲───────────────┘
          │ service_role (sole writer)           │ signed webhook
          ▼                                      │ (manual run only)
   ┌─────────────────────────────────┐           │
   │           Supabase              │           │
   │  Postgres · Auth · Storage      │           │
   │  INTEGRITY ONLY — no rules      │           │
   └──────┬──────────────────────────┘           │
          │ anon key + user JWT, RLS enforced    │
          ▼                                      │
   ┌─────────────────────────────────────────────┴───────────────┐
   │                          Next.js                            │
   │  dashboard · archive · search · admin (sources/users/       │
   │  settings) · "Run now" trigger button                       │
   │  reads data. writes config. never writes legal_updates.     │
   └─────────────────────────────────────────────────────────────┘
```

### Layer contracts

| Layer | May do | May never do |
|---|---|---|
| **n8n** | All scheduling, crawling, parsing, AI, classification, thresholds, duplicate flow, retries, publishing decisions, notifications, logging | — |
| **Postgres** | UNIQUE, FOREIGN KEY, CHECK, NOT NULL, indexes, RLS/grants | Hold any business rule. No `SECURITY DEFINER` ingest function, no rule triggers, no threshold logic |
| **Next.js** | Read everything the user's role permits; write `sources`, `users`, `app_settings`; fire a signed "run now" webhook | Write `legal_updates`, `workflow_logs`, or `newsletter_history`. Decide what gets published. Orchestrate anything |

### Deliberate constraints

| Rule | Reason |
|---|---|
| No Express/Nest/Django/etc. | n8n is the backend. A second orchestrator would duplicate logic and drift. |
| No Redis / queue / broker | n8n already queues and retries. Postgres is the only state store. |
| No ingestion route handlers in Next.js | The web app has no write path to `legal_updates` at all — enforced by grants, not convention. |
| Server Components + Server Actions | No client data layer, no React Query, no API layer to maintain. |
| One Publishing Gate sub-workflow | See §4 — the five rules exist exactly once inside n8n. |

### Repository layout

```
/
├─ app/                     Next.js App Router (RTL, Arabic-first)
│  ├─ (auth)/login/
│  ├─ (app)/
│  │  ├─ page.tsx           dashboard + source health
│  │  ├─ updates/           internal blog / legal archive
│  │  ├─ sources/           source registry + "Run now"  (admin)
│  │  ├─ newsletters/       newsletter history
│  │  ├─ users/             role management              (admin)
│  │  └─ settings/          app settings                 (admin)
│  └─ layout.tsx
├─ components/
├─ lib/
│  ├─ supabase/             server / browser / middleware clients
│  ├─ auth/                 session + role guards
│  ├─ queries/              typed read access (server-only)
│  ├─ actions/              Server Actions (config writes + run-now trigger)
│  └─ constants/            country / category / status label maps (AR/EN)
├─ types/
├─ supabase/
│  ├─ migrations/           ordered, idempotent SQL — integrity only
│  └─ seed/
├─ n8n/
│  ├─ workflows/            importable JSON exports
│  ├─ prompts/              versioned AI prompts
│  └─ README.md             import, credentials, webhook setup
├─ docs/
└─ .env.example
```

---

## 2. Data model

Six tables. Integrity constraints only — no triggers carrying rules, no RPCs.

### `sources` — trusted registry, parser config, schedule, health

```
-- identity
id                    uuid pk
country               country_code        -- SA AE KW QA BH OM GCC
authority_ar          text not null
authority_en          text not null
source_type           source_type         -- official_gazette government regulator approved_news gcc
base_url              text not null
active                boolean not null default true

-- parser strategy (§3)
parser_type           parser_type         -- rss html api pdf
feed_url              text                -- rss / api endpoint
parser_config         jsonb not null default '{}'   -- selectors or api field mapping

-- domain allow-list, checked by n8n before publishing
allowed_domains       text[] not null  check (cardinality(allowed_domains) > 0)

-- scheduling (§6)
priority              smallint not null check (priority between 1 and 5)
poll_interval_minutes integer          check (poll_interval_minutes > 0)  -- null = use priority default
next_run_at           timestamptz

-- health snapshot (§4) — written by n8n, read by dashboard
health_status         health_status not null default 'never_run'
last_run_at           timestamptz
last_success_at       timestamptz
last_failure_at       timestamptz
last_failure_reason   text
last_duration_ms      integer
last_items_fetched    integer not null default 0
last_items_published  integer not null default 0
last_items_rejected   integer not null default 0
consecutive_failures  integer not null default 0
retry_attempt         integer not null default 0
next_retry_at         timestamptz

created_at / updated_at
```

Health and schedule fields are **state written by n8n**, not rules. Postgres stores
them; it never computes or acts on them.

### `legal_updates` — the archive (write-sealed from the web app)

```
id                uuid pk
source_id         uuid not null references sources(id)
content_hash      text not null UNIQUE      -- sha256(source_id|url|title|publication_date), built in n8n
source_url        text not null
title_ar          text not null
summary_ar        text not null
country           country_code not null
category          legal_category not null
document_type     document_type not null
legal_status      legal_status not null
is_legal_update   boolean not null
confidence        numeric(3,2) not null check (confidence between 0 and 1)
effective_date    date
publication_date  date not null
affected_entities text[] not null default '{}'
keywords          text[] not null default '{}'
raw_excerpt       text not null             -- verbatim source text, never AI-modified
document_path     text                      -- Supabase Storage key for archived PDF
ai_model          text not null
search_vector     tsvector GENERATED        -- GIN indexed
created_at        timestamptz not null default now()
```

`CHECK (confidence between 0 and 1)` is a domain constraint — a value outside it is
not a number. The `>= 0.90` publishing threshold is **not** in the database; it is a
node in the Publishing Gate.

### `workflow_logs` — full execution history

```
id, workflow_name, execution_id, source_id (null for non-source runs),
trigger_type      trigger_type   -- scheduled | manual | retry
status            run_status     -- success | partial | failed
items_fetched / items_published / items_rejected  integer
rejection_reasons jsonb          -- {"low_confidence":3,"duplicate":5,"not_legal_update":2}
error_message     text
duration_ms       integer
retry_attempt     integer
started_at / finished_at
```

### `newsletter_history`
```
id, period_start, period_end, subject, recipients text[], recipient_count,
update_ids uuid[], html_body, status, error_message, sent_at
```

### `users`
```
id uuid pk references auth.users(id), email, full_name,
role user_role (admin|viewer), active boolean, created_at
```

### `app_settings` — admin-managed configuration
```
key         text pk
value       jsonb not null
description text
updated_at  timestamptz
updated_by  uuid references users(id)
```

Key/value rather than columns, so adding a setting never needs a migration. Seeded
with: newsletter recipients, newsletter send day, AI confidence threshold, retry
backoff schedule, priority→interval map. n8n **reads** these; the thresholds live in
n8n's decision nodes and are merely *parameterised* from here, so an admin can tune a
number without editing a workflow.

### RLS and grants

| Table | anon | authenticated (active user) | admin | service_role (n8n) |
|---|---|---|---|---|
| `legal_updates` | — | SELECT | SELECT | full |
| `workflow_logs` | — | SELECT | SELECT | full |
| `newsletter_history` | — | SELECT | SELECT | full |
| `sources` | — | SELECT | SELECT INSERT UPDATE DELETE | full |
| `users` | — | SELECT self | full | full |
| `app_settings` | — | SELECT | SELECT UPDATE | full |

Write-sealing is enforced twice, belt and braces:

1. **No INSERT/UPDATE/DELETE policy exists** on `legal_updates`, `workflow_logs`, or
   `newsletter_history` for `authenticated` — RLS denies by default.
2. **Explicit `REVOKE INSERT, UPDATE, DELETE ... FROM anon, authenticated`** — so even
   if a policy is added by mistake later, the grant is still missing.

`service_role` bypasses RLS and is the only writer. That key lives in n8n credentials
and never reaches the browser or a Next.js client component.

---

## 3. Parser strategy

Every source declares one `parser_type`. Each parser branch is a separate lane in the
crawler workflow, and all four converge on one normalized shape before anything
downstream runs:

```jsonc
// RawItem — the single contract between parsing and AI
{
  "source_id": "uuid",
  "source_url": "https://…",        // canonical item URL
  "title_raw": "…",                 // untouched source title
  "content_raw": "…",               // untouched source text
  "publication_date": "2026-07-30", // ISO or null
  "attachments": ["https://…pdf"],  // discovered documents
  "fetched_at": "…"
}
```

Because everything downstream consumes `RawItem`, adding a fifth parser later means
adding one lane — no change to AI, gate, ingest, or logging.

| `parser_type` | Lane | `parser_config` shape |
|---|---|---|
| **rss** | HTTP GET `feed_url` → XML → item loop → map fields | `{ "date_field": "pubDate", "content_field": "description" }` |
| **html** | HTTP GET → HTML Extract → list selector → per-item detail fetch | `{ "list": ".news-item", "title": "h3 a", "link": "h3 a@href", "date": ".date", "body": ".article-body" }` |
| **api** | HTTP GET/POST `feed_url` → JSON → path mapping | `{ "items_path": "data.results", "title": "title", "url": "link", "date": "published_at", "body": "summary", "headers": {} }` |
| **pdf** | HTTP GET index → resolve PDF links → download → Extract-from-File → text | `{ "list": "a[href$='.pdf']", "max_pages": 40 }` |

**PDF enrichment applies to every lane, not only `parser_type = pdf`.** Official
gazettes routinely publish an RSS entry whose substance is an attached PDF. Any
`RawItem` carrying `attachments` is routed through the same PDF extraction step, the
original file is archived to Supabase Storage, and `document_path` is recorded. A
gazette that is a bare PDF index uses `parser_type = pdf` as its entry point; a
gazette with a feed uses `rss` and reaches the same extractor.

Failure isolation: a parser error fails **that source only**. Other sources in the
same scheduler tick continue, and the failure is recorded against the one source.

---

## 4. Publishing rules — n8n only

Removed from Postgres entirely. No `ingest_legal_update()` function, no rule triggers.

The five conditions live in **one reusable sub-workflow, `publishing-gate`**, called by
the ingestion workflow and by nothing else:

```
RawItem + AI result
  │
  ├─ 1. source active and in registry?         ── no ─► reject: inactive_source
  ├─ 2. hostname(source_url) ∈ allowed_domains? ── no ─► reject: domain_mismatch
  ├─ 3. content_hash already present?           ── yes ─► reject: duplicate
  ├─ 4. confidence >= threshold (0.90)?         ── no ─► reject: low_confidence
  ├─ 5. is_legal_update == true?                ── no ─► reject: not_legal_update
  │
  └─ all pass ─► INSERT into legal_updates (service_role)
```

Rejections are not errors. Each increments a counter in `rejection_reasons` and the
item is dropped. Nothing partial is ever written.

**Why a sub-workflow rather than inline IF nodes:** the rule set must exist once. If
the gate were copy-pasted into the crawler, the newsletter backfill, and the manual-run
workflow, the three copies would diverge on the first threshold change. A single
sub-workflow with a versioned export is the n8n-native way to keep one source of truth
while honouring "all business logic lives in n8n".

**Duplicate handling, explicitly.** The gate checks `content_hash` before inserting, and
the `UNIQUE` constraint remains as the integrity backstop for the race where two
executions process the same item concurrently. n8n catches the unique-violation error,
classifies it as `duplicate`, and continues — a constraint violation is never surfaced
as a workflow failure. Postgres guarantees uniqueness; n8n decides what uniqueness
*means* for the flow.

---

## 5. AI contract

The model summarizes, classifies, and extracts metadata. It never interprets, never
infers legal effect, never fills unknown fields with guesses.

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

Guardrails, all enforced in n8n:
- Enum values constrained in the prompt and re-validated in a Code node before the
  gate; an out-of-enum value is a rejection, never a coercion.
- Unknown date → `null`. Never a guessed date.
- Low certainty → low `confidence`, which the gate then filters.
- Noise classes (conferences, MoUs, visits, interviews, statistics, opinion,
  marketing) → `is_legal_update: false`.
- Malformed JSON → one re-ask, then `reject: ai_parse_failure`.

---

## 6. Scheduling

One dispatcher workflow runs hourly. For each priority tier it computes a cutoff and
selects due sources, so the polling cadence is a **decision made in n8n**, not a cron
per source and not a rule in the database.

| Priority | Default interval | Typical sources |
|---|---|---|
| 1 | 1 hour | Official gazettes, central banks |
| 2 | 3 hours | Ministries of Justice, cabinets, regulators |
| 3 | 6 hours | Sector regulators, GCC Secretariat |
| 4 | 12 hours | Secondary authorities |
| 5 | 24 hours | Approved news sources |

Selection per tier:

```sql
select * from sources
where active
  and priority = $tier
  and (next_run_at is null or next_run_at <= now())
  and (next_retry_at is null or next_retry_at <= now())
order by priority, last_run_at nulls first
limit $batch
```

`poll_interval_minutes` on a source overrides its tier default — configuration data an
admin can edit, with the priority→interval map itself stored in `app_settings` so
tuning cadence needs no workflow edit. After each run n8n writes
`next_run_at = now() + interval`.

Tiers 4 and 5 are extrapolated from your three examples to cover the full 1–5 priority
range; say the word if you want a different curve.

---

## 7. Retry strategy

Two layers, because they solve different failures.

**Layer 1 — transient, in-execution.** n8n node-level `retryOnFail` on every HTTP
node: 3 tries, 2s → 4s → 8s. Absorbs timeouts, 502s, and dropped connections without
involving the database.

**Layer 2 — persistent, cross-execution.** If a source still fails after layer 1, n8n
writes `retry_attempt + 1` and a backoff `next_retry_at`:

| Attempt | Delay | Cumulative |
|---|---|---|
| 1 | 5 min | 5 min |
| 2 | 15 min | 20 min |
| 3 | 45 min | ~1 h |
| 4 | 2 h | ~3 h |
| 5 | 6 h | ~9 h |

The dispatcher naturally picks the source back up once `next_retry_at` passes — no
separate retry queue is needed. On success, `retry_attempt`, `next_retry_at`, and
`consecutive_failures` reset to zero.

After 5 consecutive failures the source is marked `health_status = 'failing'` and an
alert fires. **It is not auto-deactivated** — silently dropping a gazette would create
a coverage gap nobody notices, which is worse than a noisy alert. Deactivation stays a
deliberate admin action.

The backoff table lives in `app_settings`, so tuning it is a settings edit.

---

## 8. Source health monitoring

Tracked per source, written by n8n at the end of every run:

| Signal | Column |
|---|---|
| Last successful execution | `last_success_at` |
| Last failure | `last_failure_at` |
| Failure reason | `last_failure_reason` |
| Execution duration | `last_duration_ms` |
| Items fetched | `last_items_fetched` |
| Items published | `last_items_published` |
| Items rejected | `last_items_rejected` |
| Consecutive failures | `consecutive_failures` |
| Rolled-up state | `health_status` |

`health_status` values, assigned by n8n:

- `never_run` — registered, not yet crawled
- `healthy` — last run succeeded
- `degraded` — 1–4 consecutive failures, or succeeded but fetched 0 items for 3+ runs
- `failing` — 5+ consecutive failures; alert raised

The snapshot on `sources` powers the dashboard in one query; `workflow_logs` keeps the
full history for trend and post-mortem. A daily health workflow summarises failing
sources and notifies.

---

## 9. Manual execution

An admin can trigger ingestion for one source, one country, or all sources.

```
Admin clicks "Run now"
   │
   ▼
Server Action (admin-guarded, server-only)
   │  POST  ${N8N_TRIGGER_WEBHOOK_URL}
   │  header X-Trigger-Secret: ${N8N_TRIGGER_SECRET}
   │  body   { scope: "source" | "country" | "all", sourceId?, country?, requestedBy }
   ▼
n8n Webhook node ─► verify secret ─► resolve source set ─► same ingestion path
                                                            as the scheduler
```

Design notes:

- This is a **trigger**, not orchestration. Next.js sends one signed message and gets
  back an acknowledgement; every decision after that belongs to n8n.
- The webhook URL and secret are server-side env vars, never `NEXT_PUBLIC_*`, and the
  Server Action is guarded by the admin role check before it fires.
- Manual runs reuse the identical ingestion path — no second code path to keep in
  sync — and are recorded with `trigger_type = 'manual'` plus the requesting user.
- A manual run **ignores** `next_run_at`/`next_retry_at` (that is the point) but still
  passes through the Publishing Gate unchanged. "Run now" cannot publish anything the
  scheduler would have rejected.
- Concurrency guard: a source already mid-run is skipped rather than run twice, so
  repeated clicking cannot stack executions.

---

## 10. Milestones

Each milestone ends with a green `npm run build` (and `tsc --noEmit` where relevant),
a commit, and a push. No milestone starts before the previous one is confirmed.

| # | Milestone | Output | Done when |
|---|---|---|---|
| **M1** | Project foundation | Next.js 15 + TS strict + Tailwind, RTL/Arabic base layout, lint config, `.env.example`, README skeleton | clean checkout builds |
| **M2** | Database schema | Migrations: extensions, enums, 6 tables, CHECK/FK/UNIQUE, indexes, `search_vector`, RLS policies + explicit REVOKEs. **No functions, no rule triggers.** | SQL applies top-to-bottom on empty Postgres; write-seal verified |
| **M3** | Source registry | Seed for every listed authority across SA/AE/KW/QA/BH/OM + GCC, with domains, parser types, `parser_config`, priorities | idempotent seed; per-country row counts verified |
| **M4** | Auth + app shell | Supabase server/browser/middleware clients, login, session + role guards, nav shell, generated `types/database.ts` | unauth redirects to `/login` |
| **M5** | Internal legal archive | `/updates` full-text search, country/category/type/date filters, timeline grouping, badges; `/updates/[id]` detail | filters + search work on seeded data |
| **M6** | Dashboard + health | Counts, by country, by category, **source health panel**, failing sources, last execution, recent updates — typed queries, no RPC | renders from live tables |
| **M7** | Admin: sources / users / settings | Source CRUD incl. parser config + priority, role assignment, `app_settings` editor — Server Actions + Zod | viewer blocked at UI *and* by RLS/grants |
| **M8** | n8n: scheduler + parsers | Priority dispatcher, due-source selection, four parser lanes converging on `RawItem`, PDF enrichment + Storage archive | workflow imports cleanly; each lane dry-run documented |
| **M9** | n8n: AI + publishing gate | AI classification, JSON validation, hash generation, `publishing-gate` sub-workflow, insert, `workflow_logs` write | gate rejects each of the 5 cases correctly |
| **M10** | n8n: retry, health, manual run | Two-layer retry/backoff, health snapshot writer, failing-source alert, signed manual-trigger webhook + admin "Run now" UI | manual run for source/country/all works end to end |
| **M11** | n8n: newsletter | Weekly digest grouped country → category, HTML template, send, `newsletter_history` write, `/newsletters` page | digest renders and records a history row |
| **M12** | Hardening + docs | Error boundaries, empty/loading states, deployment runbook, credential rotation notes, final verification | full build + typecheck green; runbook complete |

---

## 11. Change log from Revision 1

| # | Directive | Effect |
|---|---|---|
| 1 | Business rules out of Postgres | `ingest_legal_update()` and `dashboard_stats()` **removed**. DB keeps only UNIQUE / FK / CHECK / NOT NULL / indexes / RLS. Rules moved to the `publishing-gate` sub-workflow; dashboard uses typed queries. |
| 2 | `legal_updates` not writable from Next.js | No write policy **and** explicit REVOKE for `anon`/`authenticated` on `legal_updates`, `workflow_logs`, `newsletter_history`. Admin panel scoped to sources / users / settings. |
| 3 | Parser strategy | Four lanes (RSS/HTML/API/PDF) with per-source `parser_config`, converging on a normalized `RawItem`; PDF enrichment available to all lanes. |
| 4 | Source health monitoring | Nine health columns on `sources` + `health_status` rollup, plus full history in `workflow_logs` and a dashboard panel. |
| 5 | Retry strategy | Node-level retries for transient failures; persistent exponential backoff via `retry_attempt` / `next_retry_at`. |
| 6 | Priority scheduling | Hourly dispatcher, 1h/3h/6h/12h/24h tiers, per-source override, map stored in `app_settings`. |
| 7 | Manual execution | Signed n8n webhook + admin-guarded Server Action for source / country / all scope. |

**One deviation to confirm:** directive 2 names *settings* as an admin-managed area,
which requires an `app_settings` table — a sixth table against the original "five
tables" instruction. I judged it worth it: it is also where newsletter recipients,
the confidence threshold, the backoff schedule, and the priority→interval map now
live, which removes four hardcoded values from workflow JSON and makes them tunable
without a redeploy. Say the word if you would rather keep five tables and hold those
values in n8n environment variables instead.

---

## 12. Open decisions

Not blocking — confirmed at the milestone where each is needed.

1. **Mail transport** (M11): Microsoft 365 Graph by default, Gmail documented as a
   one-node swap.
2. **AI provider** (M9): contract is provider-agnostic; Claude by default, OpenAI
   variant documented.
3. **Arabic full-text search** (M2): Postgres ships no Arabic dictionary. Using the
   `simple` configuration plus `pg_trgm` for fuzzy matching — correct and
   dependency-free. Revisit only if recall proves insufficient in practice.
4. **Priority tiers 4 and 5** (§6): extrapolated to 12h/24h from your three examples.

---

## 13. Non-goals

Explicitly out of scope and will not appear in the codebase: public pages, SEO,
registration, comments, reactions, multi-tenancy, billing, GraphQL, microservices,
containers/orchestrators, message brokers, event bus, CQRS, or any second backend.
