-- =============================================================================
-- 0023 — Simplify the platform to its four core tables
--
-- The platform is being reduced to an internal tool: Login, Dashboard, and an
-- Admin section (Sources / Users / Settings). Everything operational —
-- execution history, health snapshots, dead-letter queue admin, the async
-- manual-run idempotency ledger, and the newsletter — is removed. n8n keeps
-- its own per-node retry (HTTP Request "Retry On Fail") instead of a
-- database-backed dead-letter/health system.
--
-- users, sources, legal_updates and app_settings remain the whole schema.
-- legal_updates keeps its full column set (document_type, legal_status,
-- effective_date, keywords, affected_entities, confidence, ai_model, etc.) —
-- that is legal-domain data, not operational complexity, and none of it is
-- destroyed. Only the UI surface was simplified (see the app-side changes in
-- this commit); the archive stays queryable in full.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Drop the four operational tables and the newsletter table. CASCADE takes
-- their policies, grants and indexes with them.
-- -----------------------------------------------------------------------------
drop table if exists public.workflow_logs cascade;
drop table if exists public.source_health_snapshots cascade;
drop table if exists public.job_dead_letters cascade;
drop table if exists public.manual_run_dispatches cascade;
drop table if exists public.newsletter_history cascade;

-- -----------------------------------------------------------------------------
-- Strip the operational columns bolted onto `sources` in 0003/0015. What
-- remains: identity, parser config, schedule, allow-list, discovery columns
-- (0021), and three plain fields — last_success_at / last_failure_at /
-- last_failure_reason — kept as a simple "is this source working" signal on
-- the admin Sources page. No health score, no lock, no alert cooldown, no
-- per-run item counters.
-- -----------------------------------------------------------------------------
alter table public.sources
  drop column if exists health_status,
  drop column if exists last_run_at,
  drop column if exists last_duration_ms,
  drop column if exists last_items_fetched,
  drop column if exists last_items_published,
  drop column if exists last_items_rejected,
  drop column if exists consecutive_failures,
  drop column if exists retry_attempt,
  drop column if exists next_retry_at,
  drop column if exists lock_owner,
  drop column if exists lock_acquired_at,
  drop column if exists lock_expires_at,
  drop column if exists first_attempt_at,
  drop column if exists last_error_code,
  drop column if exists max_silence_minutes,
  drop column if exists last_alert_kind,
  drop column if exists last_alert_at,
  drop column if exists health_score,
  drop column if exists last_http_status;

-- -----------------------------------------------------------------------------
-- Enums that only served the dropped tables/columns.
-- -----------------------------------------------------------------------------
drop type if exists public.health_status;
drop type if exists public.run_status;
drop type if exists public.newsletter_status;
drop type if exists public.trigger_type;
drop type if exists public.dead_letter_stage;
drop type if exists public.dead_letter_state;

-- -----------------------------------------------------------------------------
-- Retire the settings that only the removed features consumed: the AI
-- confidence gate (the platform no longer rejects on low confidence — an
-- Azure classification of is_legal_update=true is stored outright), the
-- health/alert thresholds, and the newsletter block.
-- -----------------------------------------------------------------------------
delete from public.app_settings where key in (
  'ai.confidence_threshold',
  'ingestion.failure_alert_threshold',
  'health.stale_after_minutes',
  'health.empty_run_threshold',
  'newsletter.enabled',
  'newsletter.recipients',
  'newsletter.schedule'
);

-- -----------------------------------------------------------------------------
-- The Azure classifier's output contract is deliberately smaller than
-- Claude's was: is_legal_update, title, summary, category, country. No
-- confidence, no document_type, no legal_status, no effective_date, no
-- keywords/affected_entities. Those columns stay — existing rows keep their
-- data, and the archive detail page still renders them when present — but
-- new rows will not populate them, so the NOT NULL constraints have to go.
-- -----------------------------------------------------------------------------
alter table public.legal_updates
  alter column document_type drop not null,
  alter column legal_status drop not null,
  alter column confidence drop not null;
