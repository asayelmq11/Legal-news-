-- =============================================================================
-- 0014 — health_status gains the M10 classifications
--
-- Alone in its file: Postgres refuses to use a new enum value in the
-- transaction that added it. Same rule as 0007 and 0010.
-- =============================================================================

alter type public.health_status add value if not exists 'stale';
alter type public.health_status add value if not exists 'disabled';
alter type public.health_status add value if not exists 'unverified';
