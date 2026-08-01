# Supabase — schema, deployment and verification

Eight tables, one access-control function, zero triggers, zero business logic.

Source registry contents and the activation procedure are in
[`SOURCE_REGISTRY.md`](SOURCE_REGISTRY.md).

```
migrations/
  0001_extensions.sql       extensions schema + pg_trgm
  0002_enums.sql            11 enums (mirror lib/constants/*)
  0003_tables.sql           the six tables + integrity constraints
  0004_indexes.sql          28 indexes
  0005_access_control.sql   role predicate, RLS policies, grants, REVOKEs
  0006_seed_app_settings.sql  10 operational defaults, idempotent
  0007_parser_type_unknown.sql  adds parser_type 'unknown' (must stay alone)
  0008_source_config_status.sql config_status + registry integrity
  0009_seed_sources.sql       52 trusted sources, all pending verification
  0010_config_status_values.sql  adds blocked_by_access / requires_subscription
  0011_source_registry_flags.sql exclusion groups, authority checks, access states
  0012_archive_query_indexes.sql legal_status + effective_date filter indexes
  0013_source_attribution.sql    sources.updated_by
  0014_health_status_values.sql  stale / disabled / unverified
  0015_ops_columns.sql           locks, retry metadata, staleness, alerts
  0016_health_snapshots.sql      source_health_snapshots (7th table)
  0017_dead_letters.sql          job_dead_letters (8th table)
fixtures/
  dev_legal_updates.sql     DEV ONLY — invented content, never a migration
tests/
  00_bootstrap_local.sql    LOCAL ONLY — stubs auth schema + roles
  01_schema_checks.sql      structure, constraints, Arabic search
  02_rls_checks.sql         access control as each role
  03_source_registry_checks.sql  registry validation (see SOURCE_REGISTRY.md)
  04_archive_query_checks.sql    search, filters, index usage, pagination
  05_dashboard_checks.sql        aggregation, bucket totals, bounded reads
  06_admin_checks.sql            admin mutations, guards, activation gates
  07_ops_checks.sql              locks, dead letters, health snapshots
  run_local_checks.sh       applies everything and runs both suites
```

---

## What the database does and does not do

| Postgres enforces | Postgres does NOT enforce |
|---|---|
| `content_hash` is UNIQUE | whether a duplicate is an error or a skip — n8n decides |
| `confidence` is between 0 and 1 | the `>= 0.90` publishing threshold — n8n Publishing Gate |
| `allowed_domains` is non-empty and lowercase | whether a URL matches it — n8n Publishing Gate |
| a source with archived updates cannot be deleted | when to retry, back off, or alert — n8n |
| who may read or write each table | what gets published — n8n |

The only function in the schema is `public.current_user_role()`, an
access-control predicate. See the header comment in `0005_access_control.sql`
for why Postgres RLS leaves no alternative.

---

## Local verification

Requires a running Postgres (tested on 16.13) and permission to create
databases. Applies every migration twice, then loads dev fixtures and runs 105 assertions plus a TypeScript/SQL normalisation parity check.

```bash
supabase/tests/run_local_checks.sh
```

`00_bootstrap_local.sql` stubs what Supabase normally provides — the `auth`
schema, `auth.uid()`, and the `anon` / `authenticated` / `service_role` roles.
**Never run it against Supabase.** Only `migrations/` is deployed.

---

## Deploying to Supabase

### 1. Apply the migrations

With the Supabase CLI:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

Or paste each file, in filename order, into the SQL Editor. They are idempotent,
so a partial re-run is safe.

### 2. Notes specific to Supabase

**`auth.users`, the three roles, and `auth.uid()` already exist.** The migrations
assume them and never create them.

**`pg_trgm` goes in the `extensions` schema**, matching Supabase convention.
Index definitions qualify the operator class as `extensions.gin_trgm_ops`, so
they do not depend on `search_path`.

**`revoke usage on schema public from anon` is intentional.** It means an
unauthenticated PostgREST request fails at the schema level rather than relying
on RLS alone. This is a deliberate hardening for a platform with no public
surface. Sign-in still works — GoTrue does not go through PostgREST. After
deploying, confirm an anonymous REST call returns an error.

**Postgres version.** Verified on 16.13; Supabase currently runs 15 or 17. Every
feature used (generated columns, `gen_random_uuid()`, GIN, RLS, partial indexes)
is available on 13+, so no version-specific behaviour is involved.

**`updated_at` is not maintained by a trigger** — the schema has no triggers at
all. Writers set it explicitly: n8n on `sources`, the M7 Server Action on
`app_settings`.

### 3. Create the first admin — required, and a chicken-and-egg

There is no self-provisioning: an authenticated Supabase user with no
`public.users` row has no access to anything, and only an admin can create
rows. So the first admin must be inserted manually, once.

1. **Authentication → Users → Add user** in the Supabase dashboard. Create the
   account and copy its UID.
2. Run in the SQL Editor, substituting both values:

