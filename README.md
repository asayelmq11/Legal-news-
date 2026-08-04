# منصة الرصد القانوني الخليجي — Legal Intelligence Platform

Internal platform for the Legal Department. Continuously monitors official
legal and regulatory sources across the GCC, classifies and summarizes
updates with AI, and publishes them to a searchable internal archive.

**Internal system.** No public pages, no registration, no SEO, no billing. A
small internal tool: Login, a dashboard of legal updates, and an admin
section (Sources / Users / Settings). Nothing else.

---

## Architecture

Three components. n8n is the only orchestrator.

| Component | Owns | Never does |
|---|---|---|
| **n8n** | Scheduling, crawling, parsing, AI classification, publishing rules, notifications | — |
| **Supabase** | Postgres, Auth, Storage, RLS. Integrity constraints only | Hold business rules |
| **Next.js** | Dashboard, archive, search, admin (sources / users / settings) | Write `legal_updates`. Orchestrate anything |

`legal_updates` is write-sealed against the web application: no write policy
exists for `authenticated`, and INSERT/UPDATE/DELETE are explicitly revoked.
Only n8n, holding the `service_role` key, writes the archive.

n8n's own setup and the workflow architecture — three workflows in substance,
five files — is in [`n8n/README.md`](n8n/README.md).

---

## Requirements

- Node.js >= 20.9 (developed on 22.x)
- A Supabase project
- An n8n instance that can reach Supabase and Azure OpenAI

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
| `npm run test` | vitest |
| `npm run verify` | typecheck → lint → test → build. **This is what CI runs.** |
| `npm run db:check` | applies all migrations to a scratch Postgres and runs the SQL assertion suite |
| `npm run db:types` | regenerates `types/database.ts` from a live schema |

Next 16 no longer runs ESLint during `next build`, which is why `verify` exists
as a separate composite step rather than relying on the build alone.

### Diagnosing a sign-in that does not stick

```bash
AUTH_DEBUG=1 npm run dev
```

Prints one line per stage of the sign-in — how many cookies the Supabase client
asked to write, whether the write succeeded, how many session cookies the action
ended up with, and how many the next request carried. Counts, booleans, request
paths and error class names only: no cookie names, no values, no tokens, no
credentials.

When Supabase itself rejects the sign-in, the error name, code, HTTP status and
a scrubbed message are logged **whether or not `AUTH_DEBUG` is set** — unless it
is simply a wrong password, which is expected and stays silent. Alongside it
goes a project-binding line proving whether `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` name the same project:

```
[auth] sign-in rejected by Supabase: name=AuthApiError code=invalid_api_key status=401 message="Invalid API key"
[auth] project binding: urlRef=dd65eea0 keyRef=2b96dd70 match=false keyRole=anon
```

`urlRef` and `keyRef` are truncated SHA-256 digests, never the refs themselves.
`keyRole` comes from the key's own `role` claim — anything other than `anon`
means a privileged key has been put somewhere it will reach the browser.

---

## Secrets

The web application needs only the Supabase URL and anon key — both safe for the
browser, because every table is protected by RLS.

These belong in **n8n Credentials** and must never appear in `.env.local`, in
`app_settings`, or in committed files:

- `SUPABASE_SERVICE_ROLE_KEY` — bypasses RLS; sole write path to the archive
- Azure OpenAI API key (`Azure OpenAI account` credential — see `n8n/README.md` §2)

A **password-recovery URL is a credential.** Its fragment carries a live access
token and refresh token, so it must never be pasted into a chat, a ticket, or a
log. If one is exposed, send a fresh recovery email — that invalidates the old
link — and use **Authentication → Users → ⋯ → Sign out user** to revoke any
session it may already have created.

---

## Project layout

```
app/
  (app)/            authenticated shell — guarded by requireActiveUser()
  login/            sign-in (no self-provisioning)
  update-password/  where a Supabase recovery link lands (public)
  no-access/        unprovisioned, deactivated and auth-unavailable states
  unauthorized/     insufficient role
  configuration-error/  missing environment, fails closed
components/         UI primitives and feature components
lib/
  auth/             session resolution, role guards, sign-in/out, recovery
  admin/            sources / users / settings admin queries + actions
  queries/          server-only typed reads (no raw SQL)
  search/           Arabic normalisation — contract shared with Postgres
  updates/          filter parsing, external-link verification
  supabase/         browser / server / proxy clients
  sources/          source status derivation
  discovery/         Google News discovery matching logic
  constants/        country and taxonomy registries, Arabic labels
  settings/         the closed app_settings allow-list
  env.ts            validated server environment (server-only)
  nav.ts            role-aware navigation
proxy.ts            Next 16 proxy — session refresh + coarse redirect
scripts/            database type generator
tests/              vitest suite
types/database.ts   GENERATED from the live schema
supabase/
  migrations/         ordered SQL — integrity constraints only
  fixtures/           dev-only fake data — NEVER applied to production
  tests/              SQL verification suite
n8n/                  importable workflow JSON + setup guide
docs/                 egress verification, source provisioning, discovery architecture
```

`lib/constants/` is the source of truth for the country and taxonomy values
that become Postgres enums and constrained AI outputs. Changing a value means
changing both together.

## Schema

Four tables: `users`, `sources`, `legal_updates`, `app_settings`. See
`supabase/migrations/0023_simplify_platform.sql` for what was removed —
execution history, health snapshots, dead-letter queue, the manual-run
idempotency ledger, and the newsletter — and why (that operational machinery
served admin UI this platform no longer has; retries are now n8n's own
per-node `retryOnFail`, not a database-backed queue).
