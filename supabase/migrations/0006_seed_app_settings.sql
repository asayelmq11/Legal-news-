-- =============================================================================
-- 0006 — Seed app_settings with safe defaults
--
-- Idempotent: ON CONFLICT DO NOTHING, so re-running never overwrites a value an
-- admin has tuned. Adding a NEW key later means a new migration — deliberate,
-- because there is no INSERT policy for application users (see 0005).
--
-- Values here are OPERATIONAL ONLY. No credentials, ever; the
-- app_settings_no_secret_keys constraint rejects credential-shaped key names.
--
-- Two keys are security-sensitive and must FAIL CLOSED in the application if
-- absent or malformed, rather than silently falling back:
--   * ai.confidence_threshold  — a fallback could quietly widen what publishes
--   * newsletter.recipients    — a fallback could send legal content off-list
-- They are seeded here so the healthy path is never missing, but the M7
-- registry still treats absence as an error rather than a default.
-- =============================================================================

insert into public.app_settings (key, value, description) values

  ('ai.confidence_threshold',
   '0.90'::jsonb,
   'Minimum AI confidence for publication. Enforced by the n8n Publishing Gate, never by the database. FAIL-CLOSED: if missing or malformed, the gate must reject every item.'),

  ('ingestion.failure_alert_threshold',
   '5'::jsonb,
   'Consecutive source failures before health_status becomes ''failing'' and an alert is raised.'),

  ('ingestion.priority_intervals',
   '{"1": 60, "2": 180, "3": 360, "4": 720, "5": 1440}'::jsonb,
   'Polling interval in minutes per priority tier. A source''s poll_interval_minutes overrides its tier.'),

  ('ingestion.retry_backoff_minutes',
   '[5, 15, 45, 120, 360]'::jsonb,
   'Ascending backoff delays for persistent cross-execution retries. Length also caps the retry count.'),

  ('health.stale_after_minutes',
   '1440'::jsonb,
   'A source with no successful run within this window is treated as stale on the dashboard.'),

  ('health.empty_run_threshold',
   '3'::jsonb,
   'Consecutive successful-but-empty runs before a source is flagged ''degraded'' — catches a silently broken selector.'),

  ('newsletter.enabled',
   'false'::jsonb,
   'Master switch for the weekly digest. Ships disabled so no mail is sent before recipients are configured.'),

  ('newsletter.recipients',
   '[]'::jsonb,
   'Recipient email addresses. FAIL-CLOSED: an empty or missing list aborts the newsletter run and records status ''failed''.'),

  ('newsletter.schedule',
   '{"day": 0, "hour": 7}'::jsonb,
   'Weekly send time. day: 0=Sunday..6=Saturday, hour: 0-23, interpreted in app.timezone.'),

  ('app.timezone',
   '"Asia/Riyadh"'::jsonb,
   'IANA timezone for date grouping, digest windows and display.')

on conflict (key) do nothing;
