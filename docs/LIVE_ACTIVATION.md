# LIVE ACTIVATION RUNBOOK

Take the system from "locally verified" to "one real UAE legal update visible in
the UI". Execute from your own machine and your hosted n8n.

Every step is marked with where it runs:
**🖥️ TERMINAL** · **🗄️ SUPABASE** · **⚙️ N8N** · **▲ VERCEL** · **🌐 BROWSER**

> **Decisions locked for this activation**
> - Auto-publish, as originally specified. No manual review queue.
> - No new tables, no new features.
> - One source only: **UAE Legislation Platform** (`uaelegislation.gov.ae`).
> - No mail provider needed. Resend is not used anywhere in this repo.

---

## ⚠️ Two warnings before you start

**1. `npm run db:check` DESTROYS a database.** It runs
`drop database if exists … ; create database …` against a **local** Postgres. It
is the local test suite. **Never point it at Supabase.** Section C shows the
only safe way to run it.

**2. `DIRECT_URL` is not used by this project.** You asked for it; it is a Prisma
convention and this repo does not use Prisma. The only database URL any script
reads is `DATABASE_URL`, and only three developer scripts read it — the
application itself never connects to Postgres directly, only through the
Supabase REST API. Setting `DIRECT_URL` would have no effect.

---

# A. Required credentials

| Value | Where you get it | Goes in | Required? |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → Data API → Project URL | `.env.local` **and** Vercel | **Yes** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API Keys → `anon` `public` | `.env.local` **and** Vercel | **Yes** |
| `N8N_TRIGGER_WEBHOOK_URL` | You construct it: `https://<N8N_HOST>/webhook/legal-ingestion-run` | `.env.local` **and** Vercel | Yes — needed for the manual run in section G |
| `N8N_TRIGGER_SECRET` | You generate it (section A.1) | `.env.local`, Vercel, **and** n8n env var | Yes — same value in all three |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API Keys → `service_role` | **n8n credential ONLY** | **Yes** |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys | **n8n credential ONLY** | **Yes** |
| `DATABASE_URL` | Supabase → Connect → Session pooler URI | **Your shell only**, for 3 scripts. Never in `.env.local`, never in Vercel | Yes, for section E and type generation |

**Never needed:** Resend, SMTP, Microsoft 365. No mail is sent in this slice.

**The two keys that must never touch the web app:** `SUPABASE_SERVICE_ROLE_KEY`
bypasses RLS and is the only write path into the archive; `ANTHROPIC_API_KEY` is
billable. Both live in n8n credentials only. The app has no code path that reads
either — that is enforced by `lib/env.ts`, which does not define them.

### A.1 Generate the shared secret — 🖥️ TERMINAL

```bash
openssl rand -hex 32
```

Copy the output once. It goes in three places, identical each time:
`.env.local`, Vercel env vars, and the n8n environment variable
`N8N_TRIGGER_SECRET`. The app signs the manual-run request with it; workflow 04
compares it. A mismatch fails closed with `invalid_webhook_signature`.

---

# B. Supabase activation

### B.1 Create the project — 🗄️ SUPABASE

1. https://supabase.com/dashboard → **New project**
2. Region: choose one close to your users (e.g. `eu-central-1` or `me-central-1`)
3. Set a strong database password and store it in your password manager
4. Wait for provisioning to finish

### B.2 Retrieve connection values — 🗄️ SUPABASE

- **Project Settings → Data API** → copy **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
- **Project Settings → API Keys** → copy **`anon` `public`** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- **Project Settings → API Keys** → copy **`service_role`** → n8n only
- **Connect** (top bar) → **Session pooler** → copy the URI → `DATABASE_URL`

### B.3 Set `DATABASE_URL` for this shell — 🖥️ TERMINAL

```bash
export DATABASE_URL='postgresql://postgres.<SUPABASE_PROJECT_REF>:<DB_PASSWORD>@aws-0-<REGION>.pooler.supabase.com:5432/postgres'
```

Verify it connects before going further:

```bash
psql "$DATABASE_URL" -c 'select current_database(), version();'
```

### B.4 Apply all 17 migrations — 🖥️ TERMINAL

The migrations are ordinary SQL and idempotent. Three of them
(`0007`, `0010`, `0014`) contain **only** `ALTER TYPE … ADD VALUE`, because
Postgres refuses to use a new enum value in the transaction that created it.
Applying **one file per `psql` invocation** satisfies that, which is what this
loop does.

```bash
cd ~/legal-news
for f in supabase/migrations/*.sql; do
  echo "▶ applying $(basename "$f")"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f" || { echo "FAILED at $f"; break; }
done
echo "✅ all migrations applied"
```

