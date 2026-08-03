-- =============================================================================
-- Source registry validation
--
-- Covers the seven checks required by M3:
--   duplicate domains · duplicate source URLs · invalid countries ·
--   unsupported parser types · missing trusted domains · sources without
--   schedules · malformed parser_config
--
-- plus the M3 safety rule: nothing unverified may be active, and no selector
-- was invented.
-- =============================================================================

\echo '── S1. every country is represented ────────────────────────────────────'
do $$
declare missing text; begin
  select string_agg(c::text, ', ') into missing
  from unnest(enum_range(null::public.country_code)) c
  where not exists (select 1 from public.sources s where s.country = c);

  if missing is not null then raise exception 'no sources for: %', missing; end if;
  raise notice 'PASS — all 7 jurisdictions covered';
end $$;

\echo '── S2. per-country counts ──────────────────────────────────────────────'
do $$
declare r record; total int; begin
  for r in select country, count(*) n from public.sources group by country order by country loop
    raise notice '   % → % sources', r.country, r.n;
  end loop;
  select count(*) into total from public.sources;
  if total < 40 then raise exception 'registry looks thin: only % sources', total; end if;
  raise notice 'PASS — % sources registered', total;
end $$;

\echo '── S3. no duplicate source URLs ────────────────────────────────────────'
do $$
declare dup text; begin
  select string_agg(base_url, ', ') into dup
  from (select base_url from public.sources group by base_url having count(*) > 1) d;
  if dup is not null then raise exception 'duplicate base_url: %', dup; end if;

  select string_agg(feed_url, ', ') into dup
  from (select feed_url from public.sources where feed_url is not null
        group by feed_url having count(*) > 1) d;
  if dup is not null then raise exception 'duplicate feed_url: %', dup; end if;
  raise notice 'PASS — no duplicate base_url or feed_url';
end $$;

\echo '── S4. no duplicate authority within a country ─────────────────────────'
do $$
declare dup text; begin
  select string_agg(country || ':' || authority_en, ', ') into dup
  from (select country, authority_en from public.sources
        group by country, authority_en having count(*) > 1) d;
  if dup is not null then raise exception 'duplicate authority: %', dup; end if;
  raise notice 'PASS — one entry per authority per country';
end $$;

\echo '── S5. duplicate domains across sources are reported ───────────────────'
/*
 * Shared domains are not always an error: several authorities legitimately
 * publish under one government host. They ARE worth surfacing, because two
 * sources on the same host can double-ingest the same instrument. This check
 * reports rather than fails, EXCEPT where two sources share an identical full
 * domain set, which is a genuine duplicate.
 */
do $$
declare r record; dup text; begin
  for r in
    select d.domain, string_agg(s.authority_en, ' | ') as who, count(*) n
    from public.sources s, unnest(s.allowed_domains) d(domain)
    group by d.domain having count(*) > 1
  loop
    raise notice '   NOTE shared domain % used by: %', r.domain, r.who;
  end loop;

  select string_agg(authority_set, ' || ') into dup
  from (
    select string_agg(authority_en, ' + ') as authority_set
    from public.sources
    group by country, allowed_domains
    having count(*) > 1
  ) d;
  if dup is not null then
    raise exception 'sources with identical domain sets (probable duplicates): %', dup;
  end if;
  raise notice 'PASS — no two sources share an identical domain set';
end $$;

\echo '── S6. every base_url host is in its own allowed_domains ───────────────'
do $$
declare bad text; begin
  select string_agg(authority_en || ' (' || base_url || ')', ', ') into bad
  from public.sources
  where not (allowed_domains @> array[ lower((regexp_match(base_url, '^https?://([^/:?#]+)'))[1]) ]);

  if bad is not null then raise exception 'base_url host not trusted: %', bad; end if;
  raise notice 'PASS — every source trusts its own host';
end $$;

\echo '── S7. no source is missing trusted domains ────────────────────────────'
do $$
declare bad text; begin
  select string_agg(authority_en, ', ') into bad
  from public.sources where cardinality(allowed_domains) = 0;
  if bad is not null then raise exception 'empty allowed_domains: %', bad; end if;

  -- domains must be lowercase, bare hosts: no scheme, no path, no port
  select string_agg(authority_en || ':' || d.domain, ', ') into bad
  from public.sources s, unnest(s.allowed_domains) d(domain)
  where d.domain <> lower(d.domain)
     or d.domain ~ '[/:]'
     or d.domain !~ '^[a-z0-9.-]+\.[a-z]{2,}$';
  if bad is not null then raise exception 'malformed domain entries: %', bad; end if;
  raise notice 'PASS — all domains are lowercase bare hostnames';
