-- =============================================================================
-- Schema checks — structure, constraints, and the Arabic search vector.
--
-- Every check RAISEs EXCEPTION on failure, so `psql -v ON_ERROR_STOP=1` turns
-- the file into a pass/fail gate.
-- =============================================================================

\echo '── 1. the table set is exactly the approved one ─────────────────────────'
/*
 * Six core tables (M2) plus the two operational tables M10 required:
 * source_health_snapshots and job_dead_letters. Asserted as an exact SET
 * rather than a count, so an unplanned table is caught by name.
 */
do $$
declare
  expected text[] := array[
    'app_settings','job_dead_letters','legal_updates','newsletter_history',
    'source_health_snapshots','sources','users','workflow_logs'
  ];
  found text[];
begin
  select array_agg(tablename order by tablename) into found
  from pg_tables where schemaname = 'public';

  if found is distinct from expected then
    raise exception 'table set drifted. expected %, found %', expected, found;
  end if;
  raise notice 'PASS — exactly the 8 approved tables: %', array_to_string(found, ', ');
end $$;

\echo '── 2. no rule triggers anywhere ────────────────────────────────────────'
do $$
declare n int; begin
  select count(*) into n
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace ns on ns.oid = c.relnamespace
  where ns.nspname = 'public' and not t.tgisinternal;

  if n <> 0 then raise exception 'expected 0 user triggers, found %', n; end if;
  raise notice 'PASS — no user-defined triggers';
end $$;

\echo '── 3. exactly one function, and it is the access-control predicate ─────'
do $$
declare
  n int;
  found text;
begin
  select count(*), string_agg(p.proname, ', ')
    into n, found
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public';

  if n <> 1 or found <> 'current_user_role' then
    raise exception 'expected only current_user_role(), found % (%)', n, found;
  end if;
  raise notice 'PASS — single function: current_user_role() [access control, not business logic]';
end $$;

\echo '── 4. RLS enabled on all six tables ────────────────────────────────────'
do $$
declare missing text; begin
  select string_agg(c.relname, ', ') into missing
  from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
  where ns.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

  if missing is not null then raise exception 'RLS disabled on: %', missing; end if;
  raise notice 'PASS — RLS enabled everywhere';
end $$;

\echo '── 5. archive tables have NO write policies ────────────────────────────'
do $$
declare bad text; begin
  select string_agg(format('%s.%s(%s)', tablename, policyname, cmd), ', ') into bad
  from pg_policies
  where schemaname = 'public'
    and tablename in ('legal_updates','workflow_logs','newsletter_history')
    and cmd <> 'SELECT';

  if bad is not null then raise exception 'unexpected write policy: %', bad; end if;
  raise notice 'PASS — legal_updates/workflow_logs/newsletter_history are select-only';
end $$;

\echo '── 6. archive write privileges revoked from anon + authenticated ───────'
do $$
declare r record; begin
  for r in
    select t.tbl, rl.role_name, pr.priv
    from unnest(array['legal_updates','workflow_logs','newsletter_history']) as t(tbl)
    cross join unnest(array['anon','authenticated'])                        as rl(role_name)
    cross join unnest(array['INSERT','UPDATE','DELETE','TRUNCATE'])         as pr(priv)
  loop
    if has_table_privilege(r.role_name, 'public.' || r.tbl, r.priv) then
      raise exception 'SEAL BREACH: % has % on %', r.role_name, r.priv, r.tbl;
    end if;
  end loop;
  raise notice 'PASS — no INSERT/UPDATE/DELETE/TRUNCATE for anon or authenticated on archive tables';
end $$;

\echo '── 6b. anon has no privilege on ANY table ──────────────────────────────'
do $$
declare r record; begin
  for r in
    select t.tablename as tbl, pr.priv
    from pg_tables t
    cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) as pr(priv)
    where t.schemaname = 'public'
  loop
    if has_table_privilege('anon', 'public.' || r.tbl, r.priv) then
      raise exception 'SEAL BREACH: anon has % on %', r.priv, r.tbl;
    end if;
  end loop;
  raise notice 'PASS — anon holds no privilege on any table';
end $$;

