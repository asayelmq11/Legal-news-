# n8n — workflows and setup

n8n is the only orchestrator. It schedules, crawls, parses, classifies, decides
what publishes, retries, and notifies. The database stores state; the web app
reads it.

```
workflows/
  01-source-scheduler.json   hourly dispatcher — picks due sources    (M8)
  02-source-ingestion.json   four parser lanes → normalised RawItem   (M8)
  03-publishing-gate.json    the five publish rules + archive insert   (M9)
  04-retry-health-manual     backoff, health snapshot, "Run now"      (M10)
  05-weekly-newsletter       digest + newsletter_history              (M11)
```

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
| 2 | item hostname is in the source's `allowed_domains` | `domain_mismatch` |
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

## 6. What is not here yet

M10 adds persistent retry state, the health snapshot and the manual "Run now"
webhook; M11 adds the newsletter. The scheduler already respects `next_retry_at`,
so M10 slots in without changing it.