> **Alternative — Supabase SQL Editor.** If you prefer the dashboard, open each
> file in `supabase/migrations/` in filename order and run them **one at a
> time**. Do not paste several files into one editor tab: `0007`, `0010` and
> `0014` must each commit before the file that uses their new enum values.

Re-running the whole loop is safe. Every migration uses
`create … if not exists`, `add column if not exists`, guarded `do $$` blocks, or
`on conflict do nothing`.

### B.5 Verify the schema — 🖥️ TERMINAL

Run all of these. Each prints what it found; compare against **Expected**.

```bash
# 8 tables
psql "$DATABASE_URL" -c "select tablename from pg_tables where schemaname='public' order by 1;"
```
**Expected exactly:** `app_settings`, `job_dead_letters`, `legal_updates`,
`newsletter_history`, `source_health_snapshots`, `sources`, `users`,
`workflow_logs`

```bash
# 14 enums
psql "$DATABASE_URL" -c "select typname, count(*) as values from pg_type t join pg_enum e on e.enumtypid=t.oid join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' group by 1 order by 1;"
```
**Expected 14 rows**, including `health_status` with **7** values and
`config_status` with **4**.

```bash
# indexes
psql "$DATABASE_URL" -c "select count(*) as indexes from pg_indexes where schemaname='public';"
```
**Expected:** 60 or more.

```bash
# constraints
psql "$DATABASE_URL" -c "select contype, count(*) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public' group by 1 order by 1;"
```
**Expected:** `c` (check) ≥ 30, `f` (foreign key) ≥ 6, `p` (primary key) = 8,
`u` (unique) ≥ 1.

```bash
# RLS active on every table
psql "$DATABASE_URL" -c "select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by 1;"
```
**Expected:** `relrowsecurity = t` for all 8.

```bash
# policies
psql "$DATABASE_URL" -c "select tablename, cmd, count(*) from pg_policies where schemaname='public' group by 1,2 order by 1,2;"
```
**Expected:** `legal_updates`, `workflow_logs`, `newsletter_history` and
`source_health_snapshots` each have **SELECT only** — no INSERT/UPDATE/DELETE row.

```bash
# functions and triggers
psql "$DATABASE_URL" -c "select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public';"
psql "$DATABASE_URL" -c "select count(*) as user_triggers from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal;"
```
**Expected:** exactly one function, `current_user_role`. **Zero** user triggers —
this system deliberately has none; all logic is in n8n.

```bash
# the archive write-seal — the single most important check
psql "$DATABASE_URL" -c "select has_table_privilege('authenticated','public.legal_updates','INSERT') as app_can_insert_archive;"
```
**Expected:** `f`. If this returns `t`, stop and re-apply `0005_access_control.sql`.

```bash
# seeded data
psql "$DATABASE_URL" -c "select count(*) as settings from public.app_settings;"
psql "$DATABASE_URL" -c "select count(*) as sources, count(*) filter (where active) as active from public.sources;"
```
**Expected:** 10 settings. 52 sources, **0 active** — nothing runs until you
verify and activate it in section F.

### B.6 Confirm nothing destructive happened — 🖥️ TERMINAL

```bash
psql "$DATABASE_URL" -c "select count(*) as archive_rows from public.legal_updates;"
```
**Expected:** `0` on a fresh project. The migrations only create; no migration
contains `drop table`, `drop column`, or `truncate`. Verify for yourself:

```bash
grep -riE "drop table|drop column|truncate|delete from" supabase/migrations/ || echo "✅ no destructive statements in any migration"
```

### B.7 Create the Storage bucket — 🗄️ SUPABASE

**Storage → New bucket** → name `legal-documents` → **Public: OFF** → Create.

Then **SQL Editor**:

```sql
create policy "internal users read legal documents"
on storage.objects for select to authenticated
using (
  bucket_id = 'legal-documents'
  and public.current_user_role() is not null
);
```

No insert policy: uploads come from n8n via `service_role`.

### B.8 Create the first admin — 🗄️ SUPABASE

There is no self-provisioning, so the first admin is a one-time manual step.

1. **Authentication → Users → Add user**
   - Email: `<YOUR_EMAIL_LOWERCASE>`
   - Password: set one
   - **Auto Confirm User: ON**
2. Copy the new user's **UID**
3. **SQL Editor** — substitute both values:

```sql
insert into public.users (id, email, full_name, role, active)
values ('<UID_FROM_STEP_2>', '<YOUR_EMAIL_LOWERCASE>', 'مسؤول النظام', 'admin', true);
```

The email **must be lowercase** — a CHECK constraint enforces it.

### B.9 Confirm admin access — 🖥️ TERMINAL

```bash
psql "$DATABASE_URL" -c "select email, role, active from public.users;"
```
**Expected:** one row, `role = admin`, `active = t`.

