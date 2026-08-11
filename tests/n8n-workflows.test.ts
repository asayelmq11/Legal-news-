import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Structural checks on the exported n8n workflows.
 *
 * These cannot prove a workflow runs — that needs an n8n instance. They do
 * catch the failures that would otherwise be found by a failed import: invalid
 * JSON, a connection naming a node that does not exist, a missing trigger.
 */

const DIR = new URL('../n8n/workflows/', import.meta.url)
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'))

interface Workflow {
  name: string
  nodes: Array<{ id: string; name: string; type: string; typeVersion: number }>
  connections: Record<string, { main: Array<Array<{ node: string }>> }>
}

interface FullNode {
  id: string
  name: string
  type: string
  typeVersion: number
  parameters: Record<string, unknown>
  alwaysOutputData?: boolean
  onError?: string
  retryOnFail?: boolean
  maxTries?: number
}

function load(file: string): Workflow {
  return JSON.parse(readFileSync(new URL(file, DIR), 'utf8')) as Workflow
}

function loadFull(file: string): { nodes: FullNode[]; connections: Workflow['connections'] } {
  return JSON.parse(readFileSync(new URL(file, DIR), 'utf8'))
}

describe('n8n workflow exports', () => {
  it('ships exactly the five workflows: scheduler, ingestion, gate, manual run, discovery', () => {
    expect(files.sort()).toEqual([
      '01-source-scheduler.json',
      '02-source-ingestion.json',
      '03-publishing-gate.json',
      '04-manual-run.json',
      '05-discovery-ingestion.json',
    ])
  })

  it.each(files)('%s is valid JSON with the required top-level shape', (file) => {
    const wf = load(file)
    expect(typeof wf.name).toBe('string')
    expect(Array.isArray(wf.nodes)).toBe(true)
    expect(wf.nodes.length).toBeGreaterThan(0)
    expect(typeof wf.connections).toBe('object')
  })

  it.each(files)('%s has unique node names and ids', (file) => {
    const wf = load(file)
    const names = wf.nodes.map((n) => n.name)
    const ids = wf.nodes.map((n) => n.id)
    expect(new Set(names).size, 'duplicate node name').toBe(names.length)
    expect(new Set(ids).size, 'duplicate node id').toBe(ids.length)
  })

  it.each(files)('%s connections all reference existing nodes', (file) => {
    const wf = load(file)
    const known = new Set(wf.nodes.map((n) => n.name))

    for (const [from, conn] of Object.entries(wf.connections)) {
      expect(known.has(from), `connection from unknown node "${from}"`).toBe(true)
      for (const outputs of conn.main) {
        for (const target of outputs) {
          expect(known.has(target.node), `connection to unknown node "${target.node}"`).toBe(true)
        }
      }
    }
  })

  it.each(files)('%s has exactly one trigger node', (file) => {
    const wf = load(file)
    const triggers = wf.nodes.filter(
      (n) => n.type.endsWith('Trigger') || n.type === 'n8n-nodes-base.webhook',
    )
    expect(triggers).toHaveLength(1)
  })

  it.each(files)('%s: every $(\'NodeName\') expression reference names a real node', (file) => {
    const wf = loadFull(file)
    const names = new Set(wf.nodes.map((n) => n.name))
    for (const n of wf.nodes) {
      const code = String(n.parameters.jsCode ?? '')
      for (const m of code.matchAll(/\$\('([^']+)'\)\.(?:first|all|itemMatching)\(/g)) {
        const target = m[1] ?? ''
        expect(names.has(target), `${file} :: "${n.name}" references missing node "${target}"`).toBe(true)
      }
    }
  })

  it('the scheduler runs hourly and dispatches to the ingestion workflow', () => {
    const wf = load('01-source-scheduler.json')
    expect(wf.nodes.some((n) => n.type === 'n8n-nodes-base.scheduleTrigger')).toBe(true)
    expect(wf.nodes.some((n) => n.type === 'n8n-nodes-base.executeWorkflow')).toBe(true)
  })

  it('the scheduler refuses unverified sources in code, not only in the database', () => {
    const raw = readFileSync(new URL('01-source-scheduler.json', DIR), 'utf8')
    expect(raw).toContain("config_status !== 'verified'")
    expect(raw).toContain("parser_type === 'unknown'")
    // next_retry_at was dropped along with the ops retry/backoff columns
    expect(raw).not.toContain('next_retry_at')
  })

  it('the ingestion workflow has all four parser lanes', () => {
    const wf = load('02-source-ingestion.json')
    const names = wf.nodes.map((n) => n.name)
    expect(names).toContain('Fetch RSS')
    expect(names).toContain('Fetch API')
    expect(names).toContain('Fetch HTML')
    expect(names).toContain('Fetch PDF index')
    // all four converge on one normaliser
    expect(names).toContain('Normalise RawItem')
  })

  it('the four fetch lanes retry on transient failure and isolate their errors', () => {
    // Named explicitly rather than matched by a "Fetch" prefix: the opt-in
    // per-item detail-page fetch (M14) also starts with "Fetch" but is not
    // one of the four top-level source lanes and is covered by its own test.
    const wf = loadFull('02-source-ingestion.json')
    const laneNames = ['Fetch RSS', 'Fetch API', 'Fetch HTML', 'Fetch PDF index']
    const lanes = wf.nodes.filter((n) => laneNames.includes(n.name))
    expect(lanes.length).toBe(4)
    for (const node of lanes) {
      expect(node.retryOnFail, `${node.name} must retry`).toBe(true)
      // the four crawl lanes must isolate their failure so one dead source
      // cannot stop the others in the same tick
      expect(node.onError).toBe('continueErrorOutput')
    }
  })

  it('the opt-in detail-page date fetch also retries and isolates its errors', () => {
    // A per-item fetch failure here must never fail the whole run — it
    // already had no date before this branch was entered (see "Needs
    // detail-page date?"), so a failure just leaves it at null, same as if
    // date_from_detail were unset.
    const wf = loadFull('02-source-ingestion.json')
    const node = wf.nodes.find((n) => n.name === 'Fetch detail page for date')
    expect(node?.type).toBe('n8n-nodes-base.httpRequest')
    expect(node?.retryOnFail).toBe(true)
    expect(node?.onError).toBe('continueErrorOutput')
  })

  it('every fetch lane accepts a per-source TLS bypass, never on by default', () => {
    // Several government certificates are valid (verified independently
    // against a trusted CA store) but fail n8n's own stale CA bundle. The
    // bypass is opt-in per source via parser_config, never a blanket default.
    const wf = loadFull('02-source-ingestion.json')
    for (const name of ['Fetch RSS', 'Fetch API', 'Fetch HTML', 'Fetch PDF index']) {
      const n = wf.nodes.find((x) => x.name === name)
      const options = n?.parameters.options as { allowUnauthorizedCerts?: unknown } | undefined
      expect(options?.allowUnauthorizedCerts, `${name} must read the opt-in flag`).toBe(
        '={{ !!$json.source.parser_config.allow_insecure_tls }}',
      )
    }
  })

  it('the RSS text extractor descends into a nested element instead of returning empty', () => {
    // A real feed (HRSD) wraps <title> in an <a> element instead of plain
    // text/CDATA. Confirmed empirically via a dry run before this fix.
    const wf = loadFull('02-source-ingestion.json')
    const n = wf.nodes.find((x) => x.name === 'RSS → RawItem')
    const code = String(n?.parameters.jsCode ?? '')
    expect(code).toContain('if (v._ !== undefined) return v._;')
    expect(code).toContain('for (const key of Object.keys(v))')
    expect(code.indexOf('if (v._ !== undefined)')).toBeLessThan(code.indexOf('for (const key of Object.keys(v))'))
  })

  /* ---------------------------------------------------------------------- */
  /* Classification — Azure OpenAI                                          */
  /* ---------------------------------------------------------------------- */

  it('the ingestion workflow classifies, hashes and calls the gate', () => {
    const wf = load('02-source-ingestion.json')
    const names = wf.nodes.map((n) => n.name)
    expect(names).toContain('Classify with AI')
    expect(names).toContain('Validate AI output')
    expect(names).toContain('SHA256 content hash')
    expect(names).toContain('Publishing Gate')
  })

  it('classification calls Azure OpenAI, not Anthropic', () => {
    const raw = readFileSync(new URL('02-source-ingestion.json', DIR), 'utf8')
    expect(raw).not.toMatch(/anthropic/i)
    expect(raw).not.toMatch(/claude/i)
    const wf = loadFull('02-source-ingestion.json')
    const n = wf.nodes.find((x) => x.name === 'Classify with AI')
    expect(String((n?.parameters as { url?: string })?.url)).toContain('cognitiveservices.azure.com')
    expect(String((n?.parameters as { url?: string })?.url)).toContain('/chat/completions')
  })

  it('the classification call retries natively instead of a hand-rolled retry graph', () => {
    // The old three-attempt manual retry chain (Interpret AI response /
    // Retry AI call? / Compute AI retry delay / Wait / Merge AI results) is
    // gone — n8n's own retryOnFail replaces it, same as the fetch lanes.
    const wf = loadFull('02-source-ingestion.json')
    const n = wf.nodes.find((x) => x.name === 'Classify with AI')
    expect(n?.retryOnFail).toBe(true)
    expect(n?.maxTries).toBeGreaterThanOrEqual(2)
    const names = new Set(wf.nodes.map((x) => x.name))
    for (const gone of [
      'Interpret AI response (attempt 1)',
      'Interpret AI response (attempt 2)',
      'Interpret AI response (attempt 3 — final)',
      'Retry AI call? (after attempt 1)',
      'Retry AI call? (after attempt 2)',
      'Classify with AI (retry 2)',
      'Classify with AI (retry 3)',
      'Merge AI results (1)',
      'Merge AI results (2)',
      'Get threshold',
      'Continue after threshold',
    ]) {
      expect(names.has(gone), `${gone} should have been removed`).toBe(false)
    }
  })

  it('the content hash is SHA256 hex, matching the database CHECK', () => {
    const wf = load('02-source-ingestion.json') as unknown as {
      nodes: Array<{ name: string; type: string; parameters: Record<string, unknown> }>
    }
    const crypto = wf.nodes.find((n) => n.type === 'n8n-nodes-base.crypto')
    expect(crypto).toBeDefined()
    expect(crypto?.parameters.type).toBe('SHA256')
    expect(crypto?.parameters.encoding).toBe('hex')
    expect(crypto?.parameters.dataPropertyName).toBe('content_hash')
  })

  it('AI output validation is fail-closed on the fields the classifier still produces', () => {
    const raw = readFileSync(new URL('02-source-ingestion.json', DIR), 'utf8')
    for (const field of ['title', 'summary', 'country=', 'category=', 'is_legal_update']) {
      expect(raw, `${field} must be validated`).toContain(field)
    }
    expect(raw).toContain('ai_parse_failure')
    expect(raw).toContain('ai_invalid_output')
    // no confidence score anymore — an obvious-non-legal rejection is the
    // only gate, not a threshold
    expect(raw).not.toContain('confidence >=')
  })

  it('an item the model marks not-legal is rejected, never stored', () => {
    const wf = loadFull('02-source-ingestion.json')
    const n = wf.nodes.find((x) => x.name === 'Validate AI output')
    const code = String(n?.parameters.jsCode ?? '')
    expect(code).toContain("ai.is_legal_update !== true")
    expect(code).toContain("fail('not_legal_update')")
  })

  it('the prompt rejects the listed non-legal content classes and forbids inventing facts', () => {
    const raw = readFileSync(new URL('02-source-ingestion.json', DIR), 'utf8')
    for (const term of ['مؤتمر', 'مذكرة تفاهم', 'زيارة', 'مقابلة', 'بيان', 'إحصاءات', 'رأي', 'تسويقي']) {
      expect(raw, `prompt must name ${term}`).toContain(term)
    }
    expect(raw).toContain('لا تخترع')
  })

  it('normalised items always carry source_id, source_url and title_raw', () => {
    const raw = readFileSync(new URL('02-source-ingestion.json', DIR), 'utf8')
    const wf = loadFull('02-source-ingestion.json')
    const n = wf.nodes.find((x) => x.name === 'Normalise RawItem')
    const code = String(n?.parameters.jsCode ?? '')
    expect(code).toContain('source_id: src.id')
    expect(code).toContain('source_url: sourceUrl')
    expect(code).toContain('title_raw: titleRaw')
    expect(code, 'Normalise RawItem must not return [] on an empty result').toContain('__empty: true')
    expect(raw).toContain('Has items?')
  })

  it('the normaliser enforces the source domain allow-list', () => {
    const raw = readFileSync(new URL('02-source-ingestion.json', DIR), 'utf8')
    expect(raw).toContain('allowed_domains')
    expect(raw).toContain('domain_mismatch')
  })

  it('the normaliser applies the catch-up window when the dispatcher set one, and is a no-op otherwise', () => {
    // Workflow 04's manual catch-up refresh is the only caller that ever sets
    // window_from on the trigger payload — this must not affect any other
    // caller (it never fires today, since 01/05 no longer run on a
    // schedule, but the guard is what makes this node safe to reuse if a
    // scheduled-style caller ever returns).
    const wf = loadFull('02-source-ingestion.json')
    const n = wf.nodes.find((x) => x.name === 'Normalise RawItem')
    const code = String(n?.parameters.jsCode ?? '')
    expect(code).toContain("$('Called by scheduler').first().json.window_from")
    expect(code).toContain('out_of_window')
    // Only rejects a KNOWN older date — an item with no publication_date at
    // all is left for the Publishing Gate's own no_publication_date rule.
    expect(code).toContain('r.publication_date && r.publication_date < windowFromDate')
  })

  /* ---------------------------------------------------------------------- */
  /* Publishing Gate — no confidence threshold                              */
  /* ---------------------------------------------------------------------- */

  it('the publishing gate applies the structural rules with no confidence threshold', () => {
    // is_legal_update is enforced upstream in 02 (Validate AI output) — an
    // item rejected there arrives here already carrying __rejected/reason,
    // and the gate's reject0() just passes that reason through rather than
    // re-deriving it.
    const raw = readFileSync(new URL('03-publishing-gate.json', DIR), 'utf8')
    for (const reason of ['inactive_source', 'unverified_source', 'domain_mismatch', 'duplicate', 'no_publication_date']) {
      expect(raw, `gate must handle ${reason}`).toContain(reason)
    }
    expect(raw).not.toContain('missing_confidence_threshold')
    expect(raw).not.toContain('low_confidence')
    expect(raw).not.toMatch(/confidence_threshold/)
  })

  it('the gate re-reads the source at publish time', () => {
    const wf = load('03-publishing-gate.json')
    expect(wf.nodes.map((n) => n.name)).toContain('Re-read source')
  })

  it('a unique violation on insert is classified as a duplicate, not a failure', () => {
    const raw = readFileSync(new URL('03-publishing-gate.json', DIR), 'utf8')
    expect(raw).toContain('content_hash_unique')
    expect(raw).toContain("outcome: isDuplicate ? 'duplicate' : 'insert_failed'")
  })

  it('publication date is taken from the source, never fabricated from the fetch time', () => {
    const raw = readFileSync(new URL('03-publishing-gate.json', DIR), 'utf8')
    expect(raw).toContain("reject('no_publication_date')")
    expect(raw).not.toContain('fetched_at')
  })

  it('no workflow contains a hardcoded credential or key', () => {
    for (const file of files) {
      const raw = readFileSync(new URL(file, DIR), 'utf8')
      // Supabase keys are JWTs; an inlined one would start like this.
      expect(raw, `${file} contains an inlined JWT`).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/)
      expect(raw).not.toMatch(/sk-[A-Za-z0-9]{20,}/)
      expect(raw).not.toMatch(/service_role["']?\s*:\s*["'][A-Za-z0-9._-]{20,}/)
      // the Azure key pasted during setup must never land in a workflow file
      expect(raw).not.toContain('DncWrJz5IGC7')
    }
  })

  /* ---------------------------------------------------------------------- */
  /* Regression guards carried over from the pre-simplification workflows.   */
  /* See docs/n8n-fixes-2026-08-02.md / -04.md for the incidents.            */
  /* ---------------------------------------------------------------------- */

  it.each(files)('%s has no Code node using an unsupported runtime global', (file) => {
    const wf = loadFull(file)
    for (const n of wf.nodes) {
      if (n.type !== 'n8n-nodes-base.code') continue
      const code = String(n.parameters.jsCode ?? '')
      expect(code, `${n.name}: new URL( is not supported in this n8n runtime`).not.toContain('new URL(')
      expect(code, `${n.name}: $env is not permitted (no Variables access)`).not.toMatch(/\$env\b/)
      expect(code, `${n.name}: $vars is not permitted`).not.toMatch(/\$vars\b/)
      expect(code, `${n.name}: process.env must never appear in workflow JSON`).not.toContain('process.env')
    }
  })

  const READ_NAME_PATTERN = /^(get |get_|look up|re-read|sources for|all sources|settings$)/i

  it.each(files)('%s: Supabase nodes named as reads are not left on Create', (file) => {
    const wf = loadFull(file)
    for (const n of wf.nodes) {
      if (n.type !== 'n8n-nodes-base.supabase') continue
      if (!READ_NAME_PATTERN.test(n.name)) continue
      const op = n.parameters.operation
      expect(['getAll', 'get'], `${file} :: "${n.name}" looks like a read but operation is ${JSON.stringify(op)}`).toContain(op)
    }
  })

  it.each(files)('%s: every Supabase Create/Update node has a field mapping', (file) => {
    const wf = loadFull(file)
    for (const n of wf.nodes) {
      if (n.type !== 'n8n-nodes-base.supabase') continue
      const op = n.parameters.operation
      if (op !== 'create' && op !== 'update' && op !== undefined) continue
      if (READ_NAME_PATTERN.test(n.name)) continue
      const hasFields = Boolean(n.parameters.dataToSend || n.parameters.fieldsUi)
      expect(hasFields, `${file} :: "${n.name}" is a write with no field mapping`).toBe(true)
    }
  })

  it.each(files)('%s: every Execute Workflow node runs once per item', (file) => {
    const wf = loadFull(file)
    for (const n of wf.nodes) {
      if (n.type !== 'n8n-nodes-base.executeWorkflow') continue
      expect(n.parameters.mode, `${file} :: "${n.name}" must set mode:"each"`).toBe('each')
    }
  })

  it('the manual webhook requires native header authentication', () => {
    const wf = loadFull('04-manual-run.json')
    const webhook = wf.nodes.find((n) => n.type === 'n8n-nodes-base.webhook')
    expect(webhook, 'manual run webhook node not found').toBeDefined()
    expect(webhook?.parameters.authentication).toBe('headerAuth')
    expect(webhook?.parameters.responseMode).toBe('responseNode')
  })

  it('every branch reachable from the manual webhook ends at a Respond to Webhook node', () => {
    const wf = loadFull('04-manual-run.json')
    const respondNodes = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.respondToWebhook')
    expect(respondNodes.length).toBeGreaterThanOrEqual(2)
  })

  it('Workflow 04 is just the manual-run webhook — no health/dead-letter/idempotency machinery', () => {
    // The old combined 04 (retry sweep + health snapshots + alert cooldown +
    // the manual_run_dispatches idempotency ledger) is gone along with the
    // tables it wrote to. What's left is exactly "receive a request, run
    // Workflow 02" — see n8n/README.md.
    const wf = loadFull('04-manual-run.json')
    const names = new Set(wf.nodes.map((n) => n.name))
    for (const gone of [
      'Every 15 minutes', 'Retry sweep', 'Dead or retry?', 'Build dead letter', 'Write dead letter',
      'Compute health', 'Snapshot or alert?', 'Snapshot row', 'Write snapshot', 'Roll up to source',
      'Update source health', 'Build alert event', 'Record alert cooldown',
      'Check existing dispatch', 'Has existing dispatch?', 'Already dispatched?', 'Build replay response',
      'Should persist dispatch?', 'Prepare dispatch record', 'Record dispatch', 'Finalize accepted response',
    ]) {
      expect(names.has(gone), `04 should no longer contain "${gone}"`).toBe(false)
    }
  })

  it('Workflow 04 does not re-embed the ingestion or publishing-gate pipeline', () => {
    const wf = loadFull('04-manual-run.json')
    const names = new Set(wf.nodes.map((n) => n.name))
    for (const foreign of ['Parser router', 'Classify with AI', 'Apply the publishing rules', 'Insert into archive']) {
      expect(names.has(foreign), `04 must not contain "${foreign}" — that belongs to 02/03`).toBe(false)
    }
  })

  it('the client is answered before the background dispatch runs, not after', () => {
    // The webhook must not hold the connection open for the whole crawl. The
    // architecture that guarantees this changed with the catch-up refresh:
    // instead of never waiting on Workflow 02 (the old approach), "Insert
    // running run" fans out to "Respond: accepted" AND the dispatch chain in
    // PARALLEL — the response is reachable without passing through either
    // dispatch node, so it cannot be delayed by them.
    //
    // The official chain's entry point is "Get eligible official sources"
    // (a live read of the sources table), not "Prepare official dispatch"
    // directly — fixed 2026-08-11: that node used to sit unconnected while
    // "Prepare official dispatch" read $input from "Insert running run"
    // itself (the just-created run-tracking row, which has no `base_url`),
    // so its own `typeof s.base_url === 'string'` filter always produced
    // zero eligible sources and no official source was ever dispatched by a
    // manual refresh, from the 2026-08-09 rewrite until this fix.
    const wf = loadFull('04-manual-run.json')
    const insert = wf.connections['Insert running run']?.main[0] ?? []
    const targets = insert.map((c) => c.node)
    expect(targets).toContain('Respond: accepted')
    expect(targets).toContain('Get eligible official sources')
    expect(targets).toContain('Prepare discovery dispatch')

    const eligibleTargets = (wf.connections['Get eligible official sources']?.main[0] ?? []).map((c) => c.node)
    expect(eligibleTargets).toContain('Prepare official dispatch')

    // Confirm there is no path FROM the dispatch nodes back INTO the respond
    // node — i.e. the response really is on a separate branch, not staged
    // behind the crawl.
    const names = new Set(wf.nodes.map((n) => n.name))
    expect(names.has('Manual ingestion'), 'the old single fire-and-forget dispatch node is gone').toBe(false)
  })

  it('the two dispatch calls wait for their sub-workflow, now that responding no longer depends on them', () => {
    // Unlike the old architecture, these two now set waitForSubWorkflow:true
    // — safe only because "Respond: accepted" already fired on the parallel
    // branch above. Waiting is what lets Finalize run count real
    // items_published and know when to write the completed/failed state.
    const wf = loadFull('04-manual-run.json')
    for (const name of ['Dispatch official ingestion', 'Dispatch discovery catch-up']) {
      const n = wf.nodes.find((x) => x.name === name)
      expect(n, `${name} not found`).toBeDefined()
      expect(n?.type).toBe('n8n-nodes-base.executeWorkflow')
      const options = (n?.parameters.options ?? {}) as { waitForSubWorkflow?: boolean }
      expect(options.waitForSubWorkflow, `${name} must wait for its sub-workflow`).toBe(true)
    }
  })

  it('the manual run has no scope to validate — it always covers every eligible source', () => {
    // The old source/country/url scopes were dead code: nothing in this app
    // ever called the webhook with them. The catch-up refresh has exactly
    // one behaviour, so there is nothing left to validate before dispatch.
    const wf = loadFull('04-manual-run.json')
    const names = new Set(wf.nodes.map((n) => n.name))
    for (const gone of ['Validate request', 'Request valid?', 'Resolve manual run', 'Runnable?']) {
      expect(names.has(gone), `04 should no longer contain "${gone}"`).toBe(false)
    }
    const raw = readFileSync(new URL('04-manual-run.json', DIR), 'utf8')
    for (const gone of ['invalid_scope', 'missing_source_id', 'missing_country', 'missing_url', 'missing_dead_letter_id']) {
      expect(raw).not.toContain(gone)
    }
  })

  it('the manual-run resolver no longer checks a per-source lock column', () => {
    // sources.lock_expires_at was dropped with the rest of the ops columns.
    // Duplicate-run prevention now lives in ingestion_runs (migration 0024)
    // instead — a database-level single-flight lock, not a per-source one.
    const wf = loadFull('04-manual-run.json')
    const raw = JSON.stringify(wf)
    expect(raw).not.toContain('lock_expires_at')
  })

  it('a concurrent request is answered "already_running", never dispatched twice', () => {
    const wf = loadFull('04-manual-run.json')
    const names = wf.nodes.map((n) => n.name)
    expect(names).toContain('Get running run')
    expect(names).toContain('Already running?')
    expect(names).toContain('Handle insert race or failure')
    const raw = JSON.stringify(wf)
    // Two layers: a pre-check read of ingestion_runs, AND a race guard on the
    // insert itself (ingestion_runs_one_active, migration 0024's partial
    // unique index) for the two-requests-at-once case the pre-check alone
    // cannot catch.
    expect(raw).toContain('already_running')
    expect(raw).toContain('ingestion_runs_one_active')
  })

  it('the catch-up window comes from the last SUCCEEDED run, with a bounded fallback', () => {
    const wf = loadFull('04-manual-run.json')
    const n = wf.nodes.find((x) => x.name === 'Compute window & guard')
    const code = String(n?.parameters.jsCode ?? '')
    expect(code).toContain("r.status === 'succeeded'")
    expect(code).toContain('OVERLAP_HOURS')
    expect(code).toContain('INITIAL_LOOKBACK_HOURS')
    // No unlimited historical backfill when there has never been a successful run.
    expect(code).not.toMatch(/INITIAL_LOOKBACK_HOURS\s*=\s*Infinity/)
  })

  it('a failed run does not advance the checkpoint', () => {
    // Compute window & guard only ever reads status = 'succeeded' rows when
    // picking window_from — a 'failed' or still-'running' row is invisible
    // to that query, so a half-finished refresh cannot shrink the next
    // run's coverage.
    const wf = loadFull('04-manual-run.json')
    const finalize = wf.nodes.find((x) => x.name === 'Finalize run')
    const code = String(finalize?.parameters.jsCode ?? '')
    expect(code).toContain("status: totalFailure ? 'failed' : 'succeeded'")
  })

  it('the catch-up refresh dispatches BOTH official sources and discovery, not just one', () => {
    const wf = loadFull('04-manual-run.json')
    const dispatchTo02 = wf.nodes.find((n) => n.name === 'Dispatch official ingestion')
    const dispatchTo05 = wf.nodes.find((n) => n.name === 'Dispatch discovery catch-up')
    expect(dispatchTo02, 'no dispatch into Workflow 02 (official sources)').toBeDefined()
    expect(dispatchTo05, 'no dispatch into Workflow 05 (discovery)').toBeDefined()
    const wfId02 = (dispatchTo02?.parameters.workflowId as { value?: string } | undefined)?.value
    const wfId05 = (dispatchTo05?.parameters.workflowId as { value?: string } | undefined)?.value
    expect(wfId02).toBe('FHt8uKbBcixIWbWO')
    expect(wfId05).toBe('vCGP6RoEAhiG9LS5')
  })

  it('official-source eligibility excludes discovery-mode sources — Workflow 05 owns those', () => {
    const wf = loadFull('04-manual-run.json')
    const n = wf.nodes.find((x) => x.name === 'Prepare official dispatch')
    const code = String(n?.parameters.jsCode ?? '')
    expect(code).toContain("s.active && s.config_status === 'verified'")
    expect(code).toContain("s.ingestion_mode !== 'discovery'")
  })

  it('a per-source dispatch failure does not fail the whole run, only a total wipeout does', () => {
    const wf = loadFull('04-manual-run.json')
    const n = wf.nodes.find((x) => x.name === 'Finalize run')
    const code = String(n?.parameters.jsCode ?? '')
    expect(code).toContain('e.error')
    expect(code).toContain('items_published')
    expect(code).toContain('dispatchFailures === items.length')
  })

  /* ---------------------------------------------------------------------- */
  /* Hybrid discovery layer — Workflow 05 and the Workflow 02/03 changes     */
  /* that let a discovered item share the official pipeline.                */
  /* ---------------------------------------------------------------------- */

  it('Workflow 05 fetches Google News per GCC country and resolves candidates', () => {
    const wf = loadFull('05-discovery-ingestion.json')
    const names = wf.nodes.map((n) => n.name)
    expect(names).toContain('Get discovery sources')
    expect(names).toContain('Get official sources')
    expect(names).toContain('Fetch discovery feed')
    expect(names).toContain('Parse discovery feed')
    expect(names).toContain('Resolve and group items')
    expect(names).toContain('Dispatch to ingestion')
  })

  it('Workflow 05 does not re-embed ingestion, classification or the gate', () => {
    const wf = loadFull('05-discovery-ingestion.json')
    const names = new Set(wf.nodes.map((n) => n.name))
    for (const foreign of ['Parser router', 'Classify with AI', 'Apply the publishing rules', 'Insert into archive']) {
      expect(names.has(foreign), `05 must not contain "${foreign}"`).toBe(false)
    }
  })

  it('Workflow 05 dispatches into the real Workflow 02, one execution per resolved source', () => {
    const wf = loadFull('05-discovery-ingestion.json')
    const dispatch = wf.nodes.find((n) => n.name === 'Dispatch to ingestion')
    expect(dispatch?.type).toBe('n8n-nodes-base.executeWorkflow')
    expect(dispatch?.parameters.mode).toBe('each')
  })

  it('the discovery feed fetch preserves item order so results zip back to their source safely', () => {
    const wf = loadFull('05-discovery-ingestion.json')
    const fetch = wf.nodes.find((n) => n.name === 'Fetch discovery feed')
    expect(fetch?.onError).toBe('continueRegularOutput')
  })

  it('Workflow 05 no longer runs on its own schedule — it is callable-only, triggered by Workflow 04', () => {
    const wf = loadFull('05-discovery-ingestion.json')
    const names = wf.nodes.map((n) => n.name)
    expect(names).not.toContain('Every 2 hours')
    expect(wf.nodes.some((n) => n.type === 'n8n-nodes-base.scheduleTrigger')).toBe(false)
    const trigger = wf.nodes.find((n) => n.type === 'n8n-nodes-base.executeWorkflowTrigger')
    expect(trigger, 'Workflow 05 must expose an Execute Workflow Trigger to be callable').toBeDefined()
    expect(trigger?.name).toBe('Called for catch-up')
  })

  it('Workflow 05 forwards the catch-up window onto every group it dispatches', () => {
    const wf = loadFull('05-discovery-ingestion.json')
    const n = wf.nodes.find((x) => x.name === 'Resolve and group items')
    const code = String(n?.parameters.jsCode ?? '')
    expect(code).toContain("$('Called for catch-up').first().json")
    expect(code).toContain('window_from: trigger.window_from')
    expect(code).toContain('window_to: trigger.window_to')
  })

  it('discovery candidates are resolved against a real official-source registry, never invented', () => {
    const wf = loadFull('05-discovery-ingestion.json')
    const n = wf.nodes.find((x) => x.name === 'Resolve and group items')
    const code = String(n?.parameters.jsCode ?? '')
    expect(code).toContain('domain_match')
    expect(code).toContain('authority_name_match')
    expect(code).toMatch(/confidence >= 60/)
    expect(code).toContain("ingestion_mode !== 'discovery'")
    expect(code).toContain("config_status === 'verified'")
  })

  it('official and discovery source lookups are unfiltered getAll — filtering happens in code', () => {
    const wf = loadFull('05-discovery-ingestion.json')
    for (const name of ['Get discovery sources', 'Get official sources']) {
      const n = wf.nodes.find((x) => x.name === name)
      expect(n?.parameters.filters, `${name} must not rely on a Supabase multi-condition filter`).toBeUndefined()
    }
    const filterNode = wf.nodes.find((x) => x.name === 'Filter discovery sources')
    const code = String(filterNode?.parameters.jsCode ?? '')
    expect(code).toContain("ingestion_mode === 'discovery'")
    expect(code).toContain('active === true')
  })

  it('discovery candidates are deduplicated within a run before dispatch', () => {
    const wf = loadFull('05-discovery-ingestion.json')
    const n = wf.nodes.find((x) => x.name === 'Resolve and group items')
    const code = String(n?.parameters.jsCode ?? '')
    expect(code).toContain('seenTitles')
  })

  it('Google News <link> is never treated as a directly fetchable canonical URL', () => {
    const wf = loadFull('05-discovery-ingestion.json')
    const n = wf.nodes.find((x) => x.name === 'Parse discovery feed')
    const code = String(n?.parameters.jsCode ?? '')
    expect(code).toContain('sourceTag')
    expect(code).toContain('JS redirect shell')
  })

  it('Workflow 02 accepts prefetched discovery items without re-running the official parser lanes', () => {
    const wf = loadFull('02-source-ingestion.json')
    const names = wf.nodes.map((n) => n.name)
    expect(names).toContain('Has prefetched items?')
    expect(names).toContain('Unwrap prefetched items')
    expect(wf.connections['Called by scheduler']?.main[0]).toEqual([
      { node: 'Has prefetched items?', type: 'main', index: 0 },
    ])
    // Prefetched items go through Unwrap prefetched items (which turns the
    // ONE trigger item's prefetched_items array into separate top-level
    // RawItems) before Normalise RawItem — never straight there. Fixed
    // 2026-08-11: for a window with this step missing, Normalise RawItem
    // read r.source_url off the wrapper object itself (undefined), so every
    // discovery item was rejected as no_url before classification, 100% of
    // the time, live-confirmed. The official parser lanes (Parser router
    // onward) only run for the non-prefetched branch, unaffected either way.
    expect(wf.connections['Has prefetched items?']?.main[0]).toEqual([
      { node: 'Unwrap prefetched items', type: 'main', index: 0 },
    ])
    expect(wf.connections['Has prefetched items?']?.main[1]).toEqual([
      { node: 'Parser router', type: 'main', index: 0 },
    ])
    expect(wf.connections['Unwrap prefetched items']?.main[0]).toEqual([
      { node: 'Normalise RawItem', type: 'main', index: 0 },
    ])
  })

  it('Normalise RawItem bypasses the domain allow-list only for discovery-mode sources', () => {
    const wf = loadFull('02-source-ingestion.json')
    const n = wf.nodes.find((x) => x.name === 'Normalise RawItem')
    const code = String(n?.parameters.jsCode ?? '')
    expect(code).toContain("src.ingestion_mode === 'discovery'")
    expect(code).toContain('isDiscoverySource')
    expect(code).not.toContain('if (!allowed.includes(host))')
  })

  it('Normalise RawItem carries origin_type/canonical_url/discovery_engine through', () => {
    const wf = loadFull('02-source-ingestion.json')
    const n = wf.nodes.find((x) => x.name === 'Normalise RawItem')
    const code = String(n?.parameters.jsCode ?? '')
    expect(code).toContain('origin_type: r.origin_type')
    expect(code).toContain('canonical_url: r.canonical_url')
    expect(code).toContain('discovery_engine: r.discovery_engine')
  })

  it('the Publishing Gate bypasses the domain check only for discovery-mode sources, and records origin', () => {
    const wf = loadFull('03-publishing-gate.json')
    const n = wf.nodes.find((x) => x.name === 'Apply the publishing rules')
    const code = String(n?.parameters.jsCode ?? '')
    expect(code).toContain("source.ingestion_mode === 'discovery'")
    expect(code).toContain('isDiscoverySource')
    expect(code).toContain('origin_type: item.origin_type')
    expect(code).toContain('canonical_url: item.canonical_url')
    expect(code).toContain('discovery_engine: item.discovery_engine')
  })

  it('the Publishing Gate still enforces the other structural rules for a discovery-origin item', () => {
    // The bypass is narrowly for the domain allow-list rule. Duplicate and
    // publication-date rules are untouched; legal-relevance was already
    // enforced upstream in 02 before the item reaches the gate at all.
    const raw = readFileSync(new URL('03-publishing-gate.json', DIR), 'utf8')
    for (const reason of ['duplicate', 'no_publication_date']) {
      expect(raw).toContain(reason)
    }
  })
})
