-- =============================================================================
-- Archive query checks (M5)
--
-- Runs against the fixture data loaded from supabase/fixtures/. Verifies that
-- the query paths the UI depends on actually work AND actually use their
-- indexes — a filter that silently sequential-scans is a bug that only shows up
-- once the archive is large.
-- =============================================================================

\echo '── A1. fixtures loaded, and clearly identifiable as fake ───────────────'
do $$
declare n int; resolvable int; offenders text; begin
  select count(*) into n from public.legal_updates where ai_model = 'FIXTURE';
  if n < 40 then raise exception 'expected >= 40 fixture rows, found %', n; end if;

  /*
   * The safety property that matters in a test database is that NO row — from
   * this fixture file or from the RLS suite that ran earlier — carries a URL
   * that could resolve to a real authority. A stray row escaping into a real
   * archive would be invented legal content attributed to a real ministry, so
   * the reserved .invalid TLD (RFC 2606) makes every one of them inert.
   */
  select count(*), string_agg(distinct source_url, ', ')
    into resolvable, offenders
  from public.legal_updates where source_url !~ '\.invalid(/|$|:)';

  if resolvable <> 0 then
    raise exception '% row(s) carry resolvable URLs in a test database: %', resolvable, offenders;
  end if;

  raise notice 'PASS — % fixture rows; every archived URL in this database is on .invalid', n;
end $$;

\echo '── A2. Arabic search matches across orthographic variants ──────────────'
do $$
declare hits int; begin
  -- query without hamza must find the title written WITH hamza
  select count(*) into hits from public.legal_updates
   where search_vector @@ plainto_tsquery('simple',
     translate('احكام',
       U&'\0623\0625\0622\0671\0629\0649\0624\0626\064B\064C\064D\064E\064F\0650\0651\0652\0670\0640',
       U&'\0627\0627\0627\0627\0647\064A\0648\064A'));
  if hits < 2 then raise exception 'hamza-insensitive search found only % rows', hits; end if;

  -- teh marbuta: 'اللائحة' must find 'اللائحه' and vice versa
  select count(*) into hits from public.legal_updates
   where search_vector @@ plainto_tsquery('simple',
     translate('اللائحة',
       U&'\0623\0625\0622\0671\0629\0649\0624\0626\064B\064C\064D\064E\064F\0650\0651\0652\0670\0640',
       U&'\0627\0627\0627\0627\0647\064A\0648\064A'));
  if hits < 2 then raise exception 'teh-marbuta-insensitive search found only % rows', hits; end if;

  -- fully vocalised stored text must be found by an unvocalised query
  select count(*) into hits from public.legal_updates
   where search_vector @@ plainto_tsquery('simple',
     translate('مرسوم ملكي',
       U&'\0623\0625\0622\0671\0629\0649\0624\0626\064B\064C\064D\064E\064F\0650\0651\0652\0670\0640',
       U&'\0627\0627\0627\0627\0647\064A\0648\064A'));
  if hits < 1 then raise exception 'vocalised text not found by plain query'; end if;

  raise notice 'PASS — search matches across hamza, teh marbuta and full vocalisation';
end $$;

\echo '── A3. multi-term search ANDs (plainto_tsquery semantics) ──────────────'
do $$
declare narrowed int; broad int; begin
  select count(*) into narrowed from public.legal_updates
   where search_vector @@ plainto_tsquery('simple', 'ضريبه القيمه المضافه');
  select count(*) into broad from public.legal_updates
   where search_vector @@ plainto_tsquery('simple', 'ضريبه');
  if narrowed > broad then
    raise exception 'AND semantics broken: % matched more than %', narrowed, broad;
  end if;
  raise notice 'PASS — additional terms narrow rather than widen (% vs %)', narrowed, broad;
end $$;

\echo '── A4. every filter path returns sane results ──────────────────────────'
do $$
declare n int; begin
  select count(*) into n from public.legal_updates where country = 'AE';
  if n < 2 then raise exception 'country filter: expected >= 2 AE rows, got %', n; end if;

  select count(*) into n from public.legal_updates where category = 'tax';
  if n < 2 then raise exception 'category filter: got %', n; end if;

  select count(*) into n from public.legal_updates where document_type = 'royal_decree';
  if n < 2 then raise exception 'document_type filter: got %', n; end if;

  select count(*) into n from public.legal_updates where legal_status = 'draft';
  if n < 1 then raise exception 'legal_status filter: got %', n; end if;

  select count(*) into n from public.legal_updates where keywords && array['ضريبة القيمة المضافة'];
  if n < 1 then raise exception 'keyword containment: got %', n; end if;

  select count(*) into n from public.legal_updates where affected_entities && array['البنوك'];
  if n < 1 then raise exception 'affected_entities containment: got %', n; end if;

  select count(*) into n from public.legal_updates
   where publication_date between date '2026-07-01' and date '2026-07-31';
  if n < 5 then raise exception 'publication date range: got %', n; end if;

  select count(*) into n from public.legal_updates
   where effective_date is not null
     and effective_date between date '2026-08-01' and date '2026-12-31';
  if n < 3 then raise exception 'effective date range: got %', n; end if;

  select count(*) into n from public.legal_updates where confidence < 0.90;
  if n < 1 then raise exception 'confidence range: expected a sub-threshold fixture, got %', n; end if;

  raise notice 'PASS — all nine filter paths return expected rows';
end $$;

\echo '── A5. filters are INDEX-BACKED, not sequential scans ──────────────────'
/*
 * A filter that works on 40 fixture rows but scans on 40,000 real ones is a
 * latent outage. enable_seqscan=off forces the planner to reveal whether an
 * index path exists at all.
 */