---

# C. Application setup — 🖥️ TERMINAL (macOS)

### C.1 Checkout

```bash
git clone https://github.com/asayelmq11/Legal-news-.git ~/legal-news
cd ~/legal-news
git checkout claude/legal-intelligence-platform-gekjci
```

### C.2 Node version

```bash
node --version   # must be >= 20.9.0; developed on 22.x
```

If it is older: `brew install node@22` or use `nvm install 22 && nvm use 22`.

### C.3 Install

```bash
npm install
```

### C.4 Create `.env.local`

```bash
cat > .env.local <<'EOF'
NEXT_PUBLIC_SUPABASE_URL=https://<SUPABASE_PROJECT_REF>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY>
N8N_TRIGGER_WEBHOOK_URL=https://<N8N_HOST>/webhook/legal-ingestion-run
N8N_TRIGGER_SECRET=<THE_HEX_SECRET_FROM_A.1>
EOF
```

`.env.local` is git-ignored. Confirm:

```bash
git check-ignore -v .env.local   # must print a .gitignore match
```

### C.5 Regenerate database types from YOUR schema

```bash
npm run db:types -- "$DATABASE_URL"
```
**Expected:** `types/database.ts written — 8 tables, 14 enums, 1 function(s)`

### C.6 Run the checks

```bash
npm run typecheck
npm run lint
npm run test          # expect: 276 passed
npm run build
```

**The SQL suite is separate and LOCAL ONLY:**

```bash
# ⚠️ DESTRUCTIVE — creates and drops a scratch database on a LOCAL Postgres.
# Requires: brew install postgresql@16 && brew services start postgresql@16
# NEVER set DATABASE_URL to Supabase while running this.
npm run db:check      # expect: ALL DATABASE CHECKS PASSED (105 assertions)
```

If you have no local Postgres, skip `db:check`. Section B.5 already verified the
real schema, which is what matters for activation.

### C.7 Start locally

```bash
npm run dev
```

🌐 Open **http://localhost:3000** → you will be redirected to
**http://localhost:3000/login** → sign in with the admin credentials from B.8.

**Expected after login:** the Arabic RTL dashboard, "إجمالي التحديثات المنشورة: 0",
and the admin nav — لوحة المتابعة · الأرشيف القانوني · النشرات · المصادر ·
التشغيل · المستخدمون · الإعدادات.

---

# D. n8n import and configuration — ⚙️ N8N

### D.1 Set the n8n environment variable

Workflow 04 reads `$env.N8N_TRIGGER_SECRET` to verify the manual-run signature.
Set it on the n8n host **before** importing, then restart n8n.

- **n8n Cloud:** Settings → Variables → add `N8N_TRIGGER_SECRET`
- **Self-hosted Docker:** add `- N8N_TRIGGER_SECRET=<THE_HEX_SECRET>` to the
  environment block, then `docker compose up -d`

If this is unset, every manual run is rejected with
`invalid_webhook_signature`. That is the intended fail-closed behaviour.

### D.2 Create the two credentials

**Credentials → Add credential → Supabase API**
- Name: **`Supabase (service_role)`** — the name must match exactly
- Host: `https://<SUPABASE_PROJECT_REF>.supabase.co`
- Service Role Secret: your `service_role` key

**Credentials → Add credential → Header Auth**
- Name: **`Anthropic API`** — the name must match exactly
- Header Name: `x-api-key`
- Header Value: your Anthropic API key

### D.3 Import the workflows

**Workflows → Import from File**, one at a time, in this order:

1. `n8n/workflows/03-publishing-gate.json`
2. `n8n/workflows/02-source-ingestion.json`
3. `n8n/workflows/04-retry-health-manual.json`
4. `n8n/workflows/01-source-scheduler.json`

Import 03 and 02 first so the later workflows have something to point at.

### D.4 Re-point the Execute Workflow nodes — required

n8n stores sub-workflow references by **internal ID**, which differs per
instance. The exported JSON carries a placeholder, so you must re-select the
target in four nodes:

| Open this workflow | Open this node | Set "Workflow" to |
|---|---|---|
| `02 — Source Ingestion` | **Publishing Gate** | `03 — Publishing Gate` |
| `01 — Source Scheduler` | **Run ingestion** | `02 — Source Ingestion` |
| `04 — Retry, Health and Manual Run` | **Re-run ingestion** | `02 — Source Ingestion` |
| `04 — Retry, Health and Manual Run` | **Manual ingestion** | `02 — Source Ingestion` |

Save each workflow after changing it. **Skipping this is the single most common
cause of "the manual run does nothing".**

### D.5 Assign credentials

