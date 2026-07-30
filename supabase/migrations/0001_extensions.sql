-- =============================================================================
-- 0001 — Extensions
--
-- Supabase convention: extensions live in a dedicated `extensions` schema
-- rather than `public`. The schema is created here so the same migration runs
-- unchanged against a vanilla Postgres instance during local verification.
--
-- gen_random_uuid() is built into Postgres 13+, so pgcrypto is NOT needed.
-- =============================================================================

create schema if not exists extensions;

-- Trigram matching. Used for fuzzy/substring search on Arabic authority names
-- and titles, where full-text search alone would miss partial-word queries.
create extension if not exists pg_trgm with schema extensions;

comment on schema extensions is
  'Hosts Postgres extensions, keeping the public schema limited to application objects.';
