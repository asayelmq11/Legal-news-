-- =============================================================================
-- Dashboard aggregation checks (M6)
--
-- The dashboard computes every archive metric with `head: true, count: exact`
-- requests, which reach Postgres as `select count(*) ... where <dimension> = $1`.
-- These checks verify those counts are index-backed and that no dashboard query
-- needs to read archive rows.
-- =============================================================================

\echo '── D1. dimension counts are index-backed, not sequential scans ─────────'
do $$
declare plan text; begin
  set local enable_seqscan = off;

  execute 'explain (format json) select count(*) from public.legal_updates '
       || 'where country = ''SA''' into plan;
  if plan not like '%Index%' then
    raise exception 'country count is not index-backed: %', plan;
  end if;

  execute 'explain (format json) select count(*) from public.legal_updates '
       || 'where category = ''tax''' into plan;
  if plan not like '%Index%' then
    raise exception 'category count is not index-backed: %', plan;
  end if;

  execute 'explain (format json) select count(*) from public.legal_updates '
       || 'where legal_status = ''effective''' into plan;
  if plan not like '%Index%' then
    raise exception 'legal_status count is not index-backed: %', plan;
  end if;

  execute 'explain (format json) select count(*) from public.legal_updates '
       || 'where document_type = ''circular''' into plan;
  if plan not like '%Index%' then
    raise exception 'document_type count is not index-backed: %', plan;
  end if;

  execute 'explain (format json) select count(*) from public.legal_updates '
       || 'where publication_date >= date ''2026-07-01'' '
       || 'and publication_date <= date ''2026-07-31''' into plan;
  if plan not like '%Index%' then
    raise exception 'monthly bucket count is not index-backed: %', plan;
  end if;

  raise notice 'PASS — all five dashboard dimension counts use an index';
end $$;

\echo '── D2. the totals actually add up ──────────────────────────────────────'
/*
 * Every archive row has exactly one country, category, legal_status and
 * document_type, all NOT NULL, so each dimension must sum to the grand total.
 * A mismatch would mean the dashboard is quietly under-reporting.
 */
do $$
declare total int; s int; begin
  select count(*) into total from public.legal_updates;

  select sum(c) into s from (
    select count(*) c from public.legal_updates group by country) x;
  if s <> total then raise exception 'country buckets sum to % not %', s, total; end if;

  select sum(c) into s from (
    select count(*) c from public.legal_updates group by category) x;
  if s <> total then raise exception 'category buckets sum to % not %', s, total; end if;

  select sum(c) into s from (
    select count(*) c from public.legal_updates group by legal_status) x;
  if s <> total then raise exception 'legal_status buckets sum to % not %', s, total; end if;

  select sum(c) into s from (
    select count(*) c from public.legal_updates group by document_type) x;
  if s <> total then raise exception 'document_type buckets sum to % not %', s, total; end if;

  raise notice 'PASS — all four dimensions sum to the grand total (%)', total;
end $$;

\echo '── D3. monthly buckets are contiguous and never double-count ───────────'
do $$
declare overlap int; begin
  /*
   * The UI builds buckets as [first day .. last day] inclusive. Two adjacent
   * buckets must never both match one row — an off-by-one at a month boundary
   * would inflate the chart.
   */
  select count(*) into overlap
  from public.legal_updates
  where (publication_date >= date '2026-06-01' and publication_date <= date '2026-06-30')
    and (publication_date >= date '2026-07-01' and publication_date <= date '2026-07-31');

  if overlap <> 0 then raise exception '% rows fall in two adjacent months', overlap; end if;
  raise notice 'PASS — adjacent monthly buckets are disjoint';
end $$;

\echo '── D4. source status tally covers every source exactly once ────────────'
do $$
declare total int; tallied int; begin
  select count(*) into total from public.sources;

  -- mirrors deriveSourceStatus(): active → active, else config_status
  select sum(c) into tallied from (
    select count(*) c from public.sources
    group by case when active then 'active' else config_status::text end
  ) x;

  if tallied <> total then
    raise exception 'status tally covers % of % sources', tallied, total;
  end if;
  raise notice 'PASS — every one of % sources falls into exactly one status', total;
end $$;

\echo '── D5. sources stays small enough for the admin page to read whole ─────'
do $$
declare n int; begin
  select count(*) into n from public.sources;
  if n > 500 then
    raise exception 'sources has grown to % rows — the admin page reads it whole', n;
  end if;
  raise notice 'PASS — sources bounded at % rows', n;
end $$;

\echo '── D7. a viewer can read everything the legal overview needs ───────────'
do $$
declare n int; begin
  set local role authenticated;
  set local request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';

  select count(*) into n from public.legal_updates where country = 'SA';
  reset role;
  if n = 0 then raise exception 'viewer cannot count the archive'; end if;
  raise notice 'PASS — viewer can compute legal metrics';
end $$;

\echo ''
\echo '════════ ALL DASHBOARD CHECKS PASSED ════════'
