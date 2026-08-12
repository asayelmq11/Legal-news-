# n8n — workflows and setup

n8n crawls, parses, classifies and decides what publishes. The database
stores state; the web app reads it. There is **no scheduling** any more — see
"Why no schedulers" below.

```
workflows/
  01-source-scheduler.json      DEACTIVATED on the live instance — dead code kept
                                 for its due-source logic, not currently reachable
  02-source-ingestion.json      four parser lanes → normalise → Azure AI classify
  03-publishing-gate.json       the publishing rules + archive insert
  04-manual-run.json            the ONLY ingestion trigger — the catch-up refresh
  05-discovery-ingestion.json   Google News → resolve → same pipeline
                                 (callable-only — no schedule of its own either)
```

Architecturally this is three workflows:

- **Workflow 1 — ingestion.** `04` (the catch-up refresh) dispatches into `02`
  (fetch → normalise → classify) which calls `03` (publish), and separately
  into `05` (discovery), which dispatches its own resolved groups into `02`
  the same way. Sub-workflows are how the manual trigger and discovery reuse
  the same pipeline without a second copy of its rules — not independent
  pipelines.
- **Workflow 2 — manual run.** `04`: a webhook that computes a catch-up
  window from the last successful refresh, guards against a concurrent
  duplicate, and dispatches Workflow 1 for every currently eligible source —
  official and discovery alike. See §7.
- **Workflow 3 — retry.** Not a separate file. Every HTTP node that calls an
  external service (the four fetch lanes, the AI classification call) has
  n8n's native `retryOnFail` set directly on the node — 3 attempts with a wait
  between them, isolated per node so one dead source or a transient AI 5xx
  doesn't fail the whole run. See §4 for the exact settings.

---

## 0. Why no schedulers

The platform is an internal tool used by a handful of people, not a
continuously-monitored feed. It must sit **idle** — no Azure OpenAI spend, no
outbound crawl traffic — until someone actually opens the dashboard and clicks
**"تحديث المستجدات"**.

Both `01 — Source Scheduler` (previously hourly) and `05 — Discovery
Ingestion` (previously every 2 hours) ran on `n8n-nodes-base.scheduleTrigger`
nodes. That behaviour is gone:

- **`01`** is **deactivated** on the live instance. Its node graph — the
  due-source selection logic, `poll_interval_minutes`/`next_run_at` handling —
  is left in place and in this repo, unreachable, in case a future scheduled
  mode is ever reintroduced. It is not deleted, per the instruction that
  disabled it: disable the trigger, don't delete working logic.
- **`05`**'s Schedule Trigger node was **replaced**, not just deactivated,
  with an `executeWorkflowTrigger` — the same node type `02` and `03` use to
  be callable sub-workflows. `05` is now reachable ONLY when `04` calls it; it
  has no trigger of its own to disable. (A workflow can carry only one
  trigger-type node, which is what forced a replacement instead of leaving
  both side by side.)

The one thing that still calls Azure OpenAI or fetches a source is a human
clicking the button, or an authorized direct call to the same webhook. There
is nothing else pointed at either.

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
archive (and, since migration 0024, the only writer of `ingestion_runs`).

The `Azure OpenAI account` credential's key is sent as the `api-key` header on
every call to `Classify with AI` in `02 — Source Ingestion`. The node's URL
already carries the endpoint, deployment name, and API version — only the key
itself lives in the credential.

A **third** credential, Header Auth, protects the manual-run webhook itself
(`X-Trigger-Secret` header). Its value is the app's `N8N_TRIGGER_SECRET`
(`.env.local`, server-only — never sent to the browser). The Next.js Server
Action that calls the webhook is the only place this secret is used on the
app side.

The workflow exports reference credentials by name; a test asserts no key is
ever inlined into the JSON.

## 3. Import

n8n → Workflows → Import from File, one file at a time (order doesn't matter
functionally any more, since nothing auto-fires, but 02 → 03 → 04 → 05 → 01
is a reasonable order). Then open `04 — Manual Run` and `05 — Discovery
Ingestion` and re-point their **Execute Workflow** nodes at the imported
`02 — Source Ingestion` / `03 — Publishing Gate` / `05 — Discovery Ingestion`
(n8n stores workflow references by internal id, which differs per instance).