end $$;

\echo '── S8. every source has a resolvable schedule ──────────────────────────'
do $$
declare bad text; begin
  -- priority is NOT NULL and 1..5, so a tier interval always resolves
  select string_agg(authority_en, ', ') into bad
  from public.sources where priority is null or priority not between 1 and 5;
  if bad is not null then raise exception 'invalid priority: %', bad; end if;

  select string_agg(authority_en, ', ') into bad
  from public.sources where poll_interval_minutes is not null and poll_interval_minutes <= 0;
  if bad is not null then raise exception 'non-positive poll interval: %', bad; end if;

  -- and the tier map in app_settings must cover every priority actually used
  select string_agg(distinct p::text, ', ') into bad
  from (select distinct priority p from public.sources) x
  where not exists (
    select 1 from public.app_settings
    where key = 'ingestion.priority_intervals' and value ? x.p::text
  );
  if bad is not null then raise exception 'priority tiers with no interval mapping: %', bad; end if;
  raise notice 'PASS — every source resolves to a polling interval';
end $$;

\echo '── S9. parser_config is a well-formed object ───────────────────────────'
do $$
declare bad text; begin
  select string_agg(authority_en, ', ') into bad
  from public.sources where jsonb_typeof(parser_config) <> 'object';
  if bad is not null then raise exception 'parser_config not an object: %', bad; end if;

  -- a verified html/pdf source must carry real selectors
  select string_agg(authority_en, ', ') into bad
  from public.sources
  where config_status = 'verified' and parser_type in ('html','pdf') and parser_config = '{}'::jsonb;
  if bad is not null then raise exception 'verified html/pdf source with empty config: %', bad; end if;

  -- a verified rss/api source must carry a feed URL
  select string_agg(authority_en, ', ') into bad
  from public.sources
  where config_status = 'verified' and parser_type in ('rss','api') and feed_url is null;
  if bad is not null then raise exception 'verified feed source without feed_url: %', bad; end if;
  raise notice 'PASS — parser_config well-formed and consistent with config_status';
end $$;

\echo '── S10. NO SELECTORS WERE INVENTED ─────────────────────────────────────'
/*
 * The central M3 guarantee. Nothing may claim a parser or carry selectors
 * unless a human verified it against the live site. Since verification was not
 * possible from the build environment, every seeded row must still be pending.
 */
do $$
declare guessed text; begin
  select string_agg(authority_en || ' [' || parser_type || ']', ', ') into guessed
  from public.sources
  where config_status = 'pending_verification'
    and (parser_type <> 'unknown' or parser_config <> '{}'::jsonb or feed_url is not null);

  if guessed is not null then
    raise exception 'INVENTED CONFIG on unverified source(s): %', guessed;
  end if;
  raise notice 'PASS — every unverified source carries parser_type=unknown, empty config, no feed_url';
end $$;

\echo '── S11. nothing unverified can be active ───────────────────────────────'
do $$
declare bad text; n int; begin
  select string_agg(authority_en, ', ') into bad
  from public.sources where active and config_status = 'pending_verification';
  if bad is not null then raise exception 'active but unverified: %', bad; end if;

  select count(*) into n from public.sources where active;
  raise notice 'PASS — % active sources, none of them pending/unverified', n;
end $$;

\echo '── S12. the constraint actually blocks activating a pending source ─────'
do $$
declare sid uuid; begin
  select id into sid from public.sources where config_status='pending_verification' limit 1;
  begin
    update public.sources set active = true where id = sid;
    raise exception 'SAFETY FAILURE: a pending source was activated';
  exception when check_violation then
    raise notice 'PASS — activating an unverified source is rejected by the database';
  end;
end $$;

\echo '── S13. a source cannot trust a domain it does not serve ───────────────'
do $$
begin
  begin
    insert into public.sources (country, authority_ar, authority_en, source_type,
      base_url, parser_type, allowed_domains, priority)
    values ('SA','مصدر مزيف','Spoofed Source','government',
            'https://attacker.example.com/news','unknown', array['moj.gov.sa'], 1);
    raise exception 'SECURITY: a source pointing off its trusted domain was accepted';
  exception when check_violation then
    raise notice 'PASS — base_url outside allowed_domains rejected';
  end;
