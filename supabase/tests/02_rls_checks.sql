-- =============================================================================
-- RLS checks — exercises the policies as anon, viewer, admin, deactivated
-- admin, and service_role (n8n).
--
-- Each block asserts and RAISEs on failure. Run with -v ON_ERROR_STOP=1.
--
-- NOTE ON METHOD: `set local role` + `set local request.jwt.claim.sub` inside a
-- transaction is how a real Supabase request is simulated. Anything that
-- passes here is enforced by the database, not by application code.
-- =============================================================================

-- Fixtures -------------------------------------------------------------------
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'admin@legal.internal'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'viewer@legal.internal'),
  ('cccccccc-0000-0000-0000-000000000003', 'former@legal.internal'),
  ('dddddddd-0000-0000-0000-000000000004', 'ghost@legal.internal')
on conflict (id) do nothing;

insert into public.users (id, email, full_name, role, active) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'admin@legal.internal',  'مسؤول النظام', 'admin',  true),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'viewer@legal.internal', 'مستشار قانوني', 'viewer', true),
  ('cccccccc-0000-0000-0000-000000000003', 'former@legal.internal', 'موظف سابق',    'admin',  false)
on conflict (id) do nothing;
-- note: dddddddd exists in auth.users but has NO public.users row — the
-- "authenticated but not provisioned" case.

\echo '── R1. anon can reach nothing ──────────────────────────────────────────'
do $$
declare n int; begin
  set local role anon;
  begin
    execute 'select count(*) from public.legal_updates' into n;
    reset role;
    raise exception 'SEAL BREACH: anon read legal_updates';
  exception when insufficient_privilege then
    reset role;
    raise notice 'PASS — anon denied (insufficient privilege)';
  end;
end $$;

\echo '── R2. authenticated-but-unprovisioned user sees nothing ───────────────'
do $$
declare n int; begin
  set local role authenticated;
  set local request.jwt.claim.sub = 'dddddddd-0000-0000-0000-000000000004';
  select count(*) into n from public.legal_updates;
  if n <> 0 then reset role; raise exception 'unprovisioned user saw % rows', n; end if;
  select count(*) into n from public.sources;
  if n <> 0 then reset role; raise exception 'unprovisioned user saw % sources', n; end if;
  reset role;
  raise notice 'PASS — no public.users row means no access (fails closed)';
end $$;

\echo '── R3. viewer reads the archive ────────────────────────────────────────'
do $$
declare n int; begin
  set local role authenticated;
  set local request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
  select count(*) into n from public.legal_updates;
  if n < 1 then reset role; raise exception 'viewer could not read archive'; end if;
  reset role;
  raise notice 'PASS — viewer reads legal_updates (% rows)', n;
end $$;

\echo '── R4. viewer CANNOT write the archive ─────────────────────────────────'
do $$
declare src uuid; begin
  select id into src from public.sources limit 1;
  set local role authenticated;
  set local request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
  begin
    insert into public.legal_updates (source_id, content_hash, source_url, title_ar,
      summary_ar, country, category, document_type, legal_status, is_legal_update,
      confidence, publication_date, raw_excerpt, ai_model)
    values (src, repeat('f',64), 'https://zatca.gov.sa/x','ع','ع','SA','tax','circular',
            'enacted', true, 0.99, current_date, 'ع', 'forged');
    reset role;
    raise exception 'SEAL BREACH: viewer inserted into legal_updates';
  exception when insufficient_privilege or check_violation then
    reset role;
    raise notice 'PASS — viewer INSERT into legal_updates denied';
  end;
end $$;

\echo '── R5. ADMIN also cannot write the archive (n8n-only, by design) ───────'
do $$
declare src uuid; begin
  select id into src from public.sources limit 1;
  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
  begin
    insert into public.legal_updates (source_id, content_hash, source_url, title_ar,
      summary_ar, country, category, document_type, legal_status, is_legal_update,
      confidence, publication_date, raw_excerpt, ai_model)
    values (src, repeat('9',64), 'https://zatca.gov.sa/x','ع','ع','SA','tax','circular',
            'enacted', true, 0.99, current_date, 'ع', 'forged');
    reset role;
    raise exception 'SEAL BREACH: admin inserted into legal_updates';
  exception when insufficient_privilege or check_violation then
    reset role;
    raise notice 'PASS — even an admin cannot write the archive from the app';
  end;

  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
  begin
    update public.legal_updates set confidence = 0.99;
    reset role;
    raise exception 'SEAL BREACH: admin updated legal_updates';
  exception when insufficient_privilege then
    reset role;
    raise notice 'PASS — admin UPDATE on legal_updates denied';
  end;

  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
  begin
    delete from public.legal_updates;
    reset role;
    raise exception 'SEAL BREACH: admin deleted from legal_updates';
  exception when insufficient_privilege then
    reset role;
    raise notice 'PASS — admin DELETE on legal_updates denied';
  end;
