-- =============================================================================
-- 0003 — Tables (six, and only six)
--
-- Integrity constraints ONLY. No business rules live here:
--   * the >= 0.90 confidence threshold is a Publishing Gate node in n8n, not a
--     CHECK. The CHECK below only asserts that confidence is a probability.
--   * duplicate *policy* is an n8n decision; the UNIQUE index below is the
--     integrity backstop for the concurrent-execution race.
--   * health_status and next_run_at are STATE written by n8n. Postgres stores
--     them and never computes or acts on them.
--
-- updated_at is set explicitly by the writer rather than by a trigger, keeping
-- the schema free of triggers entirely.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- users — internal staff only. Rows are pre-created by an admin; there is no
-- self-provisioning path, so an authenticated Supabase user with no row here
-- has no access to anything (see 0005 — every policy fails closed on NULL).
-- -----------------------------------------------------------------------------
create table if not exists public.users (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null unique,
  full_name   text,
  role        public.user_role not null default 'viewer',
  active      boolean not null default true,
  created_at  timestamptz not null default now(),

  constraint users_email_lowercase check (email = lower(email)),
  constraint users_email_shape     check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);

comment on table public.users is
  'Internal users mirrored from auth.users. No row means no access — the platform is closed to pre-approved staff only.';

-- -----------------------------------------------------------------------------
-- sources — the trusted registry: identity, parser config, schedule, health.
-- -----------------------------------------------------------------------------
create table if not exists public.sources (
  id            uuid primary key default gen_random_uuid(),

  -- identity
  country       public.country_code not null,
  authority_ar  text not null,
  authority_en  text not null,
  source_type   public.source_type not null,
  base_url      text not null,
  active        boolean not null default true,

  -- parser strategy (plan §3)
  parser_type   public.parser_type not null,
  feed_url      text,
  parser_config jsonb not null default '{}'::jsonb,

  -- hard domain allow-list, checked by the Publishing Gate before insert
  allowed_domains text[] not null,

  -- scheduling (plan §6)
  priority              smallint not null,
  poll_interval_minutes integer,
  next_run_at           timestamptz,

  -- health snapshot (plan §8) — written by n8n at the end of every run
  health_status        public.health_status not null default 'never_run',
  last_run_at          timestamptz,
  last_success_at      timestamptz,
  last_failure_at      timestamptz,
  last_failure_reason  text,
  last_duration_ms     integer,
  last_items_fetched   integer not null default 0,
  last_items_published integer not null default 0,
  last_items_rejected  integer not null default 0,
  consecutive_failures integer not null default 0,

  -- retry state (plan §7)
  retry_attempt integer not null default 0,
  next_retry_at timestamptz,

  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint sources_priority_range        check (priority between 1 and 5),
  constraint sources_poll_interval_positive check (poll_interval_minutes is null or poll_interval_minutes > 0),
  constraint sources_base_url_scheme       check (base_url ~ '^https?://'),
  constraint sources_feed_url_scheme       check (feed_url is null or feed_url ~ '^https?://'),
  constraint sources_domains_present       check (cardinality(allowed_domains) > 0),
  -- Domains are compared case-insensitively at ingest; storing them lowercase
  -- keeps that comparison honest. Array-to-text cast avoids a subquery, which
  -- CHECK constraints forbid.
  constraint sources_domains_lowercase     check (allowed_domains::text = lower(allowed_domains::text)),
  -- A feed-driven parser without a feed URL cannot run: structural, not a rule.
  constraint sources_feed_required         check (parser_type not in ('rss', 'api') or feed_url is not null),
  constraint sources_config_is_object      check (jsonb_typeof(parser_config) = 'object'),
  constraint sources_counters_non_negative check (
    last_items_fetched >= 0 and last_items_published >= 0
    and last_items_rejected >= 0 and consecutive_failures >= 0
    and retry_attempt >= 0
  ),
  constraint sources_duration_non_negative check (last_duration_ms is null or last_duration_ms >= 0)
);

