-- =============================================================================
-- 0011 — Registry flags: mutual exclusion, authority checks, access states
--
-- Integrity only. These constraints forbid incoherent or unsafe rows; they do
-- not decide anything.
-- =============================================================================

-- --------------------------------------------------------------------------
-- Mutual exclusion: sources that may be mirrors of each other
--
-- Two sources publishing the same instrument under different URLs produce two
-- different content_hash values — the hash includes the URL, so deduplication
-- CANNOT catch it and the archive would carry the same law twice. Until a
-- human confirms which of a candidate pair is canonical, at most one may be
-- active.
-- --------------------------------------------------------------------------
alter table public.sources
  add column if not exists exclusion_group text;

comment on column public.sources.exclusion_group is
  'Sources suspected of mirroring one another share a group label. At most one member may be active at a time — see sources_one_active_per_exclusion_group.';

create unique index if not exists sources_one_active_per_exclusion_group
  on public.sources (exclusion_group)
  where active and exclusion_group is not null;

-- --------------------------------------------------------------------------
-- Authority verification for non-government domains
--
-- A .gov domain carries an implicit assurance that a .com or .org does not.
-- Sources on commercial domains must be confirmed as the genuine authority
-- before anything they publish is trusted.
-- --------------------------------------------------------------------------
alter table public.sources
  add column if not exists requires_authority_check boolean not null default false;

comment on column public.sources.requires_authority_check is
  'The domain is not a government TLD; a human must confirm it is the genuine authority before activation.';

-- --------------------------------------------------------------------------
-- Only a verified source may be active
--
-- Replaces the earlier constraint, which only excluded pending_verification.
-- With four possible statuses, an allow-list is safer than a deny-list: a
-- status added later is inactive by default rather than accidentally live.
-- --------------------------------------------------------------------------
alter table public.sources drop constraint if exists sources_no_active_pending;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sources_only_verified_active') then
    alter table public.sources add constraint sources_only_verified_active
      check (not active or config_status = 'verified');
  end if;
end
$$;

-- --------------------------------------------------------------------------
-- Apply the M3 findings
-- --------------------------------------------------------------------------

-- Kuwait Al-Youm: no lawful crawlable endpoint identified. The gazette is
-- distributed by paid electronic subscription and a Ministry of Information
-- mobile app. Stays inactive until the Legal Department confirms a lawful
-- access route.
update public.sources
   set config_status = 'requires_subscription',
       updated_at = now()
 where country = 'KW'
   and authority_en = 'Kuwait Al-Youm Official Gazette'
   and config_status = 'pending_verification';

-- Bahrain: legalaffairs.gov.bh and lloc.gov.bh are both operated by the
-- Legislation and Legal Opinion Commission and may be mirrors. Grouped so only
-- one can ever be active until the comparison is done by hand.
update public.sources
   set exclusion_group = 'bh-lloc',
       updated_at = now()
 where country = 'BH'
   and authority_en in ('Legislation and Legal Opinion Commission', 'LLOC Legislation Portal');

-- Non-government domains needing authority confirmation.
update public.sources
   set requires_authority_check = true,
       updated_at = now()
 where base_url ~ '^https?://(www\.)?(adgm\.com|qfcra\.com|cma\.org\.sa|qfma\.org\.qa|gso\.org\.sa)(/|$)';
