-- =============================================================================
-- 0005 — Access control: role predicate, RLS policies, grants and REVOKEs
--
-- ┌─ ON THE ONE FUNCTION IN THIS SCHEMA ───────────────────────────────────────┐
-- │                                                                            │
-- │ public.current_user_role() is an ACCESS-CONTROL PREDICATE, not business    │
-- │ logic. It answers "who is calling?" and nothing else: no thresholds, no    │
-- │ publishing decisions, no retry or duplicate handling. All of that lives in │
-- │ n8n, as directed.                                                          │
-- │                                                                            │
-- │ It exists because Postgres RLS leaves no alternative. A policy on          │
-- │ public.users that inspects public.users to find the caller's role recurses │
-- │ into itself; Postgres aborts the query with                                │
-- │                                                                            │
-- │     ERROR: infinite recursion detected in policy for relation "users"      │
-- │                                                                            │
-- │ (verified locally — see supabase/tests/02_rls_checks.sql). A SECURITY      │
-- │ DEFINER lookup reads the row outside RLS and breaks the cycle. It is also  │
-- │ the documented Supabase pattern.                                           │
-- │                                                                            │
-- │ Safety properties:                                                         │
-- │   * STABLE — evaluated once per statement, not once per row                │
-- │   * fixed search_path, so it cannot be hijacked by a shadowed table        │
-- │   * EXECUTE revoked from PUBLIC and anon; granted to authenticated only    │
-- │   * returns NULL for an unknown, inactive, or unauthenticated caller, and  │
-- │     every policy below treats NULL as "no access" — it fails closed        │
-- └────────────────────────────────────────────────────────────────────────────┘
-- =============================================================================

create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.role
  from public.users u
  where u.id = auth.uid()
    and u.active
$$;

comment on function public.current_user_role() is
  'Access-control predicate: role of the calling user, or NULL if unknown/inactive. Contains no business logic. SECURITY DEFINER is required to avoid RLS self-recursion on public.users.';

revoke execute on function public.current_user_role() from public;
revoke execute on function public.current_user_role() from anon;
grant execute on function public.current_user_role() to authenticated;

-- =============================================================================
-- Baseline: deny everything, then grant back deliberately.
--
-- Supabase's default privileges grant broad access on new tables in `public` to
-- anon and authenticated. These REVOKEs undo that, so every privilege below is
-- one somebody chose to give.
-- =============================================================================

revoke all on public.users              from anon, authenticated;
revoke all on public.sources            from anon, authenticated;
revoke all on public.legal_updates      from anon, authenticated;
revoke all on public.workflow_logs      from anon, authenticated;
revoke all on public.newsletter_history from anon, authenticated;
revoke all on public.app_settings       from anon, authenticated;

-- anon keeps nothing at all: this platform has no public surface.
revoke usage on schema public from anon;

-- n8n. service_role additionally carries BYPASSRLS, so policies do not apply
-- to it — the grants below are what make the writes possible in the first place.
grant usage on schema public, extensions to service_role;
grant all on public.users, public.sources, public.legal_updates,
             public.workflow_logs, public.newsletter_history, public.app_settings
  to service_role;

-- Trigram operators must be resolvable for search queries.
grant usage on schema extensions to authenticated;

-- =============================================================================
-- Row Level Security
-- =============================================================================

alter table public.users              enable row level security;
alter table public.sources            enable row level security;
alter table public.legal_updates      enable row level security;
alter table public.workflow_logs      enable row level security;
alter table public.newsletter_history enable row level security;
alter table public.app_settings       enable row level security;

-- -----------------------------------------------------------------------------
-- legal_updates / workflow_logs / newsletter_history — READ ONLY to the app.
--
-- Write-sealed twice over:
--   1. no INSERT/UPDATE/DELETE policy exists, and RLS denies by default
--   2. the privileges themselves are revoked above and never granted back
--
-- Belt and braces on purpose: if someone later adds a write policy by mistake,
-- the missing grant still blocks the write.
-- -----------------------------------------------------------------------------
grant select on public.legal_updates      to authenticated;
grant select on public.workflow_logs      to authenticated;
grant select on public.newsletter_history to authenticated;

drop policy if exists legal_updates_select on public.legal_updates;
create policy legal_updates_select on public.legal_updates
  for select to authenticated
  using (public.current_user_role() is not null);

drop policy if exists workflow_logs_select on public.workflow_logs;
create policy workflow_logs_select on public.workflow_logs
  for select to authenticated
  using (public.current_user_role() is not null);

drop policy if exists newsletter_history_select on public.newsletter_history;
create policy newsletter_history_select on public.newsletter_history
  for select to authenticated
  using (public.current_user_role() is not null);

-- -----------------------------------------------------------------------------
-- sources — everyone reads, admin manages.
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on public.sources to authenticated;

drop policy if exists sources_select on public.sources;
create policy sources_select on public.sources
  for select to authenticated
  using (public.current_user_role() is not null);

drop policy if exists sources_insert on public.sources;
create policy sources_insert on public.sources
  for insert to authenticated
  with check (public.current_user_role() = 'admin');

drop policy if exists sources_update on public.sources;
create policy sources_update on public.sources
  for update to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- Deleting a source with archived updates is blocked by the ON DELETE RESTRICT
-- foreign key. Deactivation is the intended path; the archive must not lose its
-- provenance.
drop policy if exists sources_delete on public.sources;
create policy sources_delete on public.sources
  for delete to authenticated
  using (public.current_user_role() = 'admin');

-- -----------------------------------------------------------------------------
-- users — self-read for everyone, full management for admin.
--
-- No DELETE policy: removing a user would orphan the workflow_logs.triggered_by
-- attribution. Deactivation (active = false) is the supported action, and
-- current_user_role() returns NULL for an inactive user, so access stops
-- immediately.
-- -----------------------------------------------------------------------------
grant select, insert, update on public.users to authenticated;

drop policy if exists users_select on public.users;
create policy users_select on public.users
  for select to authenticated
  using (id = auth.uid() or public.current_user_role() = 'admin');

drop policy if exists users_insert on public.users;
create policy users_insert on public.users
  for insert to authenticated
  with check (public.current_user_role() = 'admin');

drop policy if exists users_update on public.users;
create policy users_update on public.users
  for update to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- -----------------------------------------------------------------------------
-- app_settings — admin only for READ as well as write.
--
-- A viewer has no SELECT policy, so the table is invisible to them entirely.
--
-- No INSERT and no DELETE policy for application users: the set of keys is
-- fixed by migration 0006. This is the database half of "no arbitrary
-- unvalidated keys from the UI" — even a compromised admin session cannot
-- introduce a new key, only change the value of a known one. The registry in
-- lib/settings/registry.ts validates the value shapes (M7).
-- -----------------------------------------------------------------------------
grant select, update on public.app_settings to authenticated;

drop policy if exists app_settings_select on public.app_settings;
create policy app_settings_select on public.app_settings
  for select to authenticated
  using (public.current_user_role() = 'admin');

drop policy if exists app_settings_update on public.app_settings;
create policy app_settings_update on public.app_settings
  for update to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');
