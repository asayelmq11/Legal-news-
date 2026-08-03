-- =============================================================================
-- 0019 — run_status gains 'empty'
--
-- Workflow 02 ("Build empty run summary") has always intended to write
-- status='empty' for a run that fetched cleanly but produced nothing
-- normalisable — "This is a successful run, logged as such, not silently
-- dropped" (see the node's own comment). The run_status enum was never
-- extended to match, so every such run has been failing the workflow_logs
-- insert with `invalid input value for enum run_status: "empty"` since M8 —
-- discovered while dry-run testing a real candidate source (M12 provisioning)
-- whose feed fetches cleanly but yields zero normalisable items.
--
-- Postgres cannot add an enum value inside the same transaction that later
-- uses it, so this is its own migration.
-- =============================================================================

alter type public.run_status add value if not exists 'empty';
