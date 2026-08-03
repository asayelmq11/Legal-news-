# n8n — workflows and setup

n8n is the only orchestrator. It schedules, crawls, parses, classifies, decides
what publishes, retries, and notifies. The database stores state; the web app
reads it.

```
workflows/
  01-source-scheduler.json      hourly dispatcher — picks due sources     (M8)
  02-source-ingestion.json      four parser lanes → normalised RawItem    (M8)
  03-publishing-gate.json       the five publish rules + archive insert    (M9)
  04-retry-health-manual        backoff, health snapshot, "Run now"       (M10)
  06-discovery-ingestion.json   Google News → resolve → same pipeline     (M13)
  05-weekly-newsletter          digest + newsletter_history — not built    (M11)
```

**M13 — hybrid discovery.** The 52-source registry proved that a dedicated
parser per authority does not scale (see
`docs/source-provisioning-2026-08-02.md`): most GCC portals sit behind a WAF,
run a legacy stack with no feed, or are unreachable from n8n's egress. `06 —
Discovery Ingestion` adds a second way to find a legal update — a discovery
engine (Google News today) that is explicitly NOT a publishing source —
without adding a second pipeline. It resolves each candidate against the
official-source registry where possible, then dispatches into the SAME
`02 — Source Ingestion` → `03 — Publishing Gate` chain every other source
uses. Full design and live verification:
[`docs/hybrid-discovery-architecture-2026-08-03.md`](../docs/hybrid-discovery-architecture-2026-08-03.md).

---

## 1. Prerequisites

**Egress verification (M7.5) must be done first.** No source can be activated
until a real fetch has succeeded from the production n8n address — GCC
government portals return `403` to datacentre IPs, so a workflow that works on a
laptop can fail entirely in service.

```bash
node scripts/verify-egress.mjs "postgresql://…"  > /tmp/egress.md
```

Run it **from the production n8n host**, paste the output into
`docs/EGRESS_VERIFICATION.md`, then set each source's `config_status` in the
admin panel. Sources that cannot be reached lawfully stay inactive — that is a
valid outcome and must not be worked around.

## 2. Credentials

One credential, created in n8n → Credentials:

| Type | Name | Value |
|---|---|---|
| Supabase API | `Supabase (service_role)` | Host = your project URL, Service Role Secret = the `service_role` key |
| Header Auth | `Anthropic API` | Name = `x-api-key`, Value = your Anthropic API key |

The `service_role` key bypasses RLS and is the **only** write path into the
archive. It belongs here and nowhere else — never in `.env.local`, never in
`app_settings`, never in this repository.

The workflow exports reference the credential by name; a test asserts no key is
ever inlined into the JSON.

## 3. Import

n8n → Workflows → Import from File, one file at a time, in order. Then open
`01 — Source Scheduler` and re-point the **Run ingestion** node at the imported
`02 — Source Ingestion` (n8n stores workflow references by internal id, which
differs per instance).

Activate `01 — Source Scheduler` only. `02` is a sub-workflow and is invoked by
the scheduler, not by a trigger of its own.

## 4. How ingestion works

**Scheduler (hourly).** Reads `app_settings` and all active sources, then
decides in a Code node which are due — the polling policy lives in n8n, not in
the database. A source is skipped unless it is `active`, `config_status =
'verified'`, has a real parser type, and its `next_run_at` has passed.

**Ingestion (per source).** A Switch on `parser_type` routes to one of four
lanes:

| Lane | Fetches | Uses from `parser_config` |
|---|---|---|
| `rss` | `feed_url` → XML | `date_field`, `content_field` |
| `api` | `feed_url` → JSON | `items_path`, `title`, `url`, `date`, `body`, `headers` |
| `html` | `base_url` → HTML extract | `list`, `title`, `link`, `date`, `body` |
| `pdf` | `base_url` → PDF link index | `list`, `max_pages` |

Every lane also reads `allow_insecure_tls` (boolean, default false) — an opt-in
per source, not a default. Some legitimate government certificates fail
n8n's own CA bundle (stale/incomplete) even though they are valid, unexpired
and correctly chained when checked against a real trusted store (confirmed
independently for several sources during the 2026-08-03 provisioning pass —
see `docs/source-provisioning-2026-08-02.md`). Set this only after
independently verifying the certificate, never to silence an unverified
warning.

All four converge on one normaliser producing the shared `RawItem`:

```jsonc
{
  "source_id": "uuid",
  "source_url": "https://…",
  "title_raw": "…",        // untouched
  "content_raw": "…",      // untouched
  "publication_date": "2026-07-30",   // or null — never guessed
  "attachments": ["https://….pdf"],
  "fetched_at": "…"
}
```

Because everything downstream consumes `RawItem`, adding a fifth parser later
means adding one lane and nothing else.

**Two things the normaliser enforces:** an item with no URL or no title is
dropped, and an item whose hostname is not in the source's `allowed_domains` is
rejected before any AI call. The Publishing Gate checks the domain again in M9 —
this is the cheap check that avoids paying for an item that could never publish.

**Failure isolation.** Every HTTP node retries three times (2s → 4s → 8s) and
routes its error to a separate branch, so one unreachable source cannot stop the
others in the same tick.

## 5. Classification and publishing (M9)

After normalisation each `RawItem` goes to the Messages API with the system
prompt in [`../prompts/classify-legal-update.md`](../prompts/classify-legal-update.md)
(`claude-sonnet-5`, temperature 0). The response is parsed and **validated field
by field**: every constrained value must be in its enum, dates must be real ISO
dates, confidence must be a number in 0..1. Anything malformed or incomplete is
rejected as `ai_parse_failure` or `ai_invalid_output` — never coerced. A coerced
category would put a confident wrong classification in a legal archive.

`content_hash` is then computed as SHA256 of
`source_id | source_url | title | publication_date` (Crypto node, hex — matching
the `^[a-f0-9]{64}$` CHECK).

**`03 — Publishing Gate`** is the only code that decides what enters the archive.
Scheduled ingestion calls it, and so will manual runs (M10), so the rules cannot
drift between callers. It applies, in order:

| # | Rule | Rejection reason |
|---|---|---|
| 0 | the confidence threshold itself is present and sane | `missing_confidence_threshold` |
| 1 | source exists, is `active` and `verified` — **re-read at publish time** | `inactive_source` · `unverified_source` |
| 2 | item hostname is in the source's `allowed_domains` — **skipped for a discovery-mode source** (§6) | `domain_mismatch` |
| 3 | `content_hash` not already present | `duplicate` |
| 4 | `confidence >= ai.confidence_threshold` | `low_confidence` |
| 5 | `is_legal_update === true` | `not_legal_update` |

Rule 0 exists because `ai.confidence_threshold` is a **fail-closed** setting: if
it is missing or malformed the gate rejects *everything* rather than assuming a
value, since assuming one could quietly widen what publishes.

Rule 1 re-reads the source rather than trusting the crawl payload — an admin may
have deactivated or un-verified it while the item was in flight.

A unique-violation on insert is classified as `duplicate`, not a failure: that is
the concurrent-execution race the constraint exists for, and counting it as an
error would make a healthy source look broken.

**Logging.** One `workflow_logs` row per source per run, with counts and a
`rejection_reasons` tally. Rejections are counted, not logged individually — a
rejection is a normal decision, not an incident.

## 6. Hybrid discovery (M13)

`sources.ingestion_mode` is `official` (default, unchanged for all 52
registry sources), `discovery`, or `hybrid`. It is a different axis from
`source_type` (which classifies the AUTHORITY — gazette/government/regulator/
gcc/approved_news) — a discovery pseudo-source's `source_type` is the new
`discovery_engine` value, orthogonal to how it is reached.

**`06 — Discovery Ingestion`** runs every 2 hours:

1. Fetches each active `ingestion_mode = 'discovery'` source's `feed_url` —
   today, one Google News RSS query per GCC country (see
   `lib/discovery/discovery.ts` for the exact phrases and the tested spec
   this node mirrors).
2. Parses each `<item>`, keying off the `<source url="…">` attribute — NOT
   `<link>`, which is a client-side JS redirect shell with no server-side
   resolution target (confirmed empirically; see
   `docs/hybrid-discovery-architecture-2026-08-03.md`).
3. Deduplicates within the run by normalised title, then resolves each
   candidate against every active + verified **non-discovery** source:
   a `domain_match` (the resolved domain is a real official's own
   `allowed_domains`) or a strong `authority_name_match` (confidence ≥ 60 —
   see `resolveDiscoveredItem`) promotes the item to `origin_type = official`
   with that source's own id; anything weaker keeps `origin_type =
   'discovery'` and is attributed to the discovery pseudo-source itself.
4. Groups resolved candidates by target source and dispatches each group into
   `02 — Source Ingestion` exactly like the scheduler does — via a new
   `prefetched_items` bypass (`Has prefetched items?` → `Unwrap prefetched
   items` → `Normalise RawItem`) that skips the four fetch lanes entirely,
   since Workflow 05 already fetched and resolved the items.

**The domain allow-list is bypassed only for `ingestion_mode = 'discovery'`**
— in `Normalise RawItem` AND independently re-checked in the Publishing
Gate's `Apply the five rules` (both re-derive `isDiscoverySource` from the
re-read source row, never trust a flag carried on the item). Every other
rule — confidence threshold, duplicate hash, `is_legal_update`, publication
date — applies identically. A discovery-origin item that is not legally
relevant is rejected exactly like an official one; the discovery layer only
ever widens WHERE something is looked for, never what gets published.

`legal_updates.origin_type` (`official`/`discovery`), `canonical_url`, and
`discovery_engine` record, per item, how it was actually found — a `hybrid`
source can have some items officially crawled and others discovered in the
same run.

**Known limitation, not silently worked around:** Bing News requires a paid
Azure Cognitive Services subscription key not available in this environment.
Documented, not faked — see the architecture doc for what a real
implementation would need.

## 7. What is not here yet

M11 adds the newsletter. The scheduler already respects `next_retry_at`, so
M10 slots in without changing it.