**Activate `02`, `03`, `04` and `05`.** All four are either the webhook
entry point (`04`) or callable-only sub-workflows (`02`, `03`, `05`) — in n8n,
"active" is what makes a sub-workflow reachable via Execute Workflow, not only
what makes a schedule fire. **Leave `01` deactivated** — see §0.

## 4. How ingestion works

**Per-source fetch.** A Switch on `parser_type` routes to one of four lanes:

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

**Catch-up windowing.** When the dispatching call (always `04` now) carries a
`window_from` on the trigger payload, `Normalise RawItem` drops any item whose
`publication_date` is older than it (`out_of_window`) — see §7. Absent
`window_from`, this is a no-op, so the same normaliser works unchanged for any
possible future caller that doesn't set one.

**Failure isolation and retry (Workflow 3, in practice).** Every fetch lane
HTTP node has `retryOnFail: true, maxTries: 3, waitBetweenTries: 2000` and
`onError: continueErrorOutput` — one unreachable source retries three times
then fails in isolation, never stopping the others in the same run. The
`Classify with AI` node carries the same pattern (`maxTries: 3,
waitBetweenTries: 5000`). A per-source failure like this does **not** fail
the whole catch-up run or block the checkpoint from advancing — see §7.

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
archive. Every caller of Workflow 1 goes through it, so the rules cannot
drift between callers. What's left, now that the AI decision and the window
filter are both upstream, is structural:

| Rule | Rejection reason |
|---|---|
| source exists, is `active` and `verified` — **re-read at publish time** | `inactive_source` · `unverified_source` |
| item hostname is in the source's `allowed_domains` — **skipped for a discovery-mode source** (§6) | `domain_mismatch` |
| `content_hash` not already present | `duplicate` |
| a publication date exists (crawler-supplied — never fabricated from fetch time) | `no_publication_date` |

Rule 1 re-reads the source rather than trusting the crawl payload — an admin
may have deactivated or un-verified it while the item was in flight.

A unique-violation on insert is classified as `duplicate`, not a failure: that
is the concurrent-execution race the constraint exists for. The same is true,
one level up, of a unique-violation on **inserting `ingestion_runs`** — see §7.

## 6. Hybrid discovery

`sources.ingestion_mode` is `official` (default, unchanged for all 52
registry sources), `discovery`, or `hybrid`. It is a different axis from
`source_type` (which classifies the AUTHORITY — gazette/government/regulator/
gcc/approved_news) — a discovery pseudo-source's `source_type` is the
`discovery_engine` value, orthogonal to how it is reached.

**`05 — Discovery Ingestion`** is now callable-only (§0) — it runs exactly
when `04` invokes it, once per catch-up refresh:

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
4. Groups resolved candidates by target source, stamps each group with the
   catch-up window `04` handed it, and dispatches each group into
   `02 — Source Ingestion` exactly like an official-source dispatch — via a
   `prefetched_items` bypass (`Has prefetched items?` → `Unwrap prefetched
   items` → `Normalise RawItem`) that skips the four fetch lanes entirely.

**The domain allow-list is bypassed only for `ingestion_mode = 'discovery'`**
— in `Normalise RawItem` AND independently re-checked in the Publishing
Gate (both re-derive `isDiscoverySource` from the re-read source row, never
trust a flag carried on the item). Every other rule — duplicate hash,
`is_legal_update`, publication date, the catch-up window — applies
identically to discovery and official items.

`legal_updates.origin_type` (`official`/`discovery`), `canonical_url`, and
`discovery_engine` record, per item, how it was actually found.

## 7. The manual catch-up refresh

**`04 — Manual Run`** is the platform's only ingestion trigger — a webhook
(`POST /webhook/legal-ingestion-run`, header-auth protected by the
`X-Trigger-Secret` credential, §2) that the dashboard's "تحديث المستجدات"
button calls through a Next.js Server Action.

It is a **catch-up** refresh, not a fixed "last N hours" poll: every run
covers everything published since the last successful refresh, however long
ago that was.