Open each workflow and confirm every **Supabase** node shows
`Supabase (service_role)`, and the **Classify with AI** node in
`02 — Source Ingestion` shows `Anthropic API`. If a node shows a credential
warning, select the credential from the dropdown and save.

### D.6 Get the webhook URL

Open `04 — Retry, Health and Manual Run` → click **Manual run webhook** → copy
the **Production URL**. It will be:

```
https://<N8N_HOST>/webhook/legal-ingestion-run
```

This must match `N8N_TRIGGER_WEBHOOK_URL` in `.env.local` exactly. The
**Test URL** (`/webhook-test/…`) only works while you have the editor open with
"Listen for test event" active — do not use it in `.env.local`.

### D.7 Activate in this order

1. `03 — Publishing Gate` — **leave inactive.** It is a sub-workflow with an
   Execute Workflow trigger; it runs when called, and activation is not needed.
2. `02 — Source Ingestion` — **leave inactive**, same reason.
3. `04 — Retry, Health and Manual Run` — **ACTIVATE.** Required for the
   production webhook URL to respond and for the 15-minute retry/health sweep.
4. `01 — Source Scheduler` — **leave INACTIVE for now.** Activate it only after
   section G succeeds, or the hourly schedule will start crawling before you
   have verified anything.

---

# E. M7.5 egress verification — ⚙️ N8N HOST (terminal on that machine)

This must run from the machine that will do the crawling. Results from anywhere
else are meaningless: GCC government portals return `403` to datacentre IPs, so
a workflow that works on your laptop can fail entirely in service.

### E.1 Run it

```bash
# on the n8n host
git clone https://github.com/asayelmq11/Legal-news-.git /tmp/legal-news
cd /tmp/legal-news
git checkout claude/legal-intelligence-platform-gekjci
npm install --omit=dev pg
export DATABASE_URL='<SAME_SESSION_POOLER_URI_AS_B.3>'
node scripts/verify-egress.mjs "$DATABASE_URL" > /tmp/egress.md
cat /tmp/egress.md
```

### E.2 What success looks like

The UAE row must read:

```
| AE — UAE Legislation Platform | 200 | — | ok | … | … | reachable — configure parser |
```

`200` and `ok` mean the production egress can read the site.

**If it says `WAF/403 — likely datacentre IP block`:** the host cannot reach it.
Do **not** work around it. Record it, and either request an allow-list from the
authority for your egress IP, or pick a different source. Mark the source:

```sql
update public.sources set config_status = 'blocked_by_access'
 where authority_en = 'UAE Legislation Platform';
```

### E.3 Record the result

🖥️ On your machine, paste the contents of `/tmp/egress.md` into
`docs/EGRESS_VERIFICATION.md` under `## Results`, replacing the empty table, and
fill in the egress IP. Commit it — that file is the audit record of how access
was obtained.

---

# F. Configure the first real source — UAE Legislation

The source is **already seeded** with its identity, domains and priority. What is
missing — deliberately — is the parser configuration. Nothing was guessed.

### F.1 Current state — 🖥️ TERMINAL

```bash
psql "$DATABASE_URL" -c "select authority_ar, authority_en, country, source_type, base_url, allowed_domains, parser_type, parser_config, priority, active, config_status from public.sources where authority_en='UAE Legislation Platform';"
```

| Field | Seeded value |
|---|---|
| `authority_ar` | منصة التشريعات — الجريدة الرسمية |
| `authority_en` | UAE Legislation Platform |
| `country` | `AE` |
| `source_type` | `official_gazette` |
| `base_url` | `https://uaelegislation.gov.ae` |
| `allowed_domains` | `{uaelegislation.gov.ae, www.uaelegislation.gov.ae}` |
| `priority` | `1` → polled hourly |
| `parser_type` | `unknown` ← **you fill this in** |
| `parser_config` | `{}` ← **you fill this in** |
| `active` | `false` |
| `config_status` | `pending_verification` |

### F.2 Determine the extraction method — 🌐 BROWSER

**This is the one step that cannot be scripted, and must not be guessed.** A
selector that happens to match the wrong element fills a legal archive with
confidently wrong content attributed to a real ministry.

Open https://uaelegislation.gov.ae and, in order of preference:

1. **Look for a feed.** View source, search for
   `type="application/rss+xml"`. Also try `/rss`, `/feed`, `/ar/rss`. If one
   exists, use `parser_type = 'rss'` — most stable.
2. **Look for a JSON API.** DevTools → Network → filter XHR → reload the
   legislation listing. If a request returns JSON, note the endpoint and the
   field paths. Use `parser_type = 'api'`.
3. **Fall back to HTML.** DevTools → inspect the listing. Note the CSS selector
   for the repeating item container, and within it the title, link, date and
   body. Prefer semantic class names; a generated one like `.css-1x7f9k` will
   break on the next deploy. Use `parser_type = 'html'`.
