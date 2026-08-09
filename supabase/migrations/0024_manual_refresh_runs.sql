-- =============================================================================
-- 0024 — Manual catch-up refresh: ingestion_runs
--
-- The platform drops its schedulers entirely (hourly source scheduler, every-
-- 2-hours discovery scheduler). The ONLY ingestion trigger left is the
-- dashboard's manual refresh button, which must behave as a CATCH-UP
-- refresh: fetch everything published since the last successful refresh, not
-- a fixed "last N hours" window.
--
-- That requires one small piece of state the platform does not otherwise
-- have: where the last successful refresh left off, and whether one is
-- running right now. This is NOT the operational execution-history/health
-- system removed in 0023 — one row per manual refresh invocation, three jobs:
--
--   1. Single-flight lock — the partial unique index below allows at most one
--      'running' row at a time. A concurrent trigger request is rejected by
--      the database itself, not only by client-side button disabling.
--   2. Completion polling — the dashboard polls the latest row's status
--      instead of holding the HTTP request open for the whole n8n run.
--   3. The checkpoint — the next refresh's window starts where the latest
--      *succeeded* row's window ended (window_to), with a safety overlap
--      applied by the caller. A run that fails never gets to 'succeeded', so
--      a half-finished refresh cannot silently advance the checkpoint and
--      create a coverage gap.
-- =============================================================================

create table if not exists public.ingestion_runs (
  id             uuid primary key default gen_random_uuid(),
  status         text not null default 'running',
  window_from    timestamptz not null,
  window_to      timestamptz not null,
  started_at     timestamptz not null default now(),
  completed_at   timestamptz,
  items_inserted integer,
  error_message  text,
  requested_by   uuid references public.users (id) on delete set null,
  correlation_id text,

  constraint ingestion_runs_status_values check (status in ('running', 'succeeded', 'failed')),
  constraint ingestion_runs_window_ordered check (window_to >= window_from),
  constraint ingestion_runs_completion_matches_status check (
    (status = 'running' and completed_at is null)
    or (status in ('succeeded', 'failed') and completed_at is not null)
  )
);

comment on table public.ingestion_runs is
  'One row per manual catch-up refresh (dashboard button). Backs the single-flight lock, completion polling, and the last-successful-refresh checkpoint (latest succeeded row''s window_to) — not an execution-history/health system.';
comment on column public.ingestion_runs.window_from is
  'Start of the catch-up window this run covers — the previous succeeded run''s window_to minus a safety overlap, or an initial lookback when there is no prior successful run.';
comment on column public.ingestion_runs.items_inserted is
  'Count of legal_updates rows actually published this run, aggregated from Workflow 02''s per-source summaries. Null until the run completes.';

-- Singleton-row trick: a unique index on a constant expression, restricted by
-- a partial WHERE, allows at most one row where status = 'running' to exist
-- at once — the database-level half of duplicate-click prevention. The
-- client button disabling is the other half; this is the one that still
-- holds under a race (two tabs, a retried request).
create unique index if not exists ingestion_runs_one_active
  on public.ingestion_runs ((1))
  where status = 'running';

-- Only succeeded rows are ever read to compute the checkpoint.
create index if not exists ingestion_runs_succeeded_window_idx
  on public.ingestion_runs (window_to desc)
  where status = 'succeeded';

create unique index if not exists ingestion_runs_correlation_id_idx
  on public.ingestion_runs (correlation_id)
  where correlation_id is not null;

alter table public.ingestion_runs enable row level security;

revoke all on public.ingestion_runs from anon, authenticated;
grant select on public.ingestion_runs to authenticated;
grant all on public.ingestion_runs to service_role;

-- Read for any signed-in user (the dashboard's own "is a refresh running /
-- when did one last succeed" query); only n8n (service_role) ever writes.
drop policy if exists ingestion_runs_select on public.ingestion_runs;
create policy ingestion_runs_select on public.ingestion_runs
  for select to authenticated
  using (public.current_user_role() is not null);