comment on table public.sources is
  'Trusted source registry. The platform never crawls anything absent from this table.';
comment on column public.sources.allowed_domains is
  'Lowercase hostname allow-list. The Publishing Gate rejects any item whose URL host is not listed.';
comment on column public.sources.poll_interval_minutes is
  'Per-source override of the priority tier default. NULL means use the tier interval from app_settings.';

-- -----------------------------------------------------------------------------
-- legal_updates — the archive. Written by n8n only (see 0005/0006).
-- -----------------------------------------------------------------------------
create table if not exists public.legal_updates (
  id           uuid primary key default gen_random_uuid(),
  source_id    uuid not null references public.sources (id) on delete restrict,

  -- sha256(source_id | url | title | publication_date), computed in n8n
  content_hash text not null,

  source_url   text not null,
  title_ar     text not null,
  summary_ar   text not null,

  country         public.country_code not null,
  category        public.legal_category not null,
  document_type   public.document_type not null,
  legal_status    public.legal_status not null,
  is_legal_update boolean not null,
  confidence      numeric(3, 2) not null,

  effective_date    date,
  publication_date  date not null,
  affected_entities text[] not null default '{}',
  keywords          text[] not null default '{}',

  -- verbatim source text. The AI never rewrites this; it exists so a lawyer can
  -- check the summary against what the authority actually published.
  raw_excerpt   text not null,
  document_path text,
  ai_model      text not null,
  created_at    timestamptz not null default now(),

  /*
   * Arabic-normalised search vector.
   *
   * Postgres ships no Arabic dictionary, so this uses the 'simple'
   * configuration over text normalised for the orthographic variation that
   * makes naive Arabic search miss obvious hits:
   *   hamza forms  أ إ آ ٱ -> ا      ؤ -> و      ئ -> ي
   *   teh marbuta  ة -> ه
   *   alef maksura ى -> ي
   *   tashkeel (U+064B–U+0652, U+0670) and tatweel (U+0640) are stripped.
   *
   * Written as literal codepoints so the intent survives any editor or
   * encoding. Queries must apply the SAME translate() before matching — the
   * M5 query layer wraps this so callers cannot forget.
   *
   * Weighting: title A, summary B. `keywords` is deliberately absent — casting
   * an array to text is not IMMUTABLE and so cannot appear in a generated
   * column. Keywords get their own GIN array index in 0004, which gives exact
   * containment matching rather than bag-of-words anyway.
   */
  search_vector tsvector generated always as (
    setweight(
      to_tsvector('simple', translate(title_ar,
        U&'\0623\0625\0622\0671\0629\0649\0624\0626\064B\064C\064D\064E\064F\0650\0651\0652\0670\0640',
        U&'\0627\0627\0627\0627\0647\064A\0648\064A')), 'A')
    ||
    setweight(
      to_tsvector('simple', translate(summary_ar,
        U&'\0623\0625\0622\0671\0629\0649\0624\0626\064B\064C\064D\064E\064F\0650\0651\0652\0670\0640',
        U&'\0627\0627\0627\0627\0647\064A\0648\064A')), 'B')
  ) stored,

  -- Integrity backstop for the race where two executions process one item
  -- concurrently. n8n still checks first and classifies the violation as a
  -- duplicate rather than surfacing a workflow failure.
  constraint legal_updates_content_hash_unique unique (content_hash),

  constraint legal_updates_hash_shape       check (content_hash ~ '^[a-f0-9]{64}$'),
  constraint legal_updates_confidence_range check (confidence >= 0 and confidence <= 1),
  constraint legal_updates_url_scheme       check (source_url ~ '^https?://'),
  constraint legal_updates_title_present    check (btrim(title_ar) <> ''),
  constraint legal_updates_summary_present  check (btrim(summary_ar) <> ''),
  constraint legal_updates_excerpt_present  check (btrim(raw_excerpt) <> '')
);

