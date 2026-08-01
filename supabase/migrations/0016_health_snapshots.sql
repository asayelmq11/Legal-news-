-- =============================================================================
-- 0016 — source_health_snapshots  (NEW TABLE, 7th)
--
-- Health is computed from a WINDOW of executions, not from the last one. A
-- single failed run is not a failing source, and a single success does not
-- clear a week of failures — so the calculation needs its own record rather
-- than living in the sources row alone.
--
-- Append-only history so the dashboard can show change over time. Nothing here
-- is ever updated or deleted by the application.
-- =============================================================================

create table if not exists public.source_health_snapshots (
  id         uuid primary key default gen_random_uuid(),
  source_id  uuid not null references public.sources (id) on delete cascade,
  taken_at   timestamptz not null default now(),

  -- rolled-up state at the moment of the snapshot
  classification public.health_status not null,
  health_score   smallint not null,

  enabled  boolean not null,
  verified boolean not null,
  stale    boolean not null,

  last_checked_at    timestamptz,
  last_success_at    timestamptz,
  last_item_found_at timestamptz,

  consecutive_failures integer not null default 0,
  dead_job_count       integer not null default 0,

  -- rates over the sampled window, 0..1
  window_runs             integer not null default 0,
  fetch_success_rate      numeric(4,3),
  extraction_success_rate numeric(4,3),
  ai_success_rate         numeric(4,3),
  gate_acceptance_rate    numeric(4,3),
  duplicate_rate          numeric(4,3),

  avg_response_ms  integer,
  last_http_status integer,
  last_error_code  text,
  last_error_message text,

  constraint health_snapshot_score_range check (health_score between 0 and 100),
  constraint health_snapshot_rates_valid check (
    (fetch_success_rate      is null or fetch_success_rate      between 0 and 1) and
    (extraction_success_rate is null or extraction_success_rate between 0 and 1) and
    (ai_success_rate         is null or ai_success_rate         between 0 and 1) and
    (gate_acceptance_rate    is null or gate_acceptance_rate    between 0 and 1) and
    (duplicate_rate          is null or duplicate_rate          between 0 and 1)
  ),
  constraint health_snapshot_counts_non_negative check (
    consecutive_failures >= 0 and dead_job_count >= 0 and window_runs >= 0
  )
);

comment on table public.source_health_snapshots is
  'Append-only health history. One row per source per snapshot run; never updated, never deleted by the app.';

create index if not exists health_snapshots_source_time_idx
  on public.source_health_snapshots (source_id, taken_at desc);

create index if not exists health_snapshots_time_idx
  on public.source_health_snapshots (taken_at desc);

-- Read-only to the application; only n8n (service_role) writes.
alter table public.source_health_snapshots enable row level security;
revoke all on public.source_health_snapshots from anon, authenticated;
grant select on public.source_health_snapshots to authenticated;
grant all on public.source_health_snapshots to service_role;

drop policy if exists health_snapshots_select on public.source_health_snapshots;
create policy health_snapshots_select on public.source_health_snapshots
  for select to authenticated
  using (public.current_user_role() is not null);
