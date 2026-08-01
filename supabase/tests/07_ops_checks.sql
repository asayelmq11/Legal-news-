-- =============================================================================
-- Operational reliability checks (M10)
-- =============================================================================

\echo '── O1. eight tables; the two new ones are the ops tables ───────────────'
do $$
declare n int; found text; begin
  select count(*), string_agg(tablename, ', ' order by tablename) into n, found
  from pg_tables where schemaname = 'public';
  if n <> 8 then raise exception 'expected 8 tables, found % (%)', n, found; end if;
  raise notice 'PASS — 8 tables: %', found;
end $$;

\echo '── O2. still exactly one function, and no triggers ─────────────────────'
do $$
declare n int; begin
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
   where ns.nspname='public';
  if n <> 1 then raise exception 'expected 1 function, found %', n; end if;

  select count(*) into n from pg_trigger t join pg_class c on c.oid=t.tgrelid
    join pg_namespace ns on ns.oid=c.relnamespace
   where ns.nspname='public' and not t.tgisinternal;
  if n <> 0 then raise exception 'expected 0 triggers, found %', n; end if;
  raise notice 'PASS — no business logic added to the database';
end $$;

\echo '── O3. lock acquisition is atomic (conditional UPDATE) ─────────────────'
do $$
declare sid uuid; won int; lost int; nowts timestamptz := now(); begin
  select id into sid from public.sources where authority_en='ZZ Fixture Source';

  -- first claimant wins
  update public.sources
     set lock_owner='exec-A', lock_acquired_at=nowts, lock_expires_at=nowts + interval '30 min'
   where id=sid and (lock_expires_at is null or lock_expires_at < nowts);
  get diagnostics won = row_count;
  if won <> 1 then raise exception 'first lock attempt should win, got %', won; end if;

  -- second claimant matches zero rows: already_running, not an error
  update public.sources
     set lock_owner='exec-B', lock_acquired_at=nowts, lock_expires_at=nowts + interval '30 min'
   where id=sid and (lock_expires_at is null or lock_expires_at < nowts);
  get diagnostics lost = row_count;
  if lost <> 0 then raise exception 'second lock attempt should lose, got %', lost; end if;

  raise notice 'PASS — one winner, one already_running, no read-then-write race';
end $$;

\echo '── O4. an expired lease is reclaimable (crash recovery) ────────────────'
do $$
declare sid uuid; won int; nowts timestamptz := now(); begin
  select id into sid from public.sources where authority_en='ZZ Fixture Source';

  -- simulate a crashed execution: lock left behind, already expired
  update public.sources
     set lock_owner='exec-crashed', lock_acquired_at=nowts - interval '2 hours',
         lock_expires_at=nowts - interval '90 min'
   where id=sid;

  update public.sources
     set lock_owner='exec-C', lock_acquired_at=nowts, lock_expires_at=nowts + interval '30 min'
   where id=sid and (lock_expires_at is null or lock_expires_at < nowts);
  get diagnostics won = row_count;
  if won <> 1 then raise exception 'expired lease should be reclaimable, got %', won; end if;

  update public.sources set lock_owner=null, lock_acquired_at=null, lock_expires_at=null where id=sid;
  raise notice 'PASS — a crashed execution does not wedge a source permanently';
end $$;

\echo '── O5. different sources lock independently — no global lock ───────────'
do $$
declare a uuid; b uuid; n int; nowts timestamptz := now(); begin
  select id into a from public.sources where authority_en='ZZ Fixture Source';
  select id into b from public.sources where authority_en='Umm Al-Qura Official Gazette';

  update public.sources set lock_owner='exec-A', lock_acquired_at=nowts,
         lock_expires_at=nowts + interval '30 min' where id=a;
  update public.sources set lock_owner='exec-B', lock_acquired_at=nowts,
         lock_expires_at=nowts + interval '30 min'
   where id=b and (lock_expires_at is null or lock_expires_at < nowts);
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'a second source should lock freely, got %', n; end if;

  update public.sources set lock_owner=null, lock_acquired_at=null, lock_expires_at=null
   where id in (a,b);
  raise notice 'PASS — locks are per source, not global';
end $$;