end $$;

\echo '── S14. the full verification lifecycle works ──────────────────────────'
do $$
declare sid uuid; begin
  select id into sid from public.sources where authority_en='Umm Al-Qura Official Gazette';

  -- cannot mark verified while parser_type is still unknown
  begin
    update public.sources set config_status='verified' where id=sid;
    raise exception 'verified with parser_type=unknown should be rejected';
  exception when check_violation then null; end;

  -- cannot mark verified as html with an empty config
  begin
    update public.sources set config_status='verified', parser_type='html' where id=sid;
    raise exception 'verified html with empty parser_config should be rejected';
  exception when check_violation then null; end;

  -- the real path: supply a parser and selectors, verify, then activate
  update public.sources
     set parser_type='html',
         parser_config='{"list":".issue-row","title":"a.title","link":"a.title@href","date":".issue-date"}'::jsonb,
         config_status='verified',
         updated_at=now()
   where id=sid;
  update public.sources set active=true where id=sid;

  if not exists (select 1 from public.sources where id=sid and active and config_status='verified') then
    raise exception 'verification lifecycle failed';
  end if;
  raise notice 'PASS — configure → verify → activate works, and each gate is enforced';

  -- restore the seeded state
  update public.sources
     set active=false, config_status='pending_verification',
         parser_type='unknown', parser_config='{}'::jsonb
   where id=sid;
end $$;

\echo '── S15. registry data carries no workflow logic ────────────────────────'
/*
 * Requirement 7: source data stays separate from workflow logic. parser_config
 * describes WHERE to read (selectors, field paths) and must never contain
 * decision keys — thresholds, retry counts, publish rules. Those belong to n8n.
 */
do $$
declare bad text; begin
  select string_agg(authority_en || ':' || k, ', ') into bad
  from public.sources s, lateral jsonb_object_keys(s.parser_config) k
  where k ~* '(threshold|confidence|publish|retry|backoff|schedule|cron|enabled|filter|rule)';

  if bad is not null then
    raise exception 'workflow logic leaked into parser_config: %', bad;
  end if;
  raise notice 'PASS — parser_config describes parsing only, no decision logic';
end $$;

\echo '── S16. classification and priority sanity ─────────────────────────────'
do $$
declare bad text; n int; begin
  -- every gazette should be top priority: it is the authoritative source
  select string_agg(authority_en || ' (p' || priority || ')', ', ') into bad
  from public.sources where source_type='official_gazette' and priority > 2;
  if bad is not null then raise exception 'official gazette on a slow tier: %', bad; end if;

  select count(*) into n from public.sources where source_type='official_gazette';
  raise notice '   official gazettes: %', n;
  select count(*) into n from public.sources where source_type='regulator';
  raise notice '   regulators: %', n;
  select count(*) into n from public.sources where source_type='government';
  raise notice '   government bodies: %', n;
  select count(*) into n from public.sources where source_type='gcc';
  raise notice '   GCC-wide bodies: %', n;

  -- the platform trusts no unapproved news source; none are seeded
  select count(*) into n from public.sources where source_type='approved_news';
  if n <> 0 then raise exception 'approved_news sources seeded without approval: %', n; end if;
  raise notice 'PASS — classifications sane; zero news sources seeded (none approved yet)';
end $$;

\echo '── S17. seed is idempotent ─────────────────────────────────────────────'
do $$
declare before_n int; after_n int; tuned jsonb; begin
  select count(*) into before_n from public.sources;

  -- simulate an admin having verified one source, then re-run the seed
  update public.sources
     set parser_config='{"list":".x"}'::jsonb
   where authority_en='Central Bank of Oman';

  insert into public.sources (country, authority_ar, authority_en, source_type, base_url,
    parser_type, parser_config, allowed_domains, priority, active, config_status)
  values ('OM','البنك المركزي العماني','Central Bank of Oman','regulator','https://cbo.gov.om',
          'unknown','{}'::jsonb, array['cbo.gov.om','www.cbo.gov.om'], 1, false, 'pending_verification')
  on conflict (country, authority_en) do nothing;

  select count(*) into after_n from public.sources;
  select parser_config into tuned from public.sources where authority_en='Central Bank of Oman';

  if before_n <> after_n then raise exception 'seed inserted duplicates: % -> %', before_n, after_n; end if;
  if tuned <> '{"list":".x"}'::jsonb then raise exception 'seed clobbered admin configuration'; end if;
  raise notice 'PASS — re-seeding adds nothing and preserves admin edits';

  update public.sources set parser_config='{}'::jsonb where authority_en='Central Bank of Oman';
