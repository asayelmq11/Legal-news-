-- =============================================================================
-- 0020 — Hybrid discovery layer
--
-- The 52-source registry proved that requiring a dedicated, hand-derived
-- parser for every authority does not scale: most GCC government portals
-- sit behind WAFs, use legacy ASP.NET/SharePoint stacks with no feed, or are
-- simply unreachable from n8n's egress (see docs/source-provisioning-
-- 2026-08-02.md). This migration is purely additive — every existing table,
-- column, row, and constraint from M2–M12 is untouched. It adds:
--
--   1. `ingestion_mode` on sources — official | discovery | hybrid. This is
--      DELIBERATELY a different column from the existing `source_type`
--      (which classifies the AUTHORITY: gazette/government/regulator/gcc/
--      approved_news). `ingestion_mode` classifies the STRATEGY used to
--      reach it. A source can be a `regulator` (source_type) reached via
--      `official` crawling (ingestion_mode) — the two are orthogonal.
--
--   2. Registry columns the discovery layer needs to report its own health
--      separately from a source's ordinary crawl health: confidence,
--      verification_method, last_discovery_success, last_official_success,
--      last_parser_success.
--
--   3. `origin_type` / `canonical_url` / `discovery_engine` on legal_updates
--      — per ITEM, not per source, because a `hybrid` source can have some
--      items found officially and others via discovery in the same run.
--
--   4. `discovery_engine` value catalogue is exactly one row wide today
--      (Google News) — see lib/discovery/*.ts and n8n/workflows/
--      05-discovery-ingestion.json. Bing News requires a paid Azure
--      Cognitive Services subscription key that is not available in this
--      environment; documented as a known gap, not silently skipped.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'ingestion_mode') then
    create type public.ingestion_mode as enum ('official', 'discovery', 'hybrid');
  end if;
  if not exists (select 1 from pg_type where typname = 'origin_type') then
    create type public.origin_type as enum ('official', 'discovery');
  end if;
  -- Discovery pseudo-sources are not an authority classification the M3
  -- registry anticipated; extend it rather than misusing 'approved_news'.
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'source_type' and e.enumlabel = 'discovery_engine'
  ) then
    alter type public.source_type add value 'discovery_engine';
  end if;
end
$$;
