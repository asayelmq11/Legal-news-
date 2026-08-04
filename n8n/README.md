# n8n — workflows and setup

n8n is the only orchestrator. It schedules, crawls, parses, classifies, decides
what publishes, and handles manual runs. The database stores state; the web
app reads it.

```
workflows/
  01-source-scheduler.json      hourly dispatcher — picks due sources
  02-source-ingestion.json      four parser lanes → normalise → Azure AI classify
  03-publishing-gate.json       the publishing rules + archive insert
  04-manual-run.json            webhook → run 02 for the requested scope
  05-discovery-ingestion.json   Google News → resolve → same pipeline
```

Architecturally this is three workflows:

- **Workflow 1 — ingestion.** `01` (scheduler) and `05` (discovery) both
  dispatch into `02` (fetch → normalise → classify) which calls `03`
  (publish). Four files because n8n sub-workflows are how retries, discovery,
  and the manual trigger all reuse the same pipeline without a second copy of
  its rules — not four independent pipelines.
- **Workflow 2 — manual run.** `04`: a webhook that resolves a scope (one
  source / a country / everything) to a source set and runs Workflow 1 for
  them. Nothing else — no idempotency ledger, no lock, no dead-letter queue.
- **Workflow 3 — retry.** Not a separate file. Every HTTP node that calls an
  external service (the four fetch lanes, the AI classification call) has
  n8n's native `retryOnFail` set directly on the node — 3 attempts with a wait
  between them, isolated per node so one dead source or a transient AI 5xx
  doesn't fail the whole run. See §4 for the exact settings. A standalone
  scheduled retry-sweep workflow would have nothing to read from: the
  dead-letter table and the source-level retry columns it used to sweep were
  both removed as part of the simplification.

---

## 1. Prerequisites

**Egress verification must be done first.** No source can be activated until
a real fetch has succeeded from the production n8n address — GCC government
portals return `403` to datacentre IPs, so a workflow that works on a laptop
can fail entirely in service.

```bash
node scripts/verify-egress.mjs "postgresql://…"  > /tmp/egress.md
```

Run it **from the production n8n host**, paste the output into
`docs/EGRESS_VERIFICATION.md`, then set each source's `config_status` in the
admin panel. Sources that cannot be reached lawfully stay inactive — that is a
valid outcome and must not be worked around.

## 2. Credentials

Two credentials, created in n8n → Credentials. Never in this repository,
never in `.env.local`, never in `app_settings`.

| Type | Name | Value |
|---|---|---|
| Supabase API | `Supabase (service_role)` | Host = your project URL, Service Role Secret = the `service_role` key |
| Header Auth | `Azure OpenAI account` | Name = `api-key`, Value = your Azure OpenAI resource key |

The `service_role` key bypasses RLS and is the **only** write path into the
archive.

The `Azure OpenAI account` credential's key is sent as the `api-key` header on
every call to `Classify with AI` in `02 — Source Ingestion`. The node's URL
already carries the endpoint, deployment name, and API version — only the key
itself lives in the credential.

The workflow exports reference credentials by name; a test asserts no key is
ever inlined into the JSON.

## 3. Import

n8n → Workflows → Import from File, one file at a time, in order (01 → 02 →
03 → 04 → 05). Then open `01 — Source Scheduler`, `04 — Manual Run`, and
`05 — Discovery Ingestion` and re-point their **Execute Workflow** nodes at
the imported `02 — Source Ingestion` and `03 — Publishing Gate` (n8n stores
workflow references by internal id, which differs per instance).

Activate `01 — Source Scheduler`, `04 — Manual Run`, and
`05 — Discovery Ingestion`. `02` and `03` are sub-workflows, invoked by the
others — never triggered directly.

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
n8n's own CA bundle even though they are valid, unexpired and correctly
chained when checked against a real trusted store. Set this only after
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

**Failure isolation and retry (Workflow 3, in practice).** Every fetch lane
HTTP node has `retryOnFail: true, maxTries: 3, waitBetweenTries: 2000` and
`onError: continueErrorOutput` — one unreachable source retries three times
then fails in isolation, never stopping the others in the same tick. The
`Classify with AI` node carries the same pattern (`maxTries: 3,
waitBetweenTries: 5000`).

## 5. Classification and publishing