end $$;

\echo '── R6. workflow_logs and newsletter_history are equally sealed ─────────'
do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
  begin
    insert into public.workflow_logs (workflow_name, trigger_type, status)
    values ('forged','manual','success');
    reset role;
    raise exception 'SEAL BREACH: admin wrote workflow_logs';
  exception when insufficient_privilege or check_violation then
    reset role; raise notice 'PASS — workflow_logs INSERT denied';
  end;

  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
  begin
    insert into public.newsletter_history (period_start, period_end, subject, status)
    values (current_date, current_date, 'forged', 'sent');
    reset role;
    raise exception 'SEAL BREACH: admin wrote newsletter_history';
  exception when insufficient_privilege or check_violation then
    reset role; raise notice 'PASS — newsletter_history INSERT denied';
  end;
end $$;

\echo '── R7. viewer cannot manage sources; admin can ─────────────────────────'
do $$
declare n int; begin
  set local role authenticated;
  set local request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
  begin
    insert into public.sources (country, authority_ar, authority_en, source_type,
      base_url, parser_type, allowed_domains, priority)
    values ('SA','مصدر مزيف','Fake','government','https://fake.gov.sa','html',
            array['fake.gov.sa'], 1);
    reset role;
    raise exception 'viewer created a source';
  exception when insufficient_privilege or check_violation then
    reset role; raise notice 'PASS — viewer INSERT on sources denied';
  end;

  set local role authenticated;
  set local request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
  update public.sources set priority = 5;
  get diagnostics n = row_count;
  reset role;
  if n <> 0 then raise exception 'viewer updated % sources', n; end if;
  raise notice 'PASS — viewer UPDATE on sources affected 0 rows';

  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
  insert into public.sources (country, authority_ar, authority_en, source_type,
    base_url, parser_type, allowed_domains, priority)
  values ('AE','وزارة العدل','Ministry of Justice','government',
          'https://moj.gov.ae','html', array['moj.gov.ae'], 2);
  get diagnostics n = row_count;
  reset role;
  if n <> 1 then raise exception 'admin could not create a source'; end if;
  raise notice 'PASS — admin created a source';
end $$;

\echo '── R8. app_settings is invisible to a viewer (admin-only READ) ─────────'
do $$
declare n int; begin
  set local role authenticated;
  set local request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
  select count(*) into n from public.app_settings;
  reset role;
  if n <> 0 then raise exception 'viewer read % settings', n; end if;
  raise notice 'PASS — viewer sees 0 settings';

  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
  select count(*) into n from public.app_settings;
  reset role;
  if n <> 10 then raise exception 'admin saw % settings, expected 10', n; end if;
  raise notice 'PASS — admin sees all 10 settings';
end $$;

\echo '── R9. viewer cannot change settings; admin can, with attribution ──────'
do $$
declare n int; v jsonb; who uuid; begin
  set local role authenticated;
  set local request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
  update public.app_settings set value='0.10'::jsonb where key='ai.confidence_threshold';
  get diagnostics n = row_count;
  reset role;
  if n <> 0 then raise exception 'viewer changed the confidence threshold'; end if;
  raise notice 'PASS — viewer UPDATE on app_settings affected 0 rows';

  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
  update public.app_settings
     set value='0.95'::jsonb, updated_at=now(), updated_by=auth.uid()
   where key='ai.confidence_threshold';
  reset role;

  select value, updated_by into v, who from public.app_settings where key='ai.confidence_threshold';
  if v::numeric <> 0.95 then raise exception 'admin update did not apply'; end if;
  if who <> 'aaaaaaaa-0000-0000-0000-000000000001' then
    raise exception 'updated_by not recorded';
  end if;
  raise notice 'PASS — admin updated setting; updated_by recorded';
