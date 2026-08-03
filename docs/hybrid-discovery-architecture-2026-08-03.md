# Hybrid discovery architecture — 2026-08-03

Architectural evolution of the ingestion pipeline, built on top of commit
`bbd9a66` (async manual-run dispatch + the full 52-source connectivity audit).
Nothing from that work was reverted; this is additive.

## 1. Why

The 52-source registry proved a real, structural limit: requiring a
dedicated, hand-derived parser for every authority does not scale. Of 52
registered official sources, connectivity testing from production n8n egress
found 33 reachable and only 2 with a genuinely verified, tested parser
(`docs/source-provisioning-2026-08-02.md`). Most GCC government portals sit
behind a WAF, run a legacy stack with no feed, or are simply unreachable from
this specific egress. The goal stopped being "52 websites" and became
"maximum verified coverage of GCC legal updates" — which means finding a
second way in when the first one is blocked.

## 2. Architecture

```
Layer 1 — Official           Layer 2 — Discovery          Layer 3 — Resolution
──────────────────           ──────────────────           ────────────────────
RSS / API / HTML / PDF  ←──  Google News (per country)  ──→  domain match /
lanes (unchanged, M8)         [Bing News: NOT built —          authority-name
                               see §6]                         match / none
        │                            │                            │
        └──────────────┬─────────────┴────────────────────────────┘
                        ▼
              Normalise RawItem (M8, unchanged for official items;
              domain allow-list bypassed ONLY for unresolved discovery items)
                        │
                        ▼
              AI legal classification (M9, unchanged — the only thing
              deciding what counts as a legal update, for either origin)
                        │
                        ▼
              Publishing Gate (M9, unchanged rules 0/1/3/4/5; rule 2
              — domain allow-list — bypassed only for discovery-mode sources)
                        │
                        ▼
              workflow_logs + legal_updates
              (origin_type, canonical_url, discovery_engine recorded per item)
```

