-- =============================================================================
-- 0015 — Operational columns on `sources`
--
-- Locking, retry metadata, staleness window, alert cooldown and the derived
-- health score. All additive; no existing column changes type or drops.
-- =============================================================================

alter table public.sources
  -- ── concurrency (durable, per-source, no global lock) ───────────────────
  add column if not exists lock_owner       text,
  add column if not exists lock_acquired_at timestamptz,
  add column if not exists lock_expires_at  timestamptz,

  -- ── retry metadata ──────────────────────────────────────────────────────
  add column if not exists first_attempt_at timestamptz,
  add column if not exists last_error_code  text,

  -- ── staleness: per-source, because a weekly gazette is not a daily feed ─
  add column if not exists max_silence_minutes integer,

  -- ── alert cooldown, to stop notification storms ─────────────────────────
  add column if not exists last_alert_kind text,
  add column if not exists last_alert_at   timestamptz,

  -- ── derived health, refreshed by the snapshot workflow ──────────────────
  add column if not exists health_score smallint,
  add column if not exists last_http_status integer;

comment on column public.sources.lock_expires_at is
  'Lock lease. An execution that crashes leaves the lock behind; it expires on its own so the source is never permanently stuck.';
comment on column public.sources.max_silence_minutes is
  'How long this source may legitimately publish nothing before it is called stale. NULL uses the global default. A weekly gazette must not be judged by a daily yardstick.';
comment on column public.sources.health_score is
  '0-100, computed by the health snapshot. Duplicates and gate rejections never reduce it — they are normal outcomes, not operational faults.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sources_health_score_range') then
    alter table public.sources add constraint sources_health_score_range
      check (health_score is null or health_score between 0 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sources_max_silence_positive') then
    alter table public.sources add constraint sources_max_silence_positive
      check (max_silence_minutes is null or max_silence_minutes > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sources_lock_consistent') then
    alter table public.sources add constraint sources_lock_consistent
      check ((lock_owner is null) = (lock_expires_at is null));
  end if;
end $$;

-- Lock sweep: find expired locks cheaply.
create index if not exists sources_lock_expiry_idx
  on public.sources (lock_expires_at)
  where lock_expires_at is not null;
