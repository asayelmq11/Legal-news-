# Supabase — schema, deployment and verification

Four tables, one access-control function, zero triggers, zero business logic.

Source registry contents and the activation procedure are in
[`SOURCE_REGISTRY.md`](SOURCE_REGISTRY.md).

```
migrations/
  0001_extensions.sql       extensions schema + pg_trgm
  0002_enums.sql            enums (mirror lib/constants/*)
  0003_tables.sql           the original six tables + integrity constraints
  0004_indexes.sql          indexes
  0005_access_control.sql   role predicate, RLS policies, grants, REVOKEs
  0006_seed_app_settings.sql  operational defaults, idempotent
  0007_parser_type_unknown.sql  adds parser_type 'unknown' (must stay alone)
  0008_source_config_status.sql config_status + registry integrity
  0009_seed_sources.sql       52 trusted sources, all pending verification
  0010_config_status_values.sql  adds blocked_by_access / requires_subscription
  0011_source_registry_flags.sql exclusion groups, authority checks, access states
  0012_archive_query_indexes.sql legal_status + effective_date filter indexes
  0013_source_attribution.sql    sources.updated_by
  0014_health_status_values.sql  (superseded by 0023 — health_status dropped)
  0015_ops_columns.sql           (superseded by 0023 — ops columns dropped)
  0016_health_snapshots.sql      (superseded by 0023 — table dropped)
  0017_dead_letters.sql          (superseded by 0023 — table dropped)
  0018_manual_run_dispatch.sql   (superseded by 0023 — table dropped)
  0019_run_status_empty.sql      (superseded by 0023 — run_status dropped)
  0020_hybrid_discovery.sql      discovery enums
  0021_discovery_columns.sql     discovery columns on sources/legal_updates
  0022_discovery_seed.sql        Google News discovery pseudo-sources
  0023_simplify_platform.sql     drops workflow_logs / source_health_snapshots /
                                  job_dead_letters / manual_run_dispatches /
                                  newsletter_history, the ops columns on
                                  sources, and the settings only those fed —
                                  see the migration's own header for why
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
  run_local_checks.sh       applies everything and runs the suite
```

Migrations 0014–0019 are kept as history (never rewritten — that would break
migration ordering for anyone who already applied them) even though 0023
undoes what they added. The table/enum names above are current; a migration
whose only content has since been dropped is noted as superseded rather than
deleted from this list.

---

## What the database does and does not do

| Postgres enforces | Postgres does NOT enforce |
|---|---|
| `content_hash` is UNIQUE | whether a duplicate is an error or a skip — n8n decides |
| `confidence` is between 0 and 1, when present (nullable — Azure classification does not produce one) | whether something is legally relevant — n8n's AI call and Publishing Gate |
| `allowed_domains` is non-empty and lowercase | whether a URL matches it — n8n Publishing Gate |
| a source with archived updates cannot be deleted | retries — n8n's own per-node `retryOnFail`, not a database queue |
| who may read or write each table | what gets published — n8n |

The only function in the schema is `public.current_user_role()`, an
access-control predicate. See the header comment in `0005_access_control.sql`
for why Postgres RLS leaves no alternative.

---

## Local verification

Requires a running Postgres (tested on 16.13) and permission to create
databases. Applies every migration twice, then loads dev fixtures and runs
the SQL assertion suite plus a TypeScript/SQL normalisation parity check.

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

### 3a. Register the password-recovery redirect

**Authentication → URL Configuration → Redirect URLs**, add:

```
http://localhost:3000/update-password
https://<your-production-host>/update-password
```

Supabase redirects only to URLs on this list. Without the entry, a recovery
link falls back to the Site URL and lands on `/login`, where the session sits
unusable in the URL fragment. There is no self-service reset: an administrator
sends the email from **Authentication → Users → ⋯ → Send password recovery**.

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
| `ingestion.priority_intervals` | `{1:60,2:180,3:360,4:720,5:1440}` | fallback |
| `ingestion.retry_backoff_minutes` | `[5,15,45,120,360]` | fallback |
| `app.timezone` | `"Asia/Riyadh"` | fallback |

That's the whole registry — three settings. `ai.confidence_threshold`,
`ingestion.failure_alert_threshold`, `health.stale_after_minutes`,
`health.empty_run_threshold`, and the three `newsletter.*` keys were dropped
in `0023_simplify_platform.sql` along with the features that read them.

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

Run `supabase/tests/run_local_checks.sh` against a scratch Postgres. It
asserts, among other things:

- exactly the four approved tables; no triggers; exactly one function
- RLS enabled everywhere
- the archive table has no write policy **and** no write grant for app users
- `anon` holds no privilege on any table
- credential-shaped setting keys rejected
- migrations apply twice with no error; re-seeding preserves tuned values
- integrity constraints reject: out-of-range priority, feed-less RSS source,
  uppercase domain, empty domain list, non-HTTP URL, out-of-range confidence,
  malformed hash, blank title
- a row with `confidence = null` **is** storable — the AI classifier no
  longer produces one at all
- duplicate `content_hash` rejected by UNIQUE
- a source with archived updates cannot be deleted
- Arabic search matches across hamza and teh-marbuta variants, and the
  un-normalised form correctly misses
- viewer, admin, deactivated admin, unprovisioned user and `anon` each see
  exactly what they should; a viewer cannot self-promote to admin
- `service_role` can write the archive and update source state
