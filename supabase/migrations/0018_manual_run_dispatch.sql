-- =============================================================================
-- 0018 — Async manual-run dispatch
--
-- Workflow 04's manual-run webhook used to hold the connection open until
-- Workflow 02 (ingestion, AI classification, publishing) finished, which
-- routinely exceeded the Next.js server-action timeout. It now answers
-- immediately with HTTP 202 and dispatches Workflow 02 without waiting.
--
-- Two additive changes support that:
--
--   1. workflow_logs.correlation_id — so the row Workflow 02 eventually writes
--      can be matched back to the manual-run request that started it.
--
--   2. manual_run_dispatches (NEW TABLE, 9th) — an idempotency ledger. A
--      retried request carrying the SAME correlation_id (a client retry after
--      a dropped connection, a resent webhook call) finds its prior acceptance
--      here and is answered with the ORIGINAL outcome instead of dispatching
--      Workflow 02 a second time. Only accepted dispatches are recorded —
--      a rejected or empty-scope request had no side effect to deduplicate.
-- =============================================================================

alter table public.workflow_logs
  add column if not exists correlation_id text;

comment on column public.workflow_logs.correlation_id is
  'Set for manual runs dispatched through the async webhook (0018). Lets the caller match this row back to the request that started it; null for scheduled/retry runs.';

create index if not exists workflow_logs_correlation_id_idx
  on public.workflow_logs (correlation_id)
  where correlation_id is not null;

create table if not exists public.manual_run_dispatches (
  correlation_id text primary key,
  scope           text not null,
  source_id       uuid references public.sources (id) on delete set null,
  reason          text,
  accepted_sources jsonb not null default '[]'::jsonb,
  skipped_sources  jsonb not null default '[]'::jsonb,
  requested_by    uuid references public.users (id) on delete set null,
  accepted_at     timestamptz not null default now(),

  constraint manual_run_dispatches_accepted_sources_is_array check (
    jsonb_typeof(accepted_sources) = 'array'
  ),
  constraint manual_run_dispatches_skipped_sources_is_array check (
    jsonb_typeof(skipped_sources) = 'array'
  )
);

comment on table public.manual_run_dispatches is
  'Idempotency ledger for the async manual-run webhook (0018). One row per accepted correlation_id — a retry that reuses it is answered from this row instead of dispatching Workflow 02 again.';

create index if not exists manual_run_dispatches_source_idx
  on public.manual_run_dispatches (source_id, accepted_at desc);

-- Read for any signed-in user (ops dashboard visibility); only n8n
-- (service_role) ever writes here. No update/delete grant to anyone — a
-- dispatch record is either present or it is not, and is never edited.
alter table public.manual_run_dispatches enable row level security;
revoke all on public.manual_run_dispatches from anon, authenticated;
grant select on public.manual_run_dispatches to authenticated;
grant all on public.manual_run_dispatches to service_role;

drop policy if exists manual_run_dispatches_select on public.manual_run_dispatches;
create policy manual_run_dispatches_select on public.manual_run_dispatches
  for select to authenticated
  using (public.current_user_role() is not null);