comment on table public.legal_updates is
  'Published legal and regulatory updates. Write-sealed against the web application: n8n (service_role) is the only writer.';
comment on column public.legal_updates.confidence is
  'AI confidence 0..1. The CHECK asserts it is a probability; the >= 0.90 publishing threshold is enforced by the n8n Publishing Gate, not here.';
comment on column public.legal_updates.raw_excerpt is
  'Verbatim source text, never AI-modified. Lets a reviewer verify the summary against the original.';

-- -----------------------------------------------------------------------------
-- workflow_logs — full execution history, written by n8n.
-- -----------------------------------------------------------------------------
create table if not exists public.workflow_logs (
  id            uuid primary key default gen_random_uuid(),
  workflow_name text not null,
  execution_id  text,
  source_id     uuid references public.sources (id) on delete set null,
  trigger_type  public.trigger_type not null,
  status        public.run_status not null,

  items_fetched   integer not null default 0,
  items_published integer not null default 0,
  items_rejected  integer not null default 0,

  -- {"low_confidence": 3, "duplicate": 5, "domain_mismatch": 1}
  rejection_reasons jsonb not null default '{}'::jsonb,

  error_message text,
  duration_ms   integer,
  retry_attempt integer not null default 0,

  -- set for manual runs (plan §9) so an operator-triggered run is attributable
  triggered_by uuid references public.users (id) on delete set null,

  started_at  timestamptz not null default now(),
  finished_at timestamptz,

  constraint workflow_logs_counters_non_negative check (
    items_fetched >= 0 and items_published >= 0 and items_rejected >= 0 and retry_attempt >= 0
  ),
  constraint workflow_logs_duration_non_negative check (duration_ms is null or duration_ms >= 0),
  constraint workflow_logs_finished_after_started check (finished_at is null or finished_at >= started_at),
  constraint workflow_logs_reasons_is_object check (jsonb_typeof(rejection_reasons) = 'object')
);

comment on table public.workflow_logs is
  'Execution history for every n8n run. Read-only to the application.';

-- -----------------------------------------------------------------------------
-- newsletter_history — one row per weekly digest attempt.
-- -----------------------------------------------------------------------------
create table if not exists public.newsletter_history (
  id           uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end   date not null,
  subject      text not null,

  recipients      text[] not null default '{}',
  recipient_count integer not null default 0,
  update_ids      uuid[] not null default '{}',

  html_body     text,
  status        public.newsletter_status not null,
  error_message text,
  sent_at       timestamptz,
  created_at    timestamptz not null default now(),

  constraint newsletter_period_ordered      check (period_end >= period_start),
  constraint newsletter_recipient_count_ok  check (recipient_count >= 0),
  constraint newsletter_sent_has_timestamp  check (status <> 'sent' or sent_at is not null)
);

comment on table public.newsletter_history is
  'Weekly digest history including skipped and failed runs, so a silent non-delivery is visible.';

-- -----------------------------------------------------------------------------
-- app_settings — admin-managed operational configuration (plan §2).
--
-- Key/value so adding a setting needs no migration. Keys are constrained in
-- shape AND screened against credential-shaped names: secrets belong in n8n
-- Credentials or the deployment secret manager, never here.
--
-- There is no INSERT or DELETE policy for application users (see 0005), so the
-- set of keys is fixed by migration. That is the database-level half of
-- "no arbitrary unvalidated keys from the UI"; the registry in
-- lib/settings/registry.ts is the application-level half.
-- -----------------------------------------------------------------------------
create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.users (id) on delete set null,

  constraint app_settings_key_shape check (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  -- Defence in depth against a credential ever being stored here.
  constraint app_settings_no_secret_keys check (
    key !~ '(secret|password|passwd|token|api_?key|credential|private_key|service_role)'
  )
);

comment on table public.app_settings is
  'Operational settings only. NEVER credentials — see the app_settings_no_secret_keys constraint.';
comment on column public.app_settings.updated_by is
  'Admin who last changed the value. Required by the audit constraint in the plan.';
