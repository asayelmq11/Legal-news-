-- =============================================================================
-- 0021 — Hybrid discovery layer: registry and archive columns
--
-- Additive only. See 0020 for the enum types this uses and the rationale.
-- =============================================================================

alter table public.sources
  add column if not exists ingestion_mode public.ingestion_mode not null default 'official',
  add column if not exists confidence smallint,
  add column if not exists verification_method text,
  add column if not exists last_discovery_success timestamptz,
  add column if not exists last_official_success timestamptz,
  add column if not exists last_parser_success timestamptz;

comment on column public.sources.ingestion_mode is
  'How this source is reached: official (direct crawl of its own parser lane), discovery (a discovery engine like Google News — not an authority itself), or hybrid (an official source also supplemented by a scoped discovery feed).';
comment on column public.sources.confidence is
  '0-100. For discovery/hybrid sources, how reliable canonical-URL and official-source resolution has been for this feed. NULL for a source that has never resolved anything yet.';
comment on column public.sources.verification_method is
  'How the LAST resolution for this source was reached: domain_match (resolved domain is a known official allowed_domain), authority_name_match (title mentions a registered authority by name), direct_crawl (official lane, no resolution needed), or null.';
comment on column public.sources.last_discovery_success is
  'Last time this source (in discovery/hybrid mode) successfully fetched candidates from its discovery engine, independent of whether any candidate resolved to an official source.';
comment on column public.sources.last_official_success is
  'Last time a candidate from this source resolved to, or was fetched directly as, a genuine official source.';
comment on column public.sources.last_parser_success is
  'Last time this source''s own parser lane (rss/api/html/pdf) fetched successfully — the official-mode analogue of last_discovery_success, split out because a hybrid source has both.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sources_confidence_range') then
    alter table public.sources add constraint sources_confidence_range
      check (confidence is null or confidence between 0 and 100);
  end if;
end
$$;

alter table public.legal_updates
  add column if not exists origin_type public.origin_type not null default 'official',
  add column if not exists canonical_url text,
  add column if not exists discovery_engine text;

comment on column public.legal_updates.origin_type is
  'How THIS ITEM was found — official (direct crawl or resolved to a known official domain) or discovery (a discovery engine surfaced it and no official source could be resolved). Per item, not per source: a hybrid source can produce both in the same run.';
comment on column public.legal_updates.canonical_url is
  'The resolved official URL, when discovery + canonical resolution found one better than source_url. NULL when source_url is already the canonical official URL (the ordinary official-crawl case) or when no better URL could be found.';
comment on column public.legal_updates.discovery_engine is
  'Which discovery mechanism surfaced this item (e.g. google_news). NULL for origin_type = official.';