4. **PDF index.** If the page is a list of `.pdf` links, use
   `parser_type = 'pdf'`.

### F.3 Apply the configuration — 🗄️ SUPABASE SQL Editor

Use the block matching what you found. Replace every `<…>`.

```sql
-- RSS
update public.sources
   set parser_type = 'rss',
       feed_url = '<FEED_URL_ON_uaelegislation.gov.ae>',
       parser_config = '{"date_field":"pubDate","content_field":"description"}'::jsonb,
       config_status = 'verified', updated_at = now()
 where authority_en = 'UAE Legislation Platform';
```

```sql
-- HTML listing
update public.sources
   set parser_type = 'html',
       parser_config = '{
         "list":  "<CSS_SELECTOR_FOR_EACH_ITEM>",
         "title": "<CSS_SELECTOR_FOR_TITLE>",
         "link":  "<CSS_SELECTOR_FOR_LINK>@href",
         "date":  "<CSS_SELECTOR_FOR_DATE>",
         "body":  "<CSS_SELECTOR_FOR_SUMMARY>"
       }'::jsonb,
       config_status = 'verified', updated_at = now()
 where authority_en = 'UAE Legislation Platform';
```

```sql
-- JSON API
update public.sources
   set parser_type = 'api',
       feed_url = '<API_ENDPOINT_ON_uaelegislation.gov.ae>',
       parser_config = '{
         "items_path":"<PATH.TO.ARRAY>", "title":"<FIELD>", "url":"<FIELD>",
         "date":"<FIELD>", "body":"<FIELD>", "headers":{}
       }'::jsonb,
       config_status = 'verified', updated_at = now()
 where authority_en = 'UAE Legislation Platform';
```

**Constraints that will stop you if something is wrong** — these are protections,
not obstacles:
- `feed_url`'s host must be in `allowed_domains`
- `rss`/`api` require a `feed_url`
- `html`/`pdf` require a non-empty `parser_config`
- `config_status='verified'` is refused while `parser_type='unknown'`

### F.4 Set the silence window and activate

```sql
-- A legislation portal publishes irregularly; a 7-day window stops it being
-- called "stale" simply because the UAE passed no federal law this week.
update public.sources
   set max_silence_minutes = 10080
 where authority_en = 'UAE Legislation Platform';

-- Activate. This FAILS unless config_status = 'verified'.
update public.sources
   set active = true, updated_at = now()
 where authority_en = 'UAE Legislation Platform';
```

### F.5 Confirm every other source is still disabled

```sql
select count(*) filter (where active) as active_sources,
       count(*) filter (where not active) as inactive_sources
  from public.sources;
```
**Expected:** `active_sources = 1`, `inactive_sources = 51`.

```sql
-- name the active one, to be certain
select authority_en, country, active, config_status from public.sources where active;
```
**Expected:** exactly `UAE Legislation Platform | AE | t | verified`.

You do not need to do anything to keep the others disabled — all 52 were seeded
`active = false`, and `sources_only_verified_active` refuses activation of
anything still `pending_verification`.

---

# G. First end-to-end execution

### G.1 Trigger it — 🌐 BROWSER

1. Go to **http://localhost:3000/ops**
2. Under **تشغيل يدوي** (Manual run):
   - النطاق (scope) → **مصدر واحد**
   - المصدر (source) → **منصة التشريعات — الجريدة الرسمية**
   - Leave **تشغيل قسري** unchecked
3. Click **بدء التشغيل** → confirm the dialog

**Expected:** a green message `بدأ التشغيل. معرّف المتابعة: <uuid>`. **Copy that
correlation ID.**

If the button is missing and you see a warning instead, `N8N_TRIGGER_WEBHOOK_URL`
or `N8N_TRIGGER_SECRET` is unset — fix `.env.local` and restart `npm run dev`.

### G.2 Watch it run — ⚙️ N8N

**Executions** (left sidebar). You will see, in order:

| Workflow | What it does |
|---|---|
| `04 — Retry, Health and Manual Run` | verifies the signature, resolves the scope, dispatches |
| `02 — Source Ingestion` | fetch → extract → normalise → classify → hash |
| `03 — Publishing Gate` | five rules → insert |

Open the `02` execution and step through the nodes:

| Node | Expected |
|---|---|
| **Parser router** | routes to the lane matching your `parser_type` |
| **Fetch …** | HTTP 200 with content |
| **… → RawItem** | one item per legislation entry |
| **Normalise RawItem** | items with a URL, a title, and a host on the allow-list |
| **Classify with AI** | Anthropic response containing a `content[0].text` JSON block |
| **Validate AI output** | `__rejected: false` |
| **SHA256 content hash** | a 64-character lowercase hex `content_hash` |
| **Publishing Gate** | `outcome: "published"` |
| **Write workflow log** | one row written |

