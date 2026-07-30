-- =============================================================================
-- LOCAL VERIFICATION BOOTSTRAP — DO NOT RUN AGAINST SUPABASE
--
-- Supabase provides the `auth` schema, the anon/authenticated/service_role
-- roles, and auth.uid() out of the box. A vanilla Postgres instance does not,
-- so this file stubs the minimum needed to apply and exercise the migrations
-- locally.
--
-- The stubs are deliberately faithful to Supabase's real behaviour:
--   * service_role has BYPASSRLS, as it does on Supabase
--   * auth.uid() reads a session GUC, letting tests impersonate a user
-- =============================================================================

-- Roles ----------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    -- Matches Supabase: bypasses RLS entirely. This is the n8n identity.
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;

-- auth schema ----------------------------------------------------------------
create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text unique
);

/*
 * Stub of Supabase's auth.uid(). The real one decodes the request JWT; this
 * reads a session-local GUC so a test can say "act as this user":
 *
 *   set local role authenticated;
 *   set local request.jwt.claim.sub = '<uuid>';
 */
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant select on auth.users to service_role;
