-- =============================================================================
-- 0025 — Fix Oman discovery feed: disambiguate 'عمان' from 'عمّان' (Amman, Jordan)
--
-- The Oman Google News discovery feed (seeded in 0022) built its query from
-- the bare, undiacritized Arabic string 'عمان'. Real-world Arabic news text
-- almost never carries the shadda that distinguishes 'عُمان' (Oman) from
-- 'عَمّان' (Amman, Jordan's capital), so the feed silently pulled in
-- Jordanian/Amman news alongside genuine Omani legal news. Combined with the
-- Publishing Gate trusting the AI's country classification whenever it said
-- 'GCC' (tightened in the same change as this migration), some of that
-- Jordanian content was ultimately mis-published under country = 'GCC'.
--
-- Fix: rebuild the feed_url with 'سلطنة عمان' ("Sultanate of Oman") instead
-- of the bare country name — see lib/discovery/discovery.ts COUNTRY_NAMES_AR
-- for the corresponding code-level fix and rationale. Scoped to exactly the
-- one Oman discovery pseudo-source row; no other source is touched.
-- =============================================================================

update public.sources
set feed_url = 'https://news.google.com/rss/search?q=(%22%D9%82%D8%B1%D8%A7%D8%B1%20%D9%88%D8%B2%D8%A7%D8%B1%D9%8A%22%20OR%20%22%D9%82%D8%B1%D8%A7%D8%B1%20%D9%85%D8%AC%D9%84%D8%B3%20%D8%A7%D9%84%D9%88%D8%B2%D8%B1%D8%A7%D8%A1%22%20OR%20%22%D9%84%D8%A7%D8%A6%D8%AD%D8%A9%20%D8%AA%D9%86%D9%81%D9%8A%D8%B0%D9%8A%D8%A9%22%20OR%20%22%D9%85%D8%B1%D8%B3%D9%88%D9%85%22%20OR%20%22%D8%AA%D8%B9%D9%85%D9%8A%D9%85%22%20OR%20%22%D8%A7%D9%84%D8%AC%D8%B1%D9%8A%D8%AF%D8%A9%20%D8%A7%D9%84%D8%B1%D8%B3%D9%85%D9%8A%D8%A9%22%20OR%20%22%D9%85%D8%AC%D9%84%D8%B3%20%D8%A7%D9%84%D9%88%D8%B2%D8%B1%D8%A7%D8%A1%22%20OR%20%22%D9%85%D8%B4%D8%B1%D9%88%D8%B9%20%D9%82%D8%A7%D9%86%D9%88%D9%86%22)%20%D8%B3%D9%84%D8%B7%D9%86%D8%A9%20%D8%B9%D9%85%D8%A7%D9%86%20when%3A2d&hl=ar&gl=OM&ceid=OM:ar'
where country = 'OM'
  and authority_en = 'Google News Discovery — Oman'
  and source_type = 'discovery_engine';