end $$;

\echo '── R10. admin cannot INSERT a new settings key from the app ────────────'
do $$
begin
  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
  begin
    insert into public.app_settings(key, value) values ('rogue.key','"x"'::jsonb);
    reset role;
    raise exception 'admin introduced an arbitrary settings key';
  exception when insufficient_privilege or check_violation then
    reset role;
    raise notice 'PASS — arbitrary key rejected at the database layer';
  end;
end $$;

\echo '── R11. DEACTIVATED admin loses everything immediately ─────────────────'
do $$
declare n int; begin
  set local role authenticated;
  set local request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000003';
  select count(*) into n from public.legal_updates;
  if n <> 0 then reset role; raise exception 'deactivated admin read archive'; end if;
  select count(*) into n from public.app_settings;
  if n <> 0 then reset role; raise exception 'deactivated admin read settings'; end if;
  reset role;
  raise notice 'PASS — active=false revokes access without any code change';
end $$;

\echo '── R12. viewer sees only their own user row ────────────────────────────'
do $$
declare n int; begin
  set local role authenticated;
  set local request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
  select count(*) into n from public.users;
  reset role;
  if n <> 1 then raise exception 'viewer saw % user rows, expected 1', n; end if;
  raise notice 'PASS — viewer sees 1 user row (self)';

  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
  select count(*) into n from public.users;
  reset role;
  if n < 3 then raise exception 'admin saw % user rows', n; end if;
  raise notice 'PASS — admin sees all user rows (%)', n;
end $$;

\echo '── R13. viewer cannot escalate their own role ──────────────────────────'
do $$
declare n int; r public.user_role; begin
  set local role authenticated;
  set local request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
  update public.users set role='admin' where id = auth.uid();
  get diagnostics n = row_count;
  reset role;
  select role into r from public.users where id='bbbbbbbb-0000-0000-0000-000000000002';
  if n <> 0 or r <> 'viewer' then
    raise exception 'PRIVILEGE ESCALATION: viewer became %', r;
  end if;
  raise notice 'PASS — viewer cannot self-promote to admin';
end $$;

\echo '── R14. service_role (n8n) can write everything ────────────────────────'
do $$
declare src uuid; n int; begin
  select id into src from public.sources limit 1;
  set local role service_role;

  insert into public.legal_updates (source_id, content_hash, source_url, title_ar,
    summary_ar, country, category, document_type, legal_status, is_legal_update,
    confidence, publication_date, raw_excerpt, ai_model)
  values (src, repeat('1',64), 'https://zatca.gov.sa/n8n','عنوان من n8n','ملخص','SA',
          'tax','circular','enacted', true, 0.96, current_date, 'نص', 'claude');

  insert into public.workflow_logs (workflow_name, trigger_type, status, source_id,
    items_fetched, items_published, items_rejected, rejection_reasons)
  values ('source-crawler','scheduled','success', src, 10, 3, 7,
          '{"duplicate":5,"low_confidence":2}'::jsonb);

  insert into public.newsletter_history (period_start, period_end, subject, status,
    recipients, recipient_count, sent_at)
  values (current_date - 7, current_date, 'التحديثات القانونية الأسبوعية','sent',
          array['legal@internal'], 1, now());

  update public.sources
     set health_status='healthy', last_success_at=now(), last_run_at=now(),
         last_items_fetched=10, last_items_published=3, last_items_rejected=7,
         consecutive_failures=0, retry_attempt=0, next_run_at=now()+interval '1 hour'
   where id = src;

  select count(*) into n from public.legal_updates;
  reset role;
  raise notice 'PASS — service_role wrote archive, logs, newsletter and health (% updates total)', n;
end $$;

\echo '── R15. the search path is not hijackable ──────────────────────────────'
do $$
declare cfg text[]; begin
  select p.proconfig into cfg
  from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
  where ns.nspname='public' and p.proname='current_user_role';

  if cfg is null or not (cfg @> array['search_path=public, pg_temp']) then
    raise exception 'current_user_role() must pin its search_path, found %', cfg;
  end if;
  raise notice 'PASS — current_user_role() has a pinned search_path';
end $$;

\echo ''
\echo '════════ ALL RLS CHECKS PASSED ════════'