end $$;

\echo '── S18. M3 access findings are recorded as status, not prose ──────────'
do $$
declare st public.config_status; n int; begin
  select config_status into st from public.sources
   where country='KW' and authority_en='Kuwait Al-Youm Official Gazette';
  if st <> 'requires_subscription' then
    raise exception 'Kuwait Al-Youm should be requires_subscription, is %', st;
  end if;

  select count(*) into n from public.sources
   where exclusion_group='bh-lloc';
  if n <> 2 then raise exception 'expected 2 Bahrain LLOC candidates grouped, found %', n; end if;

  select count(*) into n from public.sources where requires_authority_check;
  if n <> 5 then raise exception 'expected 5 non-government domains flagged, found %', n; end if;

  raise notice 'PASS — Kuwait gazette gated, 2 Bahrain candidates grouped, 5 domains flagged';
end $$;

\echo '── S19. only a verified source can be activated ────────────────────────'
do $$
declare sid uuid; st public.config_status; begin
  foreach st in array array['pending_verification','blocked_by_access','requires_subscription']::public.config_status[]
  loop
    select id into sid from public.sources where config_status='pending_verification' limit 1;
    update public.sources set config_status=st where id=sid;
    begin
      update public.sources set active=true where id=sid;
      raise exception 'SAFETY FAILURE: a % source was activated', st;
    exception when check_violation then null; end;
    update public.sources set config_status='pending_verification' where id=sid;
  end loop;
  raise notice 'PASS — pending / blocked / subscription-gated sources all refuse activation';
end $$;

\echo '── S20. mutually exclusive sources cannot both be active ───────────────'
do $$
declare a uuid; b uuid; begin
  select id into a from public.sources where authority_en='Legislation and Legal Opinion Commission';
  select id into b from public.sources where authority_en='LLOC Legislation Portal';

  -- verify and activate the first
  update public.sources set parser_type='html',
    parser_config='{"list":".x","title":"a","link":"a@href","date":".d"}'::jsonb,
    config_status='verified' where id in (a, b);
  update public.sources set active=true where id=a;

  -- the second must not be able to join it
  begin
    update public.sources set active=true where id=b;
    raise exception 'DUPLICATION RISK: both Bahrain LLOC sources went active';
  exception when unique_violation then
    raise notice 'PASS — second member of an exclusion group cannot be activated';
  end;

  -- restore
  update public.sources set active=false, config_status='pending_verification',
    parser_type='unknown', parser_config='{}'::jsonb where id in (a, b);
end $$;

\echo '── S21. no OFFICIAL source is active (nothing verified yet) ────────────'
/*
 * Unchanged in spirit from M7.5: no per-site parser may be marked verified
 * on a guessed selector. What changed in M13 (hybrid discovery) is that the
 * discovery MECHANISM itself — not any individual government website — was
 * verified live (docs/hybrid-discovery-architecture-2026-08-03.md) and is
 * seeded pre-verified, exactly six rows, one per GCC country, all
 * ingestion_mode='discovery'. Everything with ingestion_mode='official'
 * (the 52-source registry) must still be exactly as untouched as before.
 */
do $$
declare n int; begin
  select count(*) into n from public.sources where active and ingestion_mode <> 'discovery';
  if n <> 0 then raise exception '% non-discovery sources are active before egress verification', n; end if;

  select count(*) into n from public.sources where config_status='verified' and ingestion_mode <> 'discovery';
  if n <> 0 then raise exception '% non-discovery sources marked verified without an egress test', n; end if;

  select count(*) into n from public.sources where ingestion_mode='discovery';
  if n <> 6 then raise exception 'expected 6 discovery sources (one per GCC country), found %', n; end if;

  select count(*) into n from public.sources where ingestion_mode='discovery' and (not active or config_status <> 'verified');
  if n <> 0 then raise exception '% discovery sources are not verified+active', n; end if;

  raise notice 'PASS — 0 official sources active/verified; 6 discovery sources verified+active';
end $$;

\echo ''
\echo '════════ ALL SOURCE REGISTRY CHECKS PASSED ════════'
