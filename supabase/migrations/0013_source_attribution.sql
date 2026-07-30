-- =============================================================================
-- 0013 — Attribution for source edits
--
-- `sources` already records updated_at. It does not record WHO. Changing a
-- source's domains, parser or active flag alters what the platform ingests and
-- attributes to a named authority, so those edits need an author.
--
-- ┌─ WHY NOT AN AUDIT TABLE, AND WHY NOT workflow_logs ────────────────────────┐
-- │ A seventh table is out of scope, and workflow_logs does not fit: its       │
-- │ columns describe an ingestion RUN — workflow_name, trigger_type, status,   │
-- │ items_fetched/published/rejected, duration. An admin editing a polling     │
-- │ interval is not a run, and forcing it into that shape would mean           │
-- │ meaningless zeros in every counter and a status that is neither success    │
-- │ nor failure. That corrupts the operational metrics the dashboard computes  │
-- │ from the same table.                                                       │
-- │                                                                            │
-- │ updated_by + updated_at answers "who last changed this, and when", which   │
-- │ is what the milestone asks for. It does NOT give change history; if a full │
-- │ audit trail is ever needed, that is a deliberate decision with its own     │
-- │ table, not something to smuggle into a log of workflow executions.         │
-- └────────────────────────────────────────────────────────────────────────────┘
-- =============================================================================

alter table public.sources
  add column if not exists updated_by uuid references public.users (id) on delete set null;

comment on column public.sources.updated_by is
  'Admin who last edited this source. Set by the M7 Server Actions; n8n leaves it untouched when writing health state.';