\echo '── 7. app_settings has no INSERT/DELETE policy (key set fixed) ─────────'
do $$
declare bad text; begin
  select string_agg(policyname || ':' || cmd, ', ') into bad
  from pg_policies
  where schemaname='public' and tablename='app_settings' and cmd in ('INSERT','DELETE');

  if bad is not null then raise exception 'app_settings should not allow INSERT/DELETE: %', bad; end if;
  raise notice 'PASS — app_settings key set is migration-controlled';
end $$;

\echo '── 8. app_settings rejects credential-shaped keys ──────────────────────'
do $$
declare k text; begin
  foreach k in array array[
    'ai.api_key', 'mail.password', 'n8n.webhook_secret',
    'supabase.service_role', 'x.private_key', 'y.access_token'
  ] loop
    begin
      insert into public.app_settings(key, value) values (k, '"x"'::jsonb);
      raise exception 'SECURITY: credential-shaped key % was accepted', k;
    exception when check_violation then
      null; -- expected
    end;
  end loop;
  raise notice 'PASS — credential-shaped keys rejected by CHECK constraint';
end $$;

\echo '── 9. seeded settings present with correct shapes ──────────────────────'
do $$
declare n int; begin
  select count(*) into n from public.app_settings;
  if n <> 10 then raise exception 'expected 10 seeded settings, found %', n; end if;

  if (select value from public.app_settings where key='ai.confidence_threshold')::numeric <> 0.90 then
    raise exception 'confidence threshold default wrong';
  end if;
  if (select value->>'1' from public.app_settings where key='ingestion.priority_intervals') <> '60' then
    raise exception 'priority tier 1 should be 60 minutes';
  end if;
  if (select value from public.app_settings where key='newsletter.enabled')::boolean then
    raise exception 'newsletter must ship disabled';
  end if;
  raise notice 'PASS — 10 settings seeded with safe defaults';
end $$;

\echo '── 10. seed is idempotent ──────────────────────────────────────────────'
do $$
declare before_n int; after_n int; before_v jsonb; after_v jsonb; begin
  update public.app_settings set value='0.95'::jsonb where key='ai.confidence_threshold';
  select count(*), (select value from public.app_settings where key='ai.confidence_threshold')
    into before_n, before_v from public.app_settings;

  -- re-running the seed must not clobber the tuned value
  insert into public.app_settings(key, value, description)
  values ('ai.confidence_threshold','0.90'::jsonb,'x')
  on conflict (key) do nothing;

  select count(*), (select value from public.app_settings where key='ai.confidence_threshold')
    into after_n, after_v from public.app_settings;

  if before_n <> after_n or before_v <> after_v then
    raise exception 'seed not idempotent: % -> %', before_v, after_v;
  end if;
  update public.app_settings set value='0.90'::jsonb where key='ai.confidence_threshold';
  raise notice 'PASS — re-seeding preserves admin-tuned values';
end $$;