```sql
insert into public.users (id, email, full_name, role, active)
values ('<uid-from-step-1>', '<email-in-lowercase>', 'اسم المسؤول', 'admin', true);
```

Every later user is added through the admin panel (M7). The email must be
lowercase — a CHECK constraint enforces it.

To verify the seal is intact after deployment, run as that admin:

```sql
-- must fail with insufficient_privilege
insert into public.legal_updates (source_id, content_hash, source_url, title_ar,
  summary_ar, country, category, document_type, legal_status, is_legal_update,
  confidence, publication_date, raw_excerpt, ai_model)
values (gen_random_uuid(), repeat('a',64), 'https://x.gov.sa/1', 'ع', 'ع', 'SA',
        'tax', 'circular', 'enacted', true, 0.99, current_date, 'ع', 'manual');
```

### 4. Storage bucket for archived documents

`legal_updates.document_path` points at a Storage object. Create a **private**
bucket named `legal-documents` (Storage → New bucket, public **off**), then:

```sql
-- authenticated internal users may read archived documents
create policy "internal users read legal documents"
on storage.objects for select to authenticated
using (
  bucket_id = 'legal-documents'
  and public.current_user_role() is not null
);
```

No insert policy: uploads come from n8n via `service_role`, matching the write
seal on `legal_updates` itself.

### 5. Wire up n8n

Copy **Project Settings → API → `service_role`** into n8n Credentials. It
bypasses RLS and is the only write path into the archive.

It must never appear in `.env.local`, in `app_settings`, in a client bundle, or
in this repository. The `app_settings_no_secret_keys` CHECK constraint rejects
credential-shaped key names as a backstop, but the real control is not putting
it there.

---

## Settings reference

Seeded by `0006`. Admin-only for read *and* write; there is no INSERT or DELETE
policy, so a new key requires a migration — that is the database half of "no
arbitrary keys from the UI".

| Key | Default | Missing behaviour |
|---|---|---|
| `ai.confidence_threshold` | `0.90` | **fail closed** — gate rejects everything |
| `ingestion.failure_alert_threshold` | `5` | fallback |
| `ingestion.priority_intervals` | `{1:60,2:180,3:360,4:720,5:1440}` | fallback |
| `ingestion.retry_backoff_minutes` | `[5,15,45,120,360]` | fallback |
| `health.stale_after_minutes` | `1440` | fallback |
| `health.empty_run_threshold` | `3` | fallback |
| `newsletter.enabled` | `false` | fallback |
| `newsletter.recipients` | `[]` | **fail closed** — run aborts |
| `newsletter.schedule` | `{day:0,hour:7}` | fallback |
| `app.timezone` | `"Asia/Riyadh"` | fallback |

`newsletter.enabled` ships **false** so no mail can go out before recipients are
deliberately configured.

---

## Arabic search

Postgres has no Arabic dictionary, so `legal_updates.search_vector` is a
generated column over text normalised for the orthographic variation that makes
naive Arabic search miss obvious hits:

| Folded | To |
|---|---|
| `أ إ آ ٱ` | `ا` |
| `ؤ` | `و` |
| `ئ ى` | `ي` |
| `ة` | `ه` |
| tashkeel `U+064B–U+0652`, `U+0670`, tatweel `U+0640` | removed |

Weighting is title `A`, summary `B`.

**A query term must be normalised the same way or it will not match.** The
stored vector holds `ضريبه`, so a raw `ضريبة` finds nothing. The M5 query layer
wraps this so callers cannot forget; check 15 in `01_schema_checks.sql` asserts
both directions.

`keywords` is deliberately **not** in the vector: casting an array to text is
not `IMMUTABLE` and cannot appear in a generated column. Keywords get a GIN
array index instead, which gives exact containment (`keywords && array['ضريبة']`)
— a better fit than bag-of-words.

Trigram indexes on `legal_updates.title_ar` and `sources.authority_ar` cover
partial-word and fuzzy matching that full-text search misses.

---

## Verified locally

105 assertions, all passing against Postgres 16.13:

- six tables exactly; no triggers; exactly one function
- RLS enabled on all six tables
- archive tables have no write policy **and** no write grant
- `anon` holds no privilege on any table
- credential-shaped setting keys rejected
- migrations apply twice with no error; re-seeding preserves tuned values
- integrity constraints reject: out-of-range priority, feed-less RSS source,
  uppercase domain, empty domain list, non-HTTP URL, out-of-range confidence,
  malformed hash, blank title
- a `confidence = 0.10` row **is** storable — proving the threshold is n8n's
  job, not the database's
- duplicate `content_hash` rejected by UNIQUE
- a source with archived updates cannot be deleted
- Arabic search matches across hamza and teh-marbuta variants, and the
  un-normalised form correctly misses
- viewer, admin, deactivated admin, unprovisioned user and `anon` each see
  exactly what they should; a viewer cannot self-promote to admin
- `service_role` can write archive, logs, newsletter and health state