**No second pipeline was built.** Workflow 06 (Discovery Ingestion) does
discovery, deduplication, and resolution, then dispatches into the SAME
Workflow 02 → Workflow 03 chain every official source already uses — the
same principle the manual-run and retry paths already followed ("There is no
simplified manual path... the one used in an emergency is the one least
likely to be right" — `lib/ops/actions.ts`).

## 3. What was built

| Component | What it does |
|---|---|
| `supabase/migrations/0020_hybrid_discovery.sql` | `ingestion_mode` enum (official/discovery/hybrid), `origin_type` enum, `discovery_engine` added to `source_type` |
| `supabase/migrations/0021_discovery_columns.sql` | `sources.{ingestion_mode, confidence, verification_method, last_discovery_success, last_official_success, last_parser_success}`; `legal_updates.{origin_type, canonical_url, discovery_engine}` |
| `supabase/migrations/0022_discovery_seed.sql` | 6 discovery pseudo-source rows, one per GCC country, pre-verified (see §4 for why that is safe) |
| `lib/discovery/discovery.ts` | Tested TS specification: canonical URL extraction (`<link rel=canonical>`, `og:url`, JSON-LD), official-domain matching, authority-name matching, Google News feed URL builder, the full per-item resolution decision. 24 unit tests, `tests/discovery.test.ts`. |
| `n8n/workflows/06-discovery-ingestion.json` | New workflow: every 2 hours, fetches 6 Google News feeds, resolves each candidate, dispatches into Workflow 02 |
| `n8n/workflows/02-source-ingestion.json` | Added a `prefetched_items` bypass (`Has prefetched items?` → `Unwrap prefetched items`) so a discovery dispatch skips the fetch lanes entirely; `Normalise RawItem` carries `origin_type`/`canonical_url`/`discovery_engine` through and bypasses the domain check only for `ingestion_mode = 'discovery'` |
| `n8n/workflows/03-publishing-gate.json` | Same domain-check bypass, re-derived independently at publish time (never trusts a flag carried on the item); records the three new fields on the archived row |
| Sources admin UI | List and detail pages now show `ingestion_mode`, `confidence`, `verification_method`, and the three `last_*_success` timestamps; the archive detail page shows `origin_type`/`canonical_url`/`discovery_engine` per item |

## 4. Why the discovery sources are seeded pre-verified

`config_status = 'verified'` normally means a human proved a specific
website's markup is safely parseable — the rule this whole registry exists
to enforce (`supabase/SOURCE_REGISTRY.md`: *"Do not guess selectors or parser
configuration"*). The 6 discovery rows are verified for a different reason:
what was actually tested and proven live in this session is the **discovery
mechanism itself** — that Google News RSS returns real, parseable results
with a usable `<source url>` attribute (§5) — not any individual
government site's HTML. `ingestion_mode = 'discovery'` is the marker that
distinguishes this from an official source's verification, and
`supabase/tests/03_source_registry_checks.sql` (S21) now asserts this
explicitly: zero OFFICIAL sources may be active/verified without a real
egress test, exactly as before; the 6 discovery sources are a separate,
declared exception.

## 5. What was verified live, and what was found along the way

All against production n8n/Supabase — no local simulation.

- **Google News RSS works from a plain HTTP fetch, no API key needed.**
  Confirmed real, relevant results for GCC legal-keyword queries (e.g. a
  genuine Saudi cabinet decision on real-estate documentation services
  surfaced in the very first test batch).
- **Google News `<link>` cannot be resolved server-side.** It is a
  client-side JS redirect shell (`DotsSplashUi`), confirmed by fetching the
  raw response body — no meta-refresh, no server 3xx to the real article.
  This is why resolution keys off the RSS `<source url>` attribute instead
  (the publisher's homepage domain) — a real, structural difference from a
  typical RSS aggregator, documented rather than worked around with an
  undocumented decode of Google's proprietary URL encoding.
- **A systemic TLS finding, carried over from the source-provisioning pass:**
  9 official sources fail n8n's own CA bundle despite valid, independently
  verified certificates. Unrelated to discovery directly, but relevant
  context for why official-source coverage is currently thin.
- **Two real defects found by dry-running this exact pipeline, not by
  reading the code:**
  1. **A dead-end node the execution planner silently skipped.**
     `Get official sources` had no outgoing graph edge — only an indirect
     `$('Get official sources')` reference from `Resolve and group items`.
     n8n's planner does not guarantee such a node runs (the IDENTICAL
     failure mode already hit and fixed once in this project — see
     `docs/n8n-fixes-2026-08-02.md`, incident #5, "Get threshold"). Fixed by
     giving it a real edge via a `Merge` node, splitting the two input
     streams by shape (`allowed_domains` present vs. `title` + originating
     discovery source present) — the same technique `Merge state` in
     Workflows 01/04 already uses to separate settings rows from source
     rows.
  2. **A Supabase node multi-condition filter that silently behaved as a
     single condition.** `Get discovery sources` was built with
     `ingestion_mode = eq.discovery AND active = eq.true`; live testing
     showed it returning ALL active sources regardless of `ingestion_mode`
     — caught because Umm Al-Qura's and GSO's own RSS items ("العدد 5175",
     etc.) showed up mislabelled as discovery candidates. Fixed by fetching
     `sources` unfiltered and filtering in a Code node instead — the same
     "small table, fetch whole, filter in memory" pattern the scheduler and
     retry sweep already use, and documented in code and tests as the
     reason no Supabase multi-condition filter is used anywhere in Workflow
     06.
- **Full pipeline, confirmed end to end** (execution IDs from this session,
  reproducible by re-running Workflow 06): 6 Google News feeds fetched
  (46/38/36/16/32/39 raw candidates for SA/AE/KW/QA/BH/OM), deduplicated
  within the run, dispatched into Workflow 02 with `trigger_type: 'manual'`
  and a `discovery-<timestamp>-<n>` correlation id, normalised (bypassing the
  domain check correctly, confirmed by items reaching AI classification
  rather than being rejected `domain_mismatch`), and logged to
  `workflow_logs` with the matching `correlation_id`. Every item was rejected
  `ai_empty_response` — the same **pre-existing, already-documented** Claude
  API credential defect noted in `docs/n8n-fixes-2026-08-02.md` ("Known
  limitation — not fixed in this session"), off-limits to this session
  because fixing it requires editing a credential in the n8n UI. This is a
  safe outcome: nothing was incorrectly published, and it is not a defect in
  the discovery layer — the identical rejection was observed for the
  official Umm Al-Qura and GSO sources throughout this session too.

Because that credential defect blocks classification for every source, this
session cannot demonstrate an actual `legal_updates` insert with
`origin_type = 'discovery'`. What is demonstrated, with real execution
evidence, is every step up to and including the point that defect blocks —
fetch, dedupe, resolve, dispatch, normalise, reach the classifier — and the
Publishing Gate logic that would apply once classification returns a real
answer (verified by direct code inspection and the existing Gate test
suite, since it could not be exercised past the classifier live).

## 6. Known limitations — documented, not worked around

- **Bing News is not implemented.** It requires a paid Azure Cognitive
  Services subscription key, not available in this environment. A real
  implementation would add it as a second discovery source per country with
  its own feed-fetch node, feeding the same `Resolve and group items` logic
  — no architectural change needed, just a second adapter and a credential
  this session cannot obtain.
- **Canonical URL resolution is domain/name matching, not universal.**
  `extractCanonicalUrl` (canonical tag / `og:url` / JSON-LD) is general and
  reusable, but it needs a fetchable page — it is not applied to Google
  News's own `<link>` for the reason in §5. For a discovered item whose
  publisher is a private news outlet (the common case), no official URL is
  claimed; the item stays `origin_type = 'discovery'` with the discovery
  source's own link, exactly per spec ("If not: keep the discovery URL but
  clearly mark: source_type = discovery").
- **`last_official_success` / `last_parser_success` bookkeeping is wired but
  shallow.** `Build health update` stamps `last_discovery_success` on every
  successful feed fetch and `last_official_success` when a group resolved to
  a real official source, but does not yet track `last_parser_success`
  distinctly for a `hybrid` source running both an official lane and a
  scoped discovery feed — there are no `hybrid`-mode sources seeded yet to
  exercise this against.
- **The pre-existing Claude API credential defect** (see §5) blocks
  confirming actual publication end to end for discovery-origin content, the
  same as it already blocked it for official sources this entire session.

## 7. Coverage measurement (this session)

| Metric | Value | Note |
|---|---|---|
| Official sources, connectivity confirmed | 33 / 52 | unchanged from the provisioning pass |
| Official sources, verified + active | 2 / 52 | Umm Al-Qura (prior session), GSO (this branch, provisioning pass) |
| Discovery sources, verified + active | 6 / 6 | one per GCC country, this session |
| Discovery candidates per run (SA/AE/KW/QA/BH/OM) | 46/38/36/16/32/39 | one live test run, `when:2d` window |
| Duplicates removed within a run | tracked via `seenTitles`, not separately logged this session | see §6 for the cross-origin dedup gap |
| Official-source resolution rate this run | 0 / ~207 candidates | expected — see §5; matching against only 2 active+verified official sources |
| Discovery fetch failures | 0 / 6 (this run) | `Fetch discovery feed` uses `continueRegularOutput`, so a failure would be visible per-item, not silently dropped |
| False positives / false negatives | not measurable this session | blocked entirely by the pre-existing AI-classification credential defect (§5) — nothing reached a final classification to check against |

## 8. Recommended next steps

1. Fix the Claude API credential (n8n UI, off-limits to this session) —
   unblocks measuring real classification accuracy for both origins.
2. Continue the source-provisioning backlog (`docs/source-provisioning-
   2026-08-02.md` §9) — every NEW official source verified increases the
   discovery layer's resolution rate for free, since `Get official sources`
   is re-read every run.
3. Add Bing News as a second discovery adapter once a subscription key is
   available — same `Resolve and group items` logic, one new fetch node.
4. Consider a cross-origin fuzzy-duplicate check (title + country +
   publication_date similarity via the already-installed `pg_trgm`
   extension) for the case where a discovery-origin item and a
   later-verified official crawl of the same real document produce two
   different `content_hash` values (different `source_url`) — the exact
   `content_hash` uniqueness constraint only catches the SAME URL twice, not
   the same real-world document reached two different ways.
5. Consider tracking `last_parser_success` for a genuine `hybrid`-mode
   source once one exists.