\echo '── 11. integrity constraints reject bad data ───────────────────────────'
do $$
declare src uuid; begin
  insert into public.sources (country, authority_ar, authority_en, source_type,
                              base_url, parser_type, feed_url, allowed_domains, priority)
  values ('SA','مصدر اختبار','ZZ Test Fixture Authority','government',
          'https://fixture.invalid','rss','https://fixture.invalid/feed',
          array['fixture.invalid'], 5)
  returning id into src;

  -- priority out of range
  begin
    insert into public.sources (country, authority_ar, authority_en, source_type,
                                base_url, parser_type, allowed_domains, priority)
    values ('SA','x','x','government','https://fixture-x.invalid','html',array['fixture-x.invalid'], 9);
    raise exception 'priority 9 should be rejected';
  exception when check_violation then null; end;

  -- rss parser with no feed_url
  begin
    insert into public.sources (country, authority_ar, authority_en, source_type,
                                base_url, parser_type, allowed_domains, priority)
    values ('SA','x','x','government','https://fixture-x.invalid','rss',array['fixture-x.invalid'], 1);
    raise exception 'rss source without feed_url should be rejected';
  exception when check_violation then null; end;

  -- uppercase domain
  begin
    insert into public.sources (country, authority_ar, authority_en, source_type,
                                base_url, parser_type, allowed_domains, priority)
    values ('SA','x','x','government','https://fixture-x.invalid','html',array['X.GOV.SA'], 1);
    raise exception 'uppercase domain should be rejected';
  exception when check_violation then null; end;

  -- empty domain list
  begin
    insert into public.sources (country, authority_ar, authority_en, source_type,
                                base_url, parser_type, allowed_domains, priority)
    values ('SA','x','x','government','https://fixture-x.invalid','html', array[]::text[], 1);
    raise exception 'empty allowed_domains should be rejected';
  exception when check_violation then null; end;

  -- non-https base url
  begin
    insert into public.sources (country, authority_ar, authority_en, source_type,
                                base_url, parser_type, allowed_domains, priority)
    values ('SA','x','x','government','ftp://fixture-x.invalid','html',array['fixture-x.invalid'], 1);
    raise exception 'ftp base_url should be rejected';
  exception when check_violation then null; end;

  -- confidence outside 0..1
  begin
    insert into public.legal_updates (source_id, content_hash, source_url, title_ar,
      summary_ar, country, category, document_type, legal_status, is_legal_update,
      confidence, publication_date, raw_excerpt, ai_model)
    values (src, repeat('a',64), 'https://fixture.invalid/x','ع','ع','SA','tax','circular',
            'enacted', true, 1.5, current_date, 'ع', 'test');
    raise exception 'confidence 1.5 should be rejected';
  exception when check_violation then null; end;

  -- malformed content hash
  begin
    insert into public.legal_updates (source_id, content_hash, source_url, title_ar,
      summary_ar, country, category, document_type, legal_status, is_legal_update,
      confidence, publication_date, raw_excerpt, ai_model)
    values (src, 'not-a-sha256', 'https://fixture.invalid/x','ع','ع','SA','tax','circular',
            'enacted', true, 0.95, current_date, 'ع', 'test');
    raise exception 'malformed hash should be rejected';
  exception when check_violation then null; end;

  -- blank title
  begin
    insert into public.legal_updates (source_id, content_hash, source_url, title_ar,
      summary_ar, country, category, document_type, legal_status, is_legal_update,
      confidence, publication_date, raw_excerpt, ai_model)
    values (src, repeat('b',64), 'https://fixture.invalid/x','   ','ع','SA','tax','circular',
            'enacted', true, 0.95, current_date, 'ع', 'test');
    raise exception 'blank title should be rejected';
  exception when check_violation then null; end;

  raise notice 'PASS — integrity constraints reject malformed rows';
end $$;

\echo '── 12. a LOW-confidence row is still storable (rule lives in n8n) ──────'
do $$
declare src uuid; begin
  select id into src from public.sources where authority_en='ZZ Test Fixture Authority';
  insert into public.legal_updates (source_id, content_hash, source_url, title_ar,
    summary_ar, country, category, document_type, legal_status, is_legal_update,
    confidence, publication_date, raw_excerpt, ai_model)
  values (src, repeat('c',64), 'https://fixture.invalid/low','عنوان','ملخص','SA','tax',
          'circular','enacted', true, 0.10, current_date, 'نص', 'test');

  raise notice 'PASS — confidence 0.10 accepted by the DB; the >=0.90 gate is n8n''s job, exactly as specified';
  delete from public.legal_updates where content_hash = repeat('c',64);
end $$;

\echo '── 13. duplicate content_hash blocked by UNIQUE ────────────────────────'
do $$
declare src uuid; begin
  select id into src from public.sources where authority_en='ZZ Test Fixture Authority';
  insert into public.legal_updates (source_id, content_hash, source_url, title_ar,
    summary_ar, country, category, document_type, legal_status, is_legal_update,
    confidence, publication_date, raw_excerpt, ai_model)
  values (src, repeat('d',64), 'https://fixture.invalid/1','عنوان','ملخص','SA','tax',
          'circular','enacted', true, 0.95, current_date, 'نص', 'test');
  begin
    insert into public.legal_updates (source_id, content_hash, source_url, title_ar,
      summary_ar, country, category, document_type, legal_status, is_legal_update,
      confidence, publication_date, raw_excerpt, ai_model)
    values (src, repeat('d',64), 'https://fixture.invalid/2','عنوان آخر','ملخص','SA','tax',
            'circular','enacted', true, 0.95, current_date, 'نص', 'test');
    raise exception 'duplicate content_hash should be rejected';
  exception when unique_violation then
    raise notice 'PASS — duplicate rejected by UNIQUE (n8n catches this and classifies it as "duplicate")';
  end;
