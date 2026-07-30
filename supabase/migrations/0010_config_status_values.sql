-- =============================================================================
-- 0010 — config_status gains the two access-obstacle states
--
--   blocked_by_access     the site cannot be reached lawfully from the
--                         production egress: WAF, geo-block, or robots.txt
--                         disallow. Needs an infrastructure or access decision,
--                         never a workaround.
--   requires_subscription lawful access exists but needs a paid or signed
--                         arrangement that has not been made yet.
--
-- Neither is activatable — 0011 tightens sources_no_active_pending so only
-- 'verified' may go live.
--
-- Alone in its file: Postgres refuses to use a new enum value in the
-- transaction that added it. Same rule as 0007.
-- =============================================================================

alter type public.config_status add value if not exists 'blocked_by_access';
alter type public.config_status add value if not exists 'requires_subscription';
