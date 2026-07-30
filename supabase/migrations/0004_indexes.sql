-- =============================================================================
-- 0004 — Indexes
--
-- Shaped by the four real access patterns:
--   1. archive browse/filter  — country / category / date, newest first
--   2. archive search         — Arabic full-text, plus fuzzy on title
--   3. scheduler              — "which active sources are due?"  (hot path,
--                               runs every hour)
--   4. dashboard              — health rollups and recent execution history
-- =============================================================================

-- --------------------------------------------------------------------------
-- legal_updates
-- --------------------------------------------------------------------------

-- Full-text search over the Arabic-normalised vector.
create index if not exists legal_updates_search_idx
  on public.legal_updates using gin (search_vector);

-- Fuzzy / substring title matching, for partial words that full-text misses.
create index if not exists legal_updates_title_trgm_idx
  on public.legal_updates using gin (title_ar extensions.gin_trgm_ops);

-- Keyword containment (`keywords && array['ضريبة']`). This is why keywords are
-- absent from search_vector — exact containment beats bag-of-words here.
create index if not exists legal_updates_keywords_idx
  on public.legal_updates using gin (keywords);

create index if not exists legal_updates_affected_entities_idx
  on public.legal_updates using gin (affected_entities);

-- Default archive ordering.
create index if not exists legal_updates_publication_date_idx
  on public.legal_updates (publication_date desc);

-- Filter-then-sort composites. Postgres can use these for both the filtered
-- and the sort phase, avoiding a re-sort of the whole table.
create index if not exists legal_updates_country_date_idx
  on public.legal_updates (country, publication_date desc);

create index if not exists legal_updates_category_date_idx
  on public.legal_updates (category, publication_date desc);

create index if not exists legal_updates_document_type_date_idx
  on public.legal_updates (document_type, publication_date desc);

-- "What did this source publish?" — source detail and health drill-down.
create index if not exists legal_updates_source_date_idx
  on public.legal_updates (source_id, publication_date desc);

-- Newsletter window selection: rows created during the digest period.
create index if not exists legal_updates_created_at_idx
  on public.legal_updates (created_at desc);

-- --------------------------------------------------------------------------
-- sources
-- --------------------------------------------------------------------------

-- Scheduler hot path (plan §6). Partial on `active` because the dispatcher
-- never considers inactive sources, which keeps the index small.
create index if not exists sources_due_idx
  on public.sources (priority, next_run_at)
  where active;

-- Retry sweep (plan §7).
create index if not exists sources_retry_idx
  on public.sources (next_retry_at)
  where active and next_retry_at is not null;

-- Dashboard: failing/degraded sources surfaced first.
create index if not exists sources_health_idx
  on public.sources (health_status)
  where active;

create index if not exists sources_country_idx
  on public.sources (country);

-- Admin search over Arabic authority names.
create index if not exists sources_authority_trgm_idx
  on public.sources using gin (authority_ar extensions.gin_trgm_ops);

-- --------------------------------------------------------------------------
-- workflow_logs
-- --------------------------------------------------------------------------

create index if not exists workflow_logs_started_at_idx
  on public.workflow_logs (started_at desc);

create index if not exists workflow_logs_source_started_idx
  on public.workflow_logs (source_id, started_at desc);

-- Failure triage. Partial, because successful runs are the overwhelming
-- majority and are never the thing being hunted for.
create index if not exists workflow_logs_failures_idx
  on public.workflow_logs (started_at desc)
  where status <> 'success';

-- --------------------------------------------------------------------------
-- newsletter_history
-- --------------------------------------------------------------------------

create index if not exists newsletter_history_period_idx
  on public.newsletter_history (period_start desc);

-- --------------------------------------------------------------------------
-- users
-- --------------------------------------------------------------------------

create index if not exists users_role_idx
  on public.users (role)
  where active;