### G.3 Note the IDs

From the n8n execution list, record the **`02 — Source Ingestion` execution ID**.
Then 🖥️:

```bash
psql "$DATABASE_URL" -c "select id, title_ar, publication_date, created_at from public.legal_updates order by created_at desc limit 1;"
```

Record that `id` — it is your first inserted update.

### G.4 See it in the UI — 🌐 BROWSER

- **http://localhost:3000** → "إجمالي التحديثات المنشورة" is now ≥ 1
- **http://localhost:3000/updates** → the update appears, grouped by publication
  date, with country / category / document-type / legal-status badges
- Click it → the detail page shows the Arabic title, the AI summary, the dates,
  and **فتح المصدر الرسمي ↗** linking to `uaelegislation.gov.ae`

There is **no approval step**. The item is live the moment the gate accepts it —
that is the specified behaviour.

---

# H. Verification queries — 🖥️ TERMINAL

```bash
# 1. source state after the run
psql "$DATABASE_URL" -c "select authority_en, active, config_status, health_status, health_score, last_run_at, last_success_at, consecutive_failures, last_error_code from public.sources where authority_en='UAE Legislation Platform';"
```
**Expected:** `active=t`, `config_status=verified`, `consecutive_failures=0`,
`last_error_code` null.

```bash
# 2. the inserted update
psql "$DATABASE_URL" -c "select id, title_ar, country, category, document_type, legal_status, publication_date, effective_date, created_at from public.legal_updates order by created_at desc limit 5;"
```

```bash
# 3. AI metadata
psql "$DATABASE_URL" -c "select id, ai_model, confidence, is_legal_update, array_length(keywords,1) as keywords, array_length(affected_entities,1) as entities from public.legal_updates order by created_at desc limit 5;"
```
**Expected:** `ai_model = claude-sonnet-5`, `confidence >= 0.90`,
`is_legal_update = t`.

```bash
# 4. publication date is real, never the fetch time
psql "$DATABASE_URL" -c "select id, publication_date, created_at::date as inserted_on, (publication_date = created_at::date) as suspiciously_equal from public.legal_updates order by created_at desc limit 5;"
```
If `suspiciously_equal` is `t` for everything, check the source genuinely
publishes same-day. The pipeline never substitutes the fetch time — an item with
no date is rejected as `no_publication_date`.

```bash
# 5. content hash shape
psql "$DATABASE_URL" -c "select id, content_hash, length(content_hash) as len, content_hash ~ '^[a-f0-9]{64}$' as valid_sha256 from public.legal_updates order by created_at desc limit 5;"
```
**Expected:** `len = 64`, `valid_sha256 = t`.

```bash
# 6. no duplicates
psql "$DATABASE_URL" -c "select content_hash, count(*) from public.legal_updates group by 1 having count(*) > 1;"
```
**Expected:** zero rows.

```bash
# 7. health snapshot  (appears after workflow 04's 15-minute sweep)
psql "$DATABASE_URL" -c "select taken_at, classification, health_score, window_runs, fetch_success_rate, gate_acceptance_rate, duplicate_rate, stale from public.source_health_snapshots s join public.sources src on src.id=s.source_id where src.authority_en='UAE Legislation Platform' order by taken_at desc limit 5;"
```

```bash
# 8. lock released
psql "$DATABASE_URL" -c "select authority_en, lock_owner, lock_expires_at, (lock_expires_at > now()) as still_locked from public.sources where authority_en='UAE Legislation Platform';"
```
**Expected:** `lock_owner` null, or `still_locked = f`.

```bash
# 9. execution log
psql "$DATABASE_URL" -c "select workflow_name, execution_id, trigger_type, status, items_fetched, items_published, items_rejected, rejection_reasons, duration_ms, started_at from public.workflow_logs order by started_at desc limit 10;"
```
**Expected:** `trigger_type = manual`, `status = success`,
`items_published >= 1`.

```bash
# 10. admin edit attribution
psql "$DATABASE_URL" -c "select s.authority_en, u.email as last_edited_by, s.updated_at from public.sources s left join public.users u on u.id=s.updated_by where s.authority_en='UAE Legislation Platform';"
```

---

# I. Controlled failure test

**Purpose:** prove a permanent error is not retried, produces a dead letter, and
is visible in `/ops` — without corrupting anything.

**Why this failure:** a `404` on the source's *own* domain keeps the host inside
`allowed_domains` (so the CHECK constraint stays satisfied) while guaranteeing a
real, permanent HTTP error. Nothing else changes.

### I.1 Break it — 🗄️ SUPABASE

