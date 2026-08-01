-- =============================================================================
-- 0017 — job_dead_letters  (NEW TABLE, 8th)
--
-- An item that exhausted its retries. Holds enough to understand the failure,
-- identify the source and original URL, see which stage failed, and replay it
-- safely.
--
-- ┌─ THE ORIGINAL RECORD IS NEVER MUTATED ─────────────────────────────────────┐
-- │ A replay creates a NEW execution; it does not edit this row's failure      │
-- │ history. replay_count and last_replay_at record that a replay happened,    │
-- │ and resolution is recorded separately. The incident stays readable         │
-- │ forever — an operator asking "what went wrong last March" must not find    │
-- │ the evidence overwritten by a later success.                               │
-- └────────────────────────────────────────────────────────────────────────────┘
--
-- NO SECRETS. `payload` holds the RawItem — URL, title, extracted text. It must
-- never carry an API key, authorization header, or credential; the workflow
-- strips headers before writing here and a CHECK rejects credential-shaped keys.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'dead_letter_stage') then
    create type public.dead_letter_stage as enum (
      'fetch', 'extract', 'ai_classify', 'hash', 'publish', 'unknown'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'dead_letter_state') then
    create type public.dead_letter_state as enum ('open', 'replayed', 'dismissed', 'resolved');
  end if;
end $$;

create table if not exists public.job_dead_letters (
  id        uuid primary key default gen_random_uuid(),
  source_id uuid references public.sources (id) on delete set null,

  -- what failed
  stage         public.dead_letter_stage not null default 'unknown',
  item_url      text,
  content_hash  text,
  error_code    text not null,
  error_message text,

  -- retry history at the point of death
  attempt_number   integer not null default 0,
  max_attempts     integer not null default 0,
  first_attempt_at timestamptz,
  last_attempt_at  timestamptz,
  workflow_execution_id text,

  -- the original payload, secret-free
  payload jsonb not null default '{}'::jsonb,

  -- lifecycle
  state           public.dead_letter_state not null default 'open',
  replay_count    integer not null default 0,
  last_replay_at  timestamptz,
  resolution_note text,
  resolved_at     timestamptz,
  resolved_by     uuid references public.users (id) on delete set null,

  created_at timestamptz not null default now(),

  constraint dead_letter_counts_non_negative check (
    attempt_number >= 0 and max_attempts >= 0 and replay_count >= 0
  ),
  constraint dead_letter_payload_is_object check (jsonb_typeof(payload) = 'object'),
  -- Defence in depth: the payload must not carry credential-shaped keys.
  constraint dead_letter_payload_no_secrets check (
    not (payload::text ~* '"(authorization|api[_-]?key|x-api-key|secret|password|token|service_role)"')
  ),
  constraint dead_letter_resolution_recorded check (
    state <> 'resolved' or resolved_at is not null
  ),
  constraint dead_letter_hash_shape check (
    content_hash is null or content_hash ~ '^[a-f0-9]{64}$'
  )
);

comment on table public.job_dead_letters is
  'Items that exhausted their retries. Append-and-annotate: a replay adds history, it never erases the original failure.';
comment on column public.job_dead_letters.payload is
  'The original RawItem. Never contains credentials — the workflow strips headers and a CHECK rejects credential-shaped keys.';

/*
 * Idempotency: one open dead letter per (source, hash). A retry that dies again
 * must not create a second row for the same item. Partial, so a resolved
 * incident does not block a genuinely new failure of the same item later.
 */
create unique index if not exists dead_letters_open_unique
  on public.job_dead_letters (source_id, content_hash)
  where state = 'open' and content_hash is not null;

create index if not exists dead_letters_state_time_idx
  on public.job_dead_letters (state, created_at desc);

create index if not exists dead_letters_source_idx
  on public.job_dead_letters (source_id, created_at desc);

-- Read for any active user; only an admin may annotate. n8n writes via
-- service_role. Deletion is granted to nobody — a dead letter is a record.
alter table public.job_dead_letters enable row level security;
revoke all on public.job_dead_letters from anon, authenticated;
grant select, update on public.job_dead_letters to authenticated;
grant all on public.job_dead_letters to service_role;

drop policy if exists dead_letters_select on public.job_dead_letters;
create policy dead_letters_select on public.job_dead_letters
  for select to authenticated
  using (public.current_user_role() is not null);

drop policy if exists dead_letters_update on public.job_dead_letters;
create policy dead_letters_update on public.job_dead_letters
  for update to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');
