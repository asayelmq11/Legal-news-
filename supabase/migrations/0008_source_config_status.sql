-- =============================================================================
-- 0008 — Source configuration status and registry integrity
--
-- Adds the "pending configuration" marker required by M3, plus the integrity
-- constraints that make a bad registry entry impossible rather than merely
-- discouraged.
--
-- Still integrity only. Nothing here decides what to crawl, when, or what to
-- publish — it only forbids incoherent rows, e.g. a source that claims to be
-- live while admitting nobody has worked out how to read it.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'config_status') then
    create type public.config_status as enum ('pending_verification', 'verified');
  end if;
end
$$;

alter table public.sources
  add column if not exists config_status public.config_status not null default 'pending_verification';

comment on column public.sources.config_status is
  'verified = a human confirmed the domain, the parser type and the selectors against the live site. pending_verification = registered but not yet readable; cannot be activated.';

-- New sources start switched off. A source becomes live only when someone has
-- verified it and deliberately enables it — fail closed, consistent with the
-- rest of the platform.
alter table public.sources alter column active set default false;

-- --------------------------------------------------------------------------
-- Registry integrity
-- --------------------------------------------------------------------------

do $$
begin
  -- An unverified source must never be active. This is the constraint that
  -- makes "pending configuration" meaningful rather than advisory.
  if not exists (select 1 from pg_constraint where conname = 'sources_no_active_pending') then
    alter table public.sources add constraint sources_no_active_pending
      check (not (active and config_status = 'pending_verification'));
  end if;

  -- A verified source must have a real parser type and a non-empty config for
  -- the parser types that need one. 'rss' needs only feed_url, already
  -- required by sources_feed_required.
  if not exists (select 1 from pg_constraint where conname = 'sources_verified_has_parser') then
    alter table public.sources add constraint sources_verified_has_parser
      check (config_status <> 'verified' or parser_type <> 'unknown');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'sources_verified_html_pdf_config') then
    alter table public.sources add constraint sources_verified_html_pdf_config
      check (
        config_status <> 'verified'
        or parser_type not in ('html', 'pdf')
        or parser_config <> '{}'::jsonb
      );
  end if;

  /*
   * The hostname of base_url must appear in allowed_domains.
   *
   * Without this, a registry entry could point at one domain while trusting a
   * different one — precisely the mismatch the Publishing Gate exists to
   * catch. Enforcing it here means the gate can never be handed an incoherent
   * source in the first place.
   *
   * regexp_match is IMMUTABLE, so this is legal in a CHECK. Note the
   * comparison is exact: 'www.example.gov.sa' and 'example.gov.sa' are
   * different hosts and both must be listed if both are used.
   */
  if not exists (select 1 from pg_constraint where conname = 'sources_base_url_domain_trusted') then
    alter table public.sources add constraint sources_base_url_domain_trusted
      check (
        allowed_domains @> array[ lower((regexp_match(base_url, '^https?://([^/:?#]+)'))[1]) ]
      );
  end if;

  -- Same for feed_url when present.
  if not exists (select 1 from pg_constraint where conname = 'sources_feed_url_domain_trusted') then
    alter table public.sources add constraint sources_feed_url_domain_trusted
      check (
        feed_url is null
        or allowed_domains @> array[ lower((regexp_match(feed_url, '^https?://([^/:?#]+)'))[1]) ]
      );
  end if;
end
$$;

-- --------------------------------------------------------------------------
-- Uniqueness — the registry must not accumulate duplicates
-- --------------------------------------------------------------------------

-- Natural key: one entry per authority per country. Also the conflict target
-- that makes the seed idempotent.
create unique index if not exists sources_country_authority_key
  on public.sources (country, authority_en);

-- Two entries pointing at the identical URL are a duplicate, not two sources.
create unique index if not exists sources_base_url_key
  on public.sources (base_url);

create unique index if not exists sources_feed_url_key
  on public.sources (feed_url)
  where feed_url is not null;

-- Surfacing unconfigured sources in the admin panel (M7).
create index if not exists sources_config_status_idx
  on public.sources (config_status);