```sql
-- record the real value first so you can restore it exactly
select base_url, feed_url from public.sources where authority_en='UAE Legislation Platform';

update public.sources
   set base_url = 'https://uaelegislation.gov.ae/__activation-test-404',
       feed_url = case when feed_url is null then null
                       else 'https://uaelegislation.gov.ae/__activation-test-404' end
 where authority_en = 'UAE Legislation Platform';
```

### I.2 Run it — 🌐 BROWSER

`/ops` → manual run → same source → **بدء التشغيل**

### I.3 Verify — 🖥️ TERMINAL

```bash
# the run failed and is recorded
psql "$DATABASE_URL" -c "select workflow_name, status, items_fetched, items_published, error_message, started_at from public.workflow_logs order by started_at desc limit 3;"

# a 404 is PERMANENT: no next_retry_at is scheduled
psql "$DATABASE_URL" -c "select authority_en, consecutive_failures, retry_attempt, next_retry_at, last_error_code, last_failure_reason from public.sources where authority_en='UAE Legislation Platform';"

# a dead letter exists, with no credentials in the payload
psql "$DATABASE_URL" -c "select stage, error_code, attempt_number, max_attempts, state, item_url, payload from public.job_dead_letters order by created_at desc limit 3;"

# the archive is untouched — the failure created no partial row
psql "$DATABASE_URL" -c "select count(*) as archive_rows from public.legal_updates;"
```

**Expected:**
- `workflow_logs.status` = `failed` or `partial`
- `retry_attempt` does **not** climb toward 5 and `next_retry_at` stays null —
  a `404` will still be a `404` in five minutes
- one `job_dead_letters` row, `state = open`, `payload` containing **no**
  `authorization`, `api_key` or token key (a CHECK constraint rejects those)
- `archive_rows` unchanged from section G

🌐 **http://localhost:3000/ops** shows: عناصر متعثّرة مفتوحة ≥ 1, the failure in
إخفاقات، and the source classification moving toward متدهور.

### I.4 Restore

```sql
update public.sources
   set base_url = '<THE_ORIGINAL_base_url_FROM_I.1>',
       feed_url = <THE_ORIGINAL_feed_url_FROM_I.1_OR_NULL>,
       consecutive_failures = 0, retry_attempt = 0,
       next_retry_at = null, last_error_code = null, last_failure_reason = null
 where authority_en = 'UAE Legislation Platform';
```

Then mark the dead letter resolved from 🌐 `/ops` — enter a note such as
`activation test, restored` and click **وسم كمُعالَج**. The original failure
record is preserved; only the lifecycle fields change.

---

# J. Duplicate test

**Purpose:** prove a second run of the same item inserts nothing, is classified
as a duplicate, and does **not** damage source health.

### J.1 Record the baseline — 🖥️ TERMINAL

```bash
psql "$DATABASE_URL" -c "select count(*) as archive_rows from public.legal_updates;"
psql "$DATABASE_URL" -c "select health_score, health_status, consecutive_failures from public.sources where authority_en='UAE Legislation Platform';"
```

### J.2 Run the same source again — 🌐 BROWSER

`/ops` → manual run → same source → **بدء التشغيل**

### J.3 Verify — 🖥️ TERMINAL

```bash
# row count is UNCHANGED
psql "$DATABASE_URL" -c "select count(*) as archive_rows from public.legal_updates;"

# still no duplicate hashes
psql "$DATABASE_URL" -c "select content_hash, count(*) from public.legal_updates group by 1 having count(*) > 1;"

# the run counted them as duplicates
psql "$DATABASE_URL" -c "select status, items_fetched, items_published, items_rejected, rejection_reasons from public.workflow_logs order by started_at desc limit 1;"

# health is NOT penalised
psql "$DATABASE_URL" -c "select health_score, health_status, consecutive_failures from public.sources where authority_en='UAE Legislation Platform';"
```

**Expected:**
- `archive_rows` identical to J.1
- zero duplicate hashes
- `status = success`, `items_published = 0`,
  `rejection_reasons = {"duplicate": N}`
- `health_score` and `consecutive_failures` **unchanged**

That last point is the one worth confirming: a duplicate is a normal outcome of
a working source, and the health model deliberately excludes duplicates, gate
rejections and empty runs from the score.

---

# K. Vercel deployment — ▲ VERCEL

**Only after G, H, I and J have all passed.**

### K.1 Push your branch

```bash
cd ~/legal-news
git add docs/EGRESS_VERIFICATION.md types/database.ts
git commit -m "chore: record egress verification and regenerate types for production schema"
git push origin claude/legal-intelligence-platform-gekjci
```

### K.2 Import

