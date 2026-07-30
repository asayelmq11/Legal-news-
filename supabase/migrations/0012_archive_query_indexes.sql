-- =============================================================================
-- 0012 — Indexes for the archive query paths introduced in M5
--
-- The M5 filter set is: country · category · document_type · legal_status ·
-- affected_entities · publication date range · effective date range · source ·
-- confidence range (admin). Auditing those against migration 0004 found two
-- filters with no supporting index, and one deliberately left unindexed.
--
-- Only what is needed. An index that is never chosen is pure write cost on
-- every insert n8n makes.
-- =============================================================================

-- --------------------------------------------------------------------------
-- legal_status + date
--
-- 0004 gave country, category and document_type a "filter then sort" composite
-- but not legal_status, which the M5 UI exposes as a first-class filter.
-- Without this, filtering to 'effective' would scan and re-sort.
-- --------------------------------------------------------------------------
create index if not exists legal_updates_legal_status_date_idx
  on public.legal_updates (legal_status, publication_date desc);

-- --------------------------------------------------------------------------
-- effective_date range
--
-- Distinct from publication_date and independently filterable: "what comes into
-- force next quarter" is a different question from "what was published last
-- week", and it is the one a compliance deadline depends on.
--
-- Partial, because effective_date is NULL whenever the AI could not establish
-- one — and it is instructed never to guess, so nulls are common and are never
-- what a range query is looking for.
-- --------------------------------------------------------------------------
create index if not exists legal_updates_effective_date_idx
  on public.legal_updates (effective_date desc)
  where effective_date is not null;

-- --------------------------------------------------------------------------
-- confidence: deliberately NOT indexed
--
-- The admin confidence filter is always applied alongside a date ordering, and
-- published rows cluster tightly just above the 0.90 gate threshold, so a
-- confidence index would be low-selectivity and rarely chosen by the planner.
-- Recorded here so the omission reads as a decision rather than an oversight.
-- Revisit if the dashboard ever needs confidence-ordered reporting.
-- --------------------------------------------------------------------------