After normalisation each `RawItem` goes to Azure OpenAI's Chat Completions API
with the system prompt in
[`../prompts/classify-legal-update.md`](../prompts/classify-legal-update.md)
(temperature 0, `response_format: json_object`). The response is
**validated field by field**: `is_legal_update` must be boolean, `title` and
`summary` non-empty, `country`/`category` in their enums. Anything malformed
or incomplete is rejected as `ai_parse_failure` or `ai_invalid_output` — never
coerced.

There is **no confidence threshold**. The classifier does not return a
confidence score at all; the only classification-time rejection is
`is_legal_update === false` — "only reject obvious non-legal news."

`content_hash` is then computed as SHA256 of
`source_id | source_url | title | publication_date` (Crypto node, hex —
matching the `^[a-f0-9]{64}$` CHECK).

**`03 — Publishing Gate`** is the only code that decides what enters the
archive. Scheduled ingestion, discovery, and manual runs all call it, so the
rules cannot drift between callers. What's left, now that the AI decision and
the confidence gate are both upstream, is structural:

| Rule | Rejection reason |
|---|---|
| source exists, is `active` and `verified` — **re-read at publish time** | `inactive_source` · `unverified_source` |
| item hostname is in the source's `allowed_domains` — **skipped for a discovery-mode source** (§6) | `domain_mismatch` |
| `content_hash` not already present | `duplicate` |
| a publication date exists (crawler-supplied — never fabricated from fetch time) | `no_publication_date` |

Rule 1 re-reads the source rather than trusting the crawl payload — an admin
may have deactivated or un-verified it while the item was in flight.

A unique-violation on insert is classified as `duplicate`, not a failure: that
is the concurrent-execution race the constraint exists for.

## 6. Hybrid discovery

`sources.ingestion_mode` is `official` (default, unchanged for all 52
registry sources), `discovery`, or `hybrid`. It is a different axis from
`source_type` (which classifies the AUTHORITY — gazette/government/regulator/
gcc/approved_news) — a discovery pseudo-source's `source_type` is the
`discovery_engine` value, orthogonal to how it is reached.

**`05 — Discovery Ingestion`** runs every 2 hours:

1. Fetches each active `ingestion_mode = 'discovery'` source's `feed_url` —
   one Google News RSS query per GCC country.
2. Parses each `<item>`, keying off the `<source url="…">` attribute — NOT
   `<link>`, which is a client-side JS redirect shell with no server-side
   resolution target.
3. Deduplicates within the run by normalised title, then resolves each
   candidate against every active + verified **non-discovery** source: a
   `domain_match` or a strong `authority_name_match` (confidence ≥ 60)
   promotes the item to `origin_type = official` with that source's own id;
   anything weaker keeps `origin_type = 'discovery'`.
4. Groups resolved candidates by target source and dispatches each group into
   `02 — Source Ingestion` exactly like the scheduler does — via a
   `prefetched_items` bypass (`Has prefetched items?` → `Unwrap prefetched
   items` → `Normalise RawItem`) that skips the four fetch lanes entirely.

**The domain allow-list is bypassed only for `ingestion_mode = 'discovery'`**
— in `Normalise RawItem` AND independently re-checked in the Publishing
Gate (both re-derive `isDiscoverySource` from the re-read source row, never
trust a flag carried on the item). Every other rule — duplicate hash,
`is_legal_update`, publication date — applies identically.

`legal_updates.origin_type` (`official`/`discovery`), `canonical_url`, and
`discovery_engine` record, per item, how it was actually found.

## 7. Manual run

**`04 — Manual Run`** is a webhook (`POST /webhook/legal-ingestion-run`,
header-auth protected by `N8N_TRIGGER_SECRET`) that:

1. Validates the request body — `scope` is one of `source` / `country` /
   `all` / `url`, with the scope-specific field required.
2. Resolves the scope to a source set, filtered to what the scheduler would
   run anyway (`active`, `config_status = 'verified'`, a real parser type).
3. Dispatches Workflow 1 (`02 — Source Ingestion`) once per resolved source,
   without waiting for it to finish (`waitForSubWorkflow: false`), and
   answers immediately.
4. Responds with `202 accepted` / `404 rejected` (unknown source) /
   `200 skipped` (nothing matched) / `500 failed` (dispatch itself couldn't
   start).

There is no idempotency ledger for a retried request and no source lock —
both existed only to support the operational admin UI this platform no longer
has. A manual run is a plain, stateless dispatch.