1. https://vercel.com/new → **Import Git Repository** → `asayelmq11/Legal-news-`
2. **Framework Preset:** Next.js (auto-detected)
3. **Root Directory:** `./`
4. **Production Branch:** `claude/legal-intelligence-platform-gekjci`
   (Settings → Git → Production Branch, if it defaults to `main`)
5. Do **not** deploy yet — add the environment variables first

### K.3 Environment variables

Settings → Environment Variables. Add all four to **Production**, **Preview**
and **Development**:

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<SUPABASE_PROJECT_REF>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | your `anon` key |
| `N8N_TRIGGER_WEBHOOK_URL` | `https://<N8N_HOST>/webhook/legal-ingestion-run` |
| `N8N_TRIGGER_SECRET` | the hex secret from A.1 |

**Do not add** `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY` or
`DATABASE_URL`. The app reads none of them, and `lib/env.ts` would reject
unknown behaviour anyway. Adding the service-role key to a web app would defeat
the archive write-seal.

### K.4 Deploy

**Deployments → Deploy.** Wait for the build. Note the production URL:
`https://<PROJECT>.vercel.app`.

### K.5 Update Supabase auth URLs — 🗄️ SUPABASE

**Authentication → URL Configuration**
- Site URL: `https://<PROJECT>.vercel.app`
- Redirect URLs: add `https://<PROJECT>.vercel.app/**`

### K.6 n8n callback URLs — ⚙️ N8N

Nothing to change. n8n never calls the application: the flow is one-way, app →
n8n webhook → Supabase. The app reads results from Supabase. The only URL that
matters is the webhook URL you already configured in D.6, and it is unchanged by
deployment.

### K.7 Production smoke tests — 🌐 BROWSER

1. `https://<PROJECT>.vercel.app` → redirects to `/login`
2. Sign in with the B.8 admin → dashboard loads with the real count
3. `/updates` → the update from section G is listed
4. Click it → detail page renders, official source link works
5. `/ops` → **بدء التشغيل** on UAE Legislation → new n8n execution appears
6. Re-run H query 9 → a new `workflow_logs` row with `trigger_type = manual`
7. Sign out → confirm `/updates` redirects to `/login`

### K.8 Turn on the schedule — ⚙️ N8N

Only once K.7 passes: activate **`01 — Source Scheduler`**. UAE Legislation is
priority 1, so it will be polled hourly from then on.

---

# 📋 FAST PATH

The minimum to see the first real legal update in the UI.

| # | Where | Do this |
|---|---|---|
| 1 | 🖥️ | `openssl rand -hex 32` → save as `<SECRET>` |
| 2 | 🗄️ | Create project. Copy **Project URL**, **anon key**, **service_role key**, **Session pooler URI** |
| 3 | 🖥️ | `export DATABASE_URL='<pooler-uri>'` |
| 4 | 🖥️ | `for f in supabase/migrations/*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"; done` |
| 5 | 🖥️ | Verify: `psql "$DATABASE_URL" -c "select count(*) from pg_tables where schemaname='public';"` → **8** |
| 6 | 🗄️ | Auth → Add user (auto-confirm) → copy UID → SQL Editor → `insert into public.users … role 'admin'` (B.8) |
| 7 | 🖥️ | `git clone … && cd … && git checkout claude/legal-intelligence-platform-gekjci && npm install` |
| 8 | 🖥️ | Write `.env.local` with URL, anon key, `https://<N8N_HOST>/webhook/legal-ingestion-run`, `<SECRET>` |
| 9 | 🖥️ | `npm run db:types -- "$DATABASE_URL"` then `npm run build` |
| 10 | ⚙️ | Set n8n env `N8N_TRIGGER_SECRET=<SECRET>`, restart n8n |
| 11 | ⚙️ | Create credentials `Supabase (service_role)` and `Anthropic API` (exact names) |
| 12 | ⚙️ | Import 03 → 02 → 04 → 01 |
| 13 | ⚙️ | **Re-point 4 Execute Workflow nodes** (D.4) — most-missed step |
| 14 | ⚙️ | Activate **04 only** |
| 15 | ⚙️ host | `node scripts/verify-egress.mjs "$DATABASE_URL"` → UAE row must say `ok` |
| 16 | 🌐 | Open uaelegislation.gov.ae, find the feed or selectors (F.2) |
| 17 | 🗄️ | Run the matching `update … set parser_type … config_status='verified'` (F.3) |
| 18 | 🗄️ | `update public.sources set active=true where authority_en='UAE Legislation Platform';` |
| 19 | 🖥️ | `npm run dev` → 🌐 http://localhost:3000 → sign in |
| 20 | 🌐 | `/ops` → manual run → UAE Legislation → **بدء التشغيل** |
| 21 | 🌐 | `/updates` → **the first real legal update is live** |

Steps 13, 15 and 16 are where activations usually stall. Everything else is
mechanical.