\echo '── O6. the lock columns cannot fall out of step ────────────────────────'
do $$
declare sid uuid; begin
  select id into sid from public.sources where authority_en='ZZ Fixture Source';
  begin
    update public.sources set lock_owner='orphan', lock_expires_at=null where id=sid;
    raise exception 'an owner without an expiry should be rejected';
  exception when check_violation then null; end;
  raise notice 'PASS — a lock always has both an owner and an expiry';
end $$;

\echo '── O7. one OPEN dead letter per source+hash (idempotent retries) ───────'
do $$
declare sid uuid; h text := repeat('ab', 32); begin
  select id into sid from public.sources where authority_en='ZZ Fixture Source';

  insert into public.job_dead_letters(source_id, stage, item_url, content_hash, error_code, error_message)
  values (sid, 'fetch', 'https://fixture-archive.invalid/dead', h, 'http_503', 'upstream down');

  begin
    insert into public.job_dead_letters(source_id, stage, item_url, content_hash, error_code)
    values (sid, 'fetch', 'https://fixture-archive.invalid/dead', h, 'http_503');
    raise exception 'a second OPEN dead letter for the same item should be rejected';
  exception when unique_violation then null; end;

  raise notice 'PASS — a repeated death does not create a second open incident';
end $$;

\echo '── O8. replay preserves the original failure record ────────────────────'
do $$
declare d record; original_error text; original_created timestamptz; begin
  select * into d from public.job_dead_letters where content_hash = repeat('ab', 32);
  original_error := d.error_message;
  original_created := d.created_at;

  -- a replay records that it happened; it does not rewrite history
  update public.job_dead_letters
     set replay_count = replay_count + 1, last_replay_at = now(), state = 'replayed'
   where id = d.id;

  select * into d from public.job_dead_letters where id = d.id;
  if d.error_message is distinct from original_error then
    raise exception 'replay overwrote the original error message';
  end if;
  if d.created_at <> original_created then
    raise exception 'replay overwrote the original timestamp';
  end if;
  if d.replay_count <> 1 then raise exception 'replay not counted'; end if;

  raise notice 'PASS — replay adds history, it never erases the incident';
end $$;

\echo '── O9. a resolved incident does not block a genuinely new failure ──────'
do $$
declare sid uuid; h text := repeat('ab', 32); n int; begin
  select id into sid from public.sources where authority_en='ZZ Fixture Source';
  update public.job_dead_letters
     set state='resolved', resolved_at=now(), resolution_note='fixed upstream'
   where content_hash = h;

  -- the partial unique index only covers OPEN rows
  insert into public.job_dead_letters(source_id, stage, content_hash, error_code)
  values (sid, 'fetch', h, 'http_503');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'a new failure after resolution should be recordable'; end if;

  raise notice 'PASS — resolving an incident does not hide a later recurrence';
end $$;

\echo '── O10. a dead letter cannot carry credentials ─────────────────────────'
do $$
declare sid uuid; begin
  select id into sid from public.sources where authority_en='ZZ Fixture Source';
  foreach sid in array array[sid] loop
    begin
      insert into public.job_dead_letters(source_id, error_code, payload)
      values (sid, 'http_500', '{"headers":{"authorization":"Bearer abc"}}'::jsonb);
      raise exception 'SECURITY: a payload carrying an authorization header was accepted';
    exception when check_violation then null; end;

    begin
      insert into public.job_dead_letters(source_id, error_code, payload)
      values (sid, 'http_500', '{"api_key":"secret"}'::jsonb);
      raise exception 'SECURITY: a payload carrying an api_key was accepted';
    exception when check_violation then null; end;
  end loop;
  raise notice 'PASS — credential-shaped payload keys rejected by CHECK';
end $$;

\echo '── O11. health snapshots are append-only history ───────────────────────'
do $$
declare sid uuid; n int; begin
  select id into sid from public.sources where authority_en='ZZ Fixture Source';

  insert into public.source_health_snapshots
    (source_id, classification, health_score, enabled, verified, stale,
     consecutive_failures, window_runs, fetch_success_rate, gate_acceptance_rate, duplicate_rate)
  values
    (sid, 'healthy', 100, true, true, false, 0, 10, 1.000, 0.250, 0.500),
    (sid, 'degraded', 70, true, true, false, 1, 10, 0.900, 0.100, 0.400);

  select count(*) into n from public.source_health_snapshots where source_id = sid;
  if n < 2 then raise exception 'expected snapshot history, found %', n; end if;
  raise notice 'PASS — % snapshots retained for trend display', n;