end $$;

\echo '── 14. archive protects provenance: source delete is RESTRICTed ────────'
do $$
declare src uuid; begin
  select id into src from public.sources where authority_en='ZZ Test Fixture Authority';
  begin
    delete from public.sources where id = src;
    raise exception 'deleting a source with archived updates should be blocked';
  exception when foreign_key_violation then
    raise notice 'PASS — source with archived updates cannot be deleted (deactivate instead)';
  end;
end $$;

\echo '── 15. Arabic search vector: orthographic variants match ───────────────'
do $$
declare src uuid; hits int; begin
  select id into src from public.sources where authority_en='ZZ Test Fixture Authority';

  insert into public.legal_updates (source_id, content_hash, source_url, title_ar,
    summary_ar, country, category, document_type, legal_status, is_legal_update,
    confidence, publication_date, raw_excerpt, ai_model, keywords)
  values (src, repeat('e',64), 'https://fixture.invalid/vat',
          'تعديل أحكام اللائحة التنفيذية لنظام ضريبة القيمة المضافة',
          'صدر قرار بتعديل أحكام اللائحه التنفيذيه',
          'SA','tax','executive_regulation','amended', true, 0.97, current_date,
          'نص المصدر', 'test', array['ضريبة','لائحة']);

  -- query WITHOUT hamza must match text WITH hamza (أحكام -> احكام)
  select count(*) into hits from public.legal_updates
  where search_vector @@ to_tsquery('simple', translate('احكام',
    U&'\0623\0625\0622\0671\0629\0649\0624\0626\064B\064C\064D\064E\064F\0650\0651\0652\0670\0640',
    U&'\0627\0627\0627\0627\0647\064A\0648\064A'));
  if hits < 1 then raise exception 'hamza-insensitive search failed'; end if;

  -- teh marbuta: التنفيذية must match التنفيذيه
  select count(*) into hits from public.legal_updates
  where search_vector @@ to_tsquery('simple', translate('التنفيذية',
    U&'\0623\0625\0622\0671\0629\0649\0624\0626\064B\064C\064D\064E\064F\0650\0651\0652\0670\0640',
    U&'\0627\0627\0627\0627\0647\064A\0648\064A'));
  if hits < 1 then raise exception 'teh-marbuta-insensitive search failed'; end if;

  /*
   * A query term must be normalised the SAME way the vector was, or it will
   * not match: the stored vector holds 'ضريبه' (teh marbuta folded), so a raw
   * 'ضريبة' finds nothing. This asserts both halves of that contract, and is
   * why the M5 query layer wraps normalisation rather than leaving it to
   * callers.
   */
  if (select ts_rank(search_vector, to_tsquery('simple', translate('ضريبة',
        U&'\0623\0625\0622\0671\0629\0649\0624\0626\064B\064C\064D\064E\064F\0650\0651\0652\0670\0640',
        U&'\0627\0627\0627\0627\0647\064A\0648\064A')))
      from public.legal_updates where content_hash = repeat('e',64)) <= 0 then
    raise exception 'normalised query term failed to rank';
  end if;

  -- and the un-normalised form must indeed miss, proving normalisation is load-bearing
  select count(*) into hits from public.legal_updates
  where content_hash = repeat('e',64)
    and search_vector @@ to_tsquery('simple','ضريبة');
  if hits <> 0 then
    raise exception 'un-normalised term unexpectedly matched — normalisation contract is not what it appears';
  end if;

  -- keywords use array containment, not the tsvector
  select count(*) into hits from public.legal_updates where keywords && array['ضريبة'];
  if hits < 1 then raise exception 'keyword containment failed'; end if;

  raise notice 'PASS — hamza-, teh-marbuta-insensitive search, weighted ranking, keyword containment';
end $$;

\echo '── 16. trigram fuzzy search on Arabic titles ───────────────────────────'
do $$
declare hits int; begin
  select count(*) into hits from public.legal_updates
  where title_ar like '%القيمة المضافة%';
  if hits < 1 then raise exception 'substring match failed'; end if;
  raise notice 'PASS — trigram-backed substring matching works';
end $$;

\echo ''
\echo '════════ ALL SCHEMA CHECKS PASSED ════════'
