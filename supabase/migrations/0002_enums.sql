-- =============================================================================
-- 0002 — Enums
--
-- These MUST stay in step with lib/constants/countries.ts and
-- lib/constants/taxonomy.ts, which are the TypeScript source of truth and the
-- constrained value set given to the AI in the M9 prompt. Changing a value
-- means changing all three together.
--
-- Idempotency: `create type` has no IF NOT EXISTS form, so each is guarded by a
-- catalogue lookup.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'country_code') then
    create type public.country_code as enum ('SA', 'AE', 'KW', 'QA', 'BH', 'OM', 'GCC');
  end if;

  if not exists (select 1 from pg_type where typname = 'source_type') then
    create type public.source_type as enum (
      'official_gazette', 'government', 'regulator', 'approved_news', 'gcc'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'parser_type') then
    create type public.parser_type as enum ('rss', 'html', 'api', 'pdf');
  end if;

  if not exists (select 1 from pg_type where typname = 'document_type') then
    create type public.document_type as enum (
      'law', 'royal_decree', 'ministerial_decision', 'executive_regulation',
      'circular', 'regulatory_framework', 'official_notice', 'court_precedent',
      'consultation_draft', 'other'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'legal_category') then
    create type public.legal_category as enum (
      'tax', 'customs', 'employment', 'corporate', 'financial', 'capital_markets',
      'banking', 'data_privacy', 'cybersecurity', 'competition',
      'intellectual_property', 'litigation', 'licensing', 'real_estate',
      'energy', 'healthcare', 'trade', 'general'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'legal_status') then
    create type public.legal_status as enum (
      'enacted', 'effective', 'draft', 'amended', 'repealed', 'pending'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'health_status') then
    create type public.health_status as enum ('never_run', 'healthy', 'degraded', 'failing');
  end if;

  if not exists (select 1 from pg_type where typname = 'run_status') then
    create type public.run_status as enum ('success', 'partial', 'failed');
  end if;

  if not exists (select 1 from pg_type where typname = 'trigger_type') then
    create type public.trigger_type as enum ('scheduled', 'manual', 'retry');
  end if;

  if not exists (select 1 from pg_type where typname = 'newsletter_status') then
    create type public.newsletter_status as enum ('sent', 'failed', 'skipped');
  end if;

  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('admin', 'viewer');
  end if;
end
$$;