end $$;

\echo '── O12. snapshot rates and scores are bounded ──────────────────────────'
do $$
declare sid uuid; begin
  select id into sid from public.sources where authority_en='ZZ Fixture Source';
  begin
    insert into public.source_health_snapshots
      (source_id, classification, health_score, enabled, verified, stale)
    values (sid, 'healthy', 150, true, true, false);
    raise exception 'a score above 100 should be rejected';
  exception when check_violation then null; end;

  begin
    insert into public.source_health_snapshots
      (source_id, classification, health_score, enabled, verified, stale, fetch_success_rate)
    values (sid, 'healthy', 100, true, true, false, 1.5);
    raise exception 'a rate above 1 should be rejected';
  exception when check_violation then null; end;
  raise notice 'PASS — score 0..100 and rates 0..1 enforced';
end $$;

\echo '── O13. ops tables are read-only to the app; only admins annotate ──────'
do $$
declare n int; begin
  -- a viewer may read health but not write it
  set local role authenticated;
  set local request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
  select count(*) into n from public.source_health_snapshots;
  if n = 0 then reset role; raise exception 'viewer cannot read health snapshots'; end if;

  update public.job_dead_letters set state='dismissed';
  get diagnostics n = row_count;
  reset role;
  if n <> 0 then raise exception 'viewer annotated % dead letters', n; end if;
  raise notice 'PASS — viewer reads ops data, cannot annotate it';
end $$;

\echo '── O14. health snapshots have NO write path for app users ──────────────'
do $$
declare r record; begin
  for r in
    select rl.role_name, pr.priv
    from unnest(array['anon','authenticated']) as rl(role_name)
    cross join unnest(array['INSERT','UPDATE','DELETE']) as pr(priv)
  loop
    if has_table_privilege(r.role_name, 'public.source_health_snapshots', r.priv) then
      raise exception 'SEAL BREACH: % has % on source_health_snapshots', r.role_name, r.priv;
    end if;
  end loop;
  -- and nobody may delete a dead letter: it is a record
  if has_table_privilege('authenticated', 'public.job_dead_letters', 'DELETE') then
    raise exception 'dead letters must not be deletable by the application';
  end if;
  raise notice 'PASS — snapshots are n8n-written only; dead letters are never deletable';
end $$;

\echo '── O15. the archive seal survives M10 ──────────────────────────────────'
do $$
declare r record; begin
  for r in
    select t.tbl, rl.role_name, pr.priv
    from unnest(array['legal_updates','workflow_logs','newsletter_history']) as t(tbl)
    cross join unnest(array['anon','authenticated'])                        as rl(role_name)
    cross join unnest(array['INSERT','UPDATE','DELETE','TRUNCATE'])         as pr(priv)
  loop
    if has_table_privilege(r.role_name, 'public.' || r.tbl, r.priv) then
      raise exception 'SEAL BREACH: % gained % on %', r.role_name, r.priv, r.tbl;
    end if;
  end loop;
  raise notice 'PASS — archive tables still have no write grant for app users';
end $$;

\echo '── O16. per-source staleness windows are storable ──────────────────────'
do $$
declare sid uuid; begin
  select id into sid from public.sources where authority_en='Umm Al-Qura Official Gazette';
  -- a weekly gazette must not be judged by a daily yardstick
  update public.sources set max_silence_minutes = 10080 where id = sid;
  if (select max_silence_minutes from public.sources where id=sid) <> 10080 then
    raise exception 'per-source silence window not stored';
  end if;

  begin
    update public.sources set max_silence_minutes = 0 where id = sid;
    raise exception 'a non-positive silence window should be rejected';
  exception when check_violation then null; end;
  raise notice 'PASS — per-source silence window stored and validated';
end $$;

\echo ''
\echo '════════ ALL OPS CHECKS PASSED ════════'