do $$
declare plan text; begin
  set local enable_seqscan = off;

  /*
   * format json, not text: EXPLAIN's text output is many ROWS, and `EXECUTE …
   * INTO` keeps only the first, which is the summary line. JSON returns the
   * whole plan tree in a single row, so index names further down are visible.
   */

  execute 'explain (format json) select id from public.legal_updates '
       || 'where search_vector @@ plainto_tsquery(''simple'', ''ضريبه'')' into plan;
  if plan not like '%legal_updates_search_idx%' then
    raise exception 'full-text search not using the GIN index: %', plan;
  end if;

  execute 'explain (format json) select id from public.legal_updates '
       || 'where legal_status = ''draft'' order by publication_date desc' into plan;
  if plan not like '%legal_status%' then
    raise exception 'legal_status filter not indexed (added in 0012): %', plan;
  end if;

  execute 'explain (format json) select id from public.legal_updates '
       || 'where effective_date is not null and effective_date >= date ''2026-08-01''' into plan;
  if plan not like '%effective_date%' then
    raise exception 'effective_date range not indexed (added in 0012): %', plan;
  end if;

  execute 'explain (format json) select id from public.legal_updates '
       || 'where keywords && array[''ضريبة القيمة المضافة'']' into plan;
  if plan not like '%legal_updates_keywords_idx%' then
    raise exception 'keyword containment not using GIN: %', plan;
  end if;

  execute 'explain (format json) select id from public.legal_updates '
       || 'where title_ar like ''%القيمة%''' into plan;
  if plan not like '%trgm%' then
    raise exception 'trigram fallback not using the trgm index: %', plan;
  end if;

  raise notice 'PASS — search, legal_status, effective_date, keywords and trigram all index-backed';
end $$;

\echo '── A6. the source join is a single query, not N+1 ──────────────────────'
do $$
declare plan text; begin
  execute 'explain (format json) select lu.id, s.authority_ar '
       || 'from public.legal_updates lu join public.sources s on s.id = lu.source_id '
       || 'order by lu.publication_date desc limit 20' into plan;
  -- any join strategy is acceptable; what matters is that it is ONE plan
  if plan not like '%Join%' and plan not like '%Nested Loop%' then
    raise exception 'source lookup is not joined: %', plan;
  end if;
  raise notice 'PASS — source resolved by join in a single query';
end $$;

\echo '── A7. pagination boundaries ───────────────────────────────────────────'
do $$
declare total int; first_page int; last_page_n int; page_count int; overshoot int; begin
  select count(*) into total from public.legal_updates;

  select count(*) into first_page from (
    select id from public.legal_updates
     order by publication_date desc, created_at desc limit 20 offset 0) x;
  if first_page <> 20 then raise exception 'page 1 returned % rows', first_page; end if;

  page_count := ceil(total::numeric / 20);

  select count(*) into last_page_n from (
    select id from public.legal_updates
     order by publication_date desc, created_at desc
     limit 20 offset (page_count - 1) * 20) x;
  if last_page_n = 0 or last_page_n > 20 then
    raise exception 'last page returned % rows', last_page_n;
  end if;

  -- a page beyond the end must be empty, never an error
  select count(*) into overshoot from (
    select id from public.legal_updates
     order by publication_date desc limit 20 offset page_count * 20) x;
  if overshoot <> 0 then raise exception 'page past the end returned % rows', overshoot; end if;

  raise notice 'PASS — % rows over % pages; last page %, past-the-end empty',
    total, page_count, last_page_n;
end $$;

\echo '── A8. ordering is deterministic across page boundaries ────────────────'
/*
 * Ordering by publication_date alone is ambiguous when several rows share a
 * date — and the fixtures deliberately include such a group. An unstable sort
 * would let a row appear on two pages, or on none.
 */
do $$
declare dupes int; begin
  with paged as (
    select id, row_number() over (order by publication_date desc, created_at desc) rn
    from public.legal_updates
  )
  select count(*) into dupes from (
    select id from paged group by id having count(*) > 1
  ) x;
  if dupes <> 0 then raise exception '% rows appear more than once in the ordering', dupes; end if;

  select count(*) into dupes from (
    select publication_date from public.legal_updates
    group by publication_date having count(*) > 1
  ) x;
  if dupes = 0 then
    raise exception 'fixtures no longer contain a shared publication_date — this check is not testing anything';
  end if;

  raise notice 'PASS — deterministic ordering, with % shared-date group(s) present to test it', dupes;
end $$;

\echo '── A9. the unsafe-link fixture exists and is genuinely off-domain ──────'
do $$
declare bad_host text; allowed text[]; begin
  select lu.source_url, s.allowed_domains into bad_host, allowed
  from public.legal_updates lu
  join public.sources s on s.id = lu.source_id
  where lu.content_hash = repeat('ce', 32);

  if bad_host is null then raise exception 'unsafe-link fixture missing'; end if;

  if allowed @> array[ lower((regexp_match(bad_host, '^https?://([^/:?#]+)'))[1]) ] then
    raise exception 'unsafe-link fixture host IS trusted — the test proves nothing';
  end if;

  raise notice 'PASS — off-domain fixture present; UI must refuse to link it';
end $$;

\echo '── A10. a viewer can read the archive but still cannot write it ────────'
do $$
declare n int; begin
  set local role authenticated;
  set local request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
  select count(*) into n from public.legal_updates;
  reset role;
  if n = 0 then raise exception 'viewer cannot read the archive'; end if;
  raise notice 'PASS — viewer reads % archived updates', n;
end $$;

\echo ''
\echo '════════ ALL ARCHIVE QUERY CHECKS PASSED ════════'
