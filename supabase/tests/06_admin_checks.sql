-- =============================================================================
-- Admin area checks (M7)
--
-- The Server Actions produce clear Arabic messages, but the database is what
-- actually holds. These checks exercise the constraints and policies an admin
-- mutation depends on, as the roles that would attempt them.
-- =============================================================================

\echo '── M1. a VIEWER cannot mutate anything in the admin area ───────────────'
do $$
declare n int; begin
  set local role authenticated;
  set local request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';

  update public.sources set priority = 1;
  get diagnostics n = row_count;
  if n <> 0 then reset role; raise exception 'viewer updated % sources', n; end if;

  update public.users set role = 'admin';
  get diagnostics n = row_count;
  if n <> 0 then reset role; raise exception 'viewer updated % users', n; end if;

  update public.app_settings set value = '0.1'::jsonb;
  get diagnostics n = row_count;
  if n <> 0 then reset role; raise exception 'viewer updated % settings', n; end if;

  reset role;
  raise notice 'PASS — viewer mutations on sources, users and settings all affect 0 rows';
end $$;

\echo '── M2. a DEACTIVATED admin cannot mutate anything ──────────────────────'
do $$
declare n int; begin
  set local role authenticated;
  -- cccccccc is role=admin but active=false
  set local request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000003';

  update public.sources set priority = 1;
  get diagnostics n = row_count;
  if n <> 0 then reset role; raise exception 'deactivated admin updated % sources', n; end if;

  update public.app_settings set value = '0.1'::jsonb;
  get diagnostics n = row_count;
  if n <> 0 then reset role; raise exception 'deactivated admin updated % settings', n; end if;

  reset role;
  raise notice 'PASS — deactivated admin is refused by current_user_role() returning NULL';
end $$;

\echo '── M3. an admin cannot introduce a settings key ────────────────────────'
do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
  begin
    insert into public.app_settings(key, value) values ('rogue.key', '"x"'::jsonb);
    reset role;
    raise exception 'admin introduced an arbitrary settings key';
  exception when insufficient_privilege or check_violation then
    reset role;
    raise notice 'PASS — no INSERT path for settings keys, even for an admin';
  end;
end $$;

\echo '── M4. credential-shaped setting keys are rejected ─────────────────────'
do $$
declare k text; begin
  foreach k in array array['x.api_key','y.password','z.webhook_secret','w.service_role'] loop
    begin
      insert into public.app_settings(key, value) values (k, '"x"'::jsonb);
      raise exception 'SECURITY: credential key % accepted', k;
    exception when check_violation then null; end;
  end loop;
  raise notice 'PASS — credential-shaped keys rejected by CHECK';
end $$;

\echo '── M5. a pending / blocked / subscription source cannot be activated ───'
do $$
declare sid uuid; st public.config_status; begin
  select id into sid from public.sources
   where config_status = 'pending_verification' and not active limit 1;

  foreach st in array array['pending_verification','blocked_by_access','requires_subscription']::public.config_status[]
  loop
    update public.sources set config_status = st where id = sid;
    begin
      update public.sources set active = true where id = sid;
      raise exception 'SAFETY: a % source was activated', st;
    exception when check_violation then null; end;
  end loop;

  update public.sources set config_status = 'pending_verification' where id = sid;
  raise notice 'PASS — only a verified source can be activated';
end $$;

\echo '── M6. verification itself is gated on real configuration ──────────────'
do $$
declare sid uuid; begin
  select id into sid from public.sources
   where parser_type = 'unknown' and not active limit 1;

  begin
    update public.sources set config_status = 'verified' where id = sid;
    raise exception 'a source with parser_type=unknown was marked verified';
  exception when check_violation then null; end;

  begin
    update public.sources set config_status = 'verified', parser_type = 'html' where id = sid;
    raise exception 'an html source with empty parser_config was marked verified';
  exception when check_violation then null; end;

  update public.sources set parser_type = 'unknown' where id = sid;
  raise notice 'PASS — verification requires a parser type and, for html/pdf, selectors';
end $$;

\echo '── M7. the Bahrain exclusion rule still holds ──────────────────────────'
do $$
declare a uuid; b uuid; begin
  select id into a from public.sources where authority_en = 'Legislation and Legal Opinion Commission';
  select id into b from public.sources where authority_en = 'LLOC Legislation Portal';
  if a is null or b is null then raise exception 'Bahrain LLOC pair missing from the registry'; end if;

  update public.sources
     set parser_type = 'html',
         parser_config = '{"list":".x","title":"a","link":"a@href","date":".d"}'::jsonb,
         config_status = 'verified'
   where id in (a, b);

  update public.sources set active = true where id = a;
  begin
    update public.sources set active = true where id = b;
    raise exception 'DUPLICATION RISK: both Bahrain LLOC sources went active';
  exception when unique_violation then null; end;

  update public.sources
     set active = false, config_status = 'pending_verification',
         parser_type = 'unknown', parser_config = '{}'::jsonb
   where id in (a, b);
  raise notice 'PASS — at most one member of an exclusion group can be active';
end $$;

\echo '── M8. a source cannot point outside its own trusted domains ───────────'
do $$
declare sid uuid; begin
  select id into sid from public.sources where authority_en = 'ZZ Fixture Source';
  begin
    update public.sources set base_url = 'https://attacker.example.com/x' where id = sid;
    raise exception 'SECURITY: base_url moved outside allowed_domains';
  exception when check_violation then null; end;
  raise notice 'PASS — base_url host must remain in allowed_domains';
end $$;

\echo '── M9. admin edits are attributable ────────────────────────────────────'
do $$
declare sid uuid; who uuid; when_ timestamptz; begin
  select id into sid from public.sources where authority_en = 'ZZ Fixture Source';

  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
  update public.sources
     set notes = 'edited by admin', updated_at = now(), updated_by = auth.uid()
   where id = sid;
  reset role;

  select updated_by, updated_at into who, when_ from public.sources where id = sid;
  if who <> 'aaaaaaaa-0000-0000-0000-000000000001' then
    raise exception 'updated_by not recorded';
  end if;
  if when_ is null then raise exception 'updated_at not recorded'; end if;
  raise notice 'PASS — source edits record updated_by and updated_at';
end $$;

\echo '── M10. the archive gained no write path from the admin area ───────────'
do $$
declare r record; begin
  -- Re-assert the M2 seal after everything M7 added.
  for r in
    select t.tbl, rl.role_name, pr.priv
    from unnest(array['legal_updates']) as t(tbl)
    cross join unnest(array['anon','authenticated'])                        as rl(role_name)
    cross join unnest(array['INSERT','UPDATE','DELETE','TRUNCATE'])         as pr(priv)
  loop
    if has_table_privilege(r.role_name, 'public.' || r.tbl, r.priv) then
      raise exception 'SEAL BREACH: % gained % on %', r.role_name, r.priv, r.tbl;
    end if;
  end loop;
  raise notice 'PASS — archive tables still have no write grant for app users';
end $$;

\echo '── M11. users table still refuses self-service escalation ──────────────'
do $$
declare n int; r public.user_role; begin
  set local role authenticated;
  set local request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
  update public.users set role = 'admin', active = true where id = auth.uid();
  get diagnostics n = row_count;
  reset role;

  select role into r from public.users where id = 'bbbbbbbb-0000-0000-0000-000000000002';
  if n <> 0 or r <> 'viewer' then
    raise exception 'PRIVILEGE ESCALATION: viewer became %', r;
  end if;
  raise notice 'PASS — a viewer cannot promote themselves';
end $$;

\echo ''
\echo '════════ ALL ADMIN CHECKS PASSED ════════'