1. **`Parse request`** — reads the optional `requested_by` (a user id, for
   attribution). Nothing else to validate: there is no scope any more (the
   old source/country/url scopes were dead code — no UI ever called them).
   Every refresh covers every currently eligible source.
2. **`Get running run` / `Get last succeeded run`** query `ingestion_runs`
   (migration 0024) in parallel, then **`Compute window & guard`** decides:
   - If a row is `status = 'running'`, this request is rejected as
     `already_running` (§ single-flight, below) — no dispatch happens.
   - Otherwise, `window_from` is the latest **`succeeded`** row's `window_to`
     minus a 6-hour safety overlap, or — if there has never been a successful
     refresh — 7 days before now (a bounded initial lookback, never an
     unlimited historical backfill). `window_to` is always "now".
3. **`Insert running run`** writes the new `status = 'running'` row. A
   unique-violation here (two requests racing past step 2 at once) is treated
   exactly like the ordinary already-running case, not as an error.
4. The insert's success fans out into **three parallel branches**:
   - **`Respond: accepted`** answers the HTTP request immediately (`202`,
     with the run id and window) — the client is never blocked on what
     follows.
   - **`Prepare official dispatch` → `Dispatch official ingestion`** resolves
     every `active` + `verified` + non-`discovery` source (the same
     eligibility the old scheduler enforced) and dispatches into `02`, up to
     **4 sources concurrently** — safe now that the client already has its
     response on the branch above.
   - **`Prepare discovery dispatch` → `Dispatch discovery catch-up`** calls
     `05` once (it fans out to every discovery source and resolved group
     internally, also dispatching into `02` up to 4 at a time).

   Both dispatch nodes call `02`'s webhook (`POST
   /webhook/source-ingestion-dispatch`, same `X-Trigger-Secret` credential as
   `04`'s own webhook) via an `httpRequest` node with n8n's native
   `options.batching.batch.batchSize: 4` — the same controlled-concurrency
   mechanism already used by `Classify with AI` (§4). n8n's execution engine
   processes even independent graph branches strictly sequentially within one
   execution (confirmed empirically — `Execute Workflow` in `each` mode never
   overlaps calls), so this batched-HTTP-webhook pattern is the only way to
   get real concurrency for source dispatch; a same-graph parallel branch fan
   out would not have reduced runtime. `02`'s trigger is this webhook (a Code
   node named `Called by scheduler` reshapes `$json.body` back into the same
   payload shape the old `executeWorkflowTrigger` produced, so every
   downstream node in `02` that reads `$('Called by scheduler')` is
   unchanged) plus a `Respond to dispatch webhook` node returning the same
   per-source summary shape `Finalize run` and `Build health update` already
   expected.
5. **`Finalize run`** aggregates `items_published` across every result from
   both dispatch branches and writes `status = 'succeeded'` (or `'failed'`,
   only if every single dispatch failed to even start — an isolated
   per-source fetch failure inside `02`/`03` does **not** fail the whole run,
   consistent with §4's per-node retry isolation) plus `items_inserted` and
   `completed_at` back onto the `ingestion_runs` row via **`Update run row`**.
   The dashboard polls this row (via a Server Action, not directly) to know
   when to show a result and revalidate.

**Single-flight lock.** Two layers: the pre-check read in step 2, and — for
the race it cannot catch — a Postgres partial unique index,
`ingestion_runs_one_active`, that permits at most one `status = 'running'`
row to exist at all (migration 0024). The insert in step 3 simply cannot
succeed a second time while one is in flight; there is no source-level lock
column any more (`sources.lock_expires_at` and the rest of that machinery
were dropped along with the other ops columns).

**The checkpoint only ever advances on success.** `Compute window & guard`
only ever reads `status = 'succeeded'` rows when picking `window_from` — a
`'failed'` or still-`'running'` row is invisible to it. A refresh that dies
partway through cannot shrink the next run's coverage or create a silent
gap; at worst the next refresh's window is wider than strictly necessary,
which deduplication (content_hash) absorbs for free.

There is no idempotency ledger keyed by client-retried correlation id — the
single-flight lock above already makes a retried "click refresh again" safe
without one.
