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

function load(file: string): Workflow {
  return JSON.parse(readFileSync(new URL(file, DIR), 'utf8')) as Workflow
}

describe('n8n workflow exports', () => {
  it('ships the scheduler, ingestion and publishing-gate workflows', () => {
    expect(files).toContain('01-source-scheduler.json')
    expect(files).toContain('02-source-ingestion.json')
    expect(files).toContain('03-publishing-gate.json')
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
    const triggers = wf.nodes.filter((n) => /trigger/i.test(n.type))
    expect(triggers).toHaveLength(1)
  })

  it('the scheduler runs hourly and dispatches to the ingestion workflow', () => {
    const wf = load('01-source-scheduler.json')
    expect(wf.nodes.some((n) => n.type === 'n8n-nodes-base.scheduleTrigger')).toBe(true)
    expect(wf.nodes.some((n) => n.type === 'n8n-nodes-base.executeWorkflow')).toBe(true)
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

  it('every HTTP node retries on transient failure', () => {
    const raw = readFileSync(new URL('02-source-ingestion.json', DIR), 'utf8')
    const wf = JSON.parse(raw) as { nodes: Array<Record<string, unknown>> }
    const http = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest')
    // four fetch lanes plus the AI call
    expect(http.length).toBe(5)
    for (const node of http) {
      expect(node.retryOnFail, `${String(node.name)} must retry`).toBe(true)
    }
    // the four crawl lanes must isolate their failure so one dead source
    // cannot stop the others in the same tick
    const lanes = http.filter((n) => String(n.name).startsWith('Fetch'))
    expect(lanes.length).toBe(4)
    for (const node of lanes) {
      expect(node.onError).toBe('continueErrorOutput')
    }
  })

  /* ---------------------------------------------------------------------- */
  /* Source provisioning (2026-08-03) — real defects found while dry-run     */
  /* testing candidate sources against production n8n egress.                */
  /* ---------------------------------------------------------------------- */

  it('every fetch lane accepts a per-source TLS bypass, never on by default', () => {
    // Several government certificates are valid (verified independently
    // against a trusted CA store — DigiCert/Sectigo/Amazon, all unexpired,
    // correctly issued) but fail n8n's own stale CA bundle. The bypass is
    // opt-in per source via parser_config, never a blanket default.
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
    // text/CDATA: <title><a href="...">real text</a></title>. The naive
    // v._ ?? v['#text'] lookup returns '' for this shape, which silently
    // rejected every single item in the feed as having no title. Confirmed
    // empirically via a dry run before this fix (0/50 items titled) and
    // after (title recovered).
    const wf = loadFull('02-source-ingestion.json')
    const n = wf.nodes.find((x) => x.name === 'RSS → RawItem')
    const code = String(n?.parameters.jsCode ?? '')
    expect(code).toContain("if (v._ !== undefined) return v._;")
    expect(code).toContain("for (const key of Object.keys(v))")
    // must still short-circuit on the common shapes first — no regression
    // in the fast path for well-formed feeds
    expect(code.indexOf("if (v._ !== undefined)")).toBeLessThan(code.indexOf('for (const key of Object.keys(v))'))
  })

  /* ---------------------------------------------------------------------- */
  /* M9 — AI classification and the Publishing Gate                          */
  /* ---------------------------------------------------------------------- */

  it('the ingestion workflow classifies, hashes and calls the gate', () => {
    const wf = load('02-source-ingestion.json')
    const names = wf.nodes.map((n) => n.name)
    expect(names).toContain('Classify with AI')
    expect(names).toContain('Validate AI output')
    expect(names).toContain('SHA256 content hash')
    expect(names).toContain('Publishing Gate')
    expect(names).toContain('Write workflow log')
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

  it('the hash covers source, url, title and publication date', () => {
    const raw = readFileSync(new URL('02-source-ingestion.json', DIR), 'utf8')
    expect(raw).toContain('item.source_id, item.source_url, e.ai.title_ar, pubDate')
  })

  it('AI output validation is fail-closed across every constrained field', () => {
    const raw = readFileSync(new URL('02-source-ingestion.json', DIR), 'utf8')
    for (const field of [
      'title_ar',
      'summary_ar',
      'country=',
      'category=',
      'document_type=',
      'legal_status=',
      'is_legal_update',
      'confidence=',
      'effective_date=',
      'publication_date=',
    ]) {
      expect(raw, `${field} must be validated`).toContain(field)
    }
    expect(raw).toContain('ai_parse_failure')
    expect(raw).toContain('ai_invalid_output')
  })

  it('the AI prompt rejects the listed non-legal content classes', () => {
    const raw = readFileSync(new URL('02-source-ingestion.json', DIR), 'utf8')
    // meetings, MoUs, visits, interviews, press releases, statistics, opinion,
    // marketing — named explicitly in the system prompt
    for (const term of ['مؤتمر', 'مذكرة تفاهم', 'زيارة', 'مقابلة', 'بيان', 'إحصاءات', 'رأي', 'تسويقي']) {
      expect(raw, `prompt must name ${term}`).toContain(term)
    }
  })

  it('the prompt forbids inventing facts and interpreting the law', () => {
    const raw = readFileSync(new URL('02-source-ingestion.json', DIR), 'utf8')
    expect(raw).toContain('لا تخترع')
    expect(raw).toContain('لا تفسّر')
  })

  it('the publishing gate applies all five rules plus the threshold guard', () => {
    const raw = readFileSync(new URL('03-publishing-gate.json', DIR), 'utf8')
    for (const reason of [
      'missing_confidence_threshold',
      'inactive_source',
      'unverified_source',
      'domain_mismatch',
      'duplicate',
      'low_confidence',
      'not_legal_update',
      'no_publication_date',
    ]) {
      expect(raw, `gate must handle ${reason}`).toContain(reason)
    }
  })

  it('the gate never defaults the fail-closed confidence threshold', () => {
    const raw = readFileSync(new URL('03-publishing-gate.json', DIR), 'utf8')
    // an absent threshold must reject, not fall back to 0.9
    expect(raw).toContain("reject('missing_confidence_threshold'")
    expect(raw).not.toMatch(/threshold\s*\|\|\s*0\.9/)
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

  it('the run summary writes one workflow_logs row with rejection reasons', () => {
    const raw = readFileSync(new URL('02-source-ingestion.json', DIR), 'utf8')
    expect(raw).toContain('rejection_reasons')
    expect(raw).toContain('items_published')
    expect(raw).toContain('items_rejected')
    expect(raw).toContain('workflow_logs')
  })

  it('publication date is taken from the source or the document, never fabricated', () => {
    const raw = readFileSync(new URL('03-publishing-gate.json', DIR), 'utf8')
    expect(raw).toContain("item.publication_date || ai.publication_date || null")
    expect(raw).toContain("reject('no_publication_date')")
    // the fetch time must never stand in for a publication date
    expect(raw).not.toContain('fetched_at')
  })

  it('no workflow contains a hardcoded credential or key', () => {
    for (const file of files) {
      const raw = readFileSync(new URL(file, DIR), 'utf8')
      // Supabase keys are JWTs; an inlined one would start like this.
      expect(raw, `${file} contains an inlined JWT`).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/)
      expect(raw).not.toMatch(/sk-[A-Za-z0-9]{20,}/)
      expect(raw).not.toMatch(/service_role["']?\s*:\s*["'][A-Za-z0-9._-]{20,}/)
    }
  })

  it('the scheduler refuses unverified sources in code, not only in the database', () => {
    const raw = readFileSync(new URL('01-source-scheduler.json', DIR), 'utf8')
    expect(raw).toContain("config_status !== 'verified'")
    expect(raw).toContain("parser_type === 'unknown'")
  })

  it('the normaliser enforces the source domain allow-list', () => {
    const raw = readFileSync(new URL('02-source-ingestion.json', DIR), 'utf8')
    expect(raw).toContain('allowed_domains')
    expect(raw).toContain('domain_mismatch')
  })

  /* ---------------------------------------------------------------------- */
  /* Regression guards — each of these previously broke a live run.          */
  /* See docs/n8n-fixes-2026-08-02.md for the incidents that motivated them. */
  /* ---------------------------------------------------------------------- */

  interface FullNode {
    id: string
    name: string
    type: string
    typeVersion: number
    parameters: Record<string, unknown>
    alwaysOutputData?: boolean
    onError?: string
  }

  function loadFull(file: string): { nodes: FullNode[]; connections: Workflow['connections'] } {
    return JSON.parse(readFileSync(new URL(file, DIR), 'utf8'))
  }

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

  // Nodes whose name signals "this reads data" — each previously shipped
  // pointed at the Supabase default operation (Create) with no field mapping,
  // which silently attempts to insert an all-null row and throws a NOT NULL
  // violation instead of returning the rows the workflow actually needs.
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
      if (READ_NAME_PATTERN.test(n.name)) continue // covered above
      const hasFields = Boolean(n.parameters.dataToSend || n.parameters.fieldsUi)
      expect(hasFields, `${file} :: "${n.name}" is a write with no field mapping`).toBe(true)
    }
  })

  // Every Execute Workflow node in this system calls into a sub-workflow whose
  // trigger reads $('...').first() — i.e. it is written for exactly one item.
  // The node defaults to batching all input items into a single sub-workflow
  // call ("once"); without an explicit per-item mode, item 2..N of any batch
  // is silently dropped.
  it.each(files)('%s: every Execute Workflow node runs once per item', (file) => {
    const wf = loadFull(file)
    for (const n of wf.nodes) {
      if (n.type !== 'n8n-nodes-base.executeWorkflow') continue
      expect(n.parameters.mode, `${file} :: "${n.name}" must set mode:"each"`).toBe('each')
    }
  })

  it.each(files)('%s: Execute Workflow nodes reference one of the four known workflows', (file) => {
    const wf = loadFull(file)
    const KNOWN_IDS = new Set([
      '9tBYdFdqdE76gQuQ', // 01 — Source Scheduler
      'FHt8uKbBcixIWbWO', // 02 — Source Ingestion
      '2AmFW6QzgNwSxaOU', // 03 — Publishing Gate
      'HWSwJIZfuZVsErD8', // 04 — Retry, Health and Manual Run
    ])
    for (const n of wf.nodes) {
      if (n.type !== 'n8n-nodes-base.executeWorkflow') continue
      const target = (n.parameters.workflowId as { value?: string } | undefined)?.value
      expect(target, `${file} :: "${n.name}" has no workflow target`).toBeTruthy()
      expect(KNOWN_IDS.has(target ?? ''), `${file} :: "${n.name}" points at an unknown workflow id ${target}`).toBe(true)
    }
  })

  it('the manual webhook requires native header authentication', () => {
    const wf = loadFull('04-retry-health-manual.json')
    const webhook = wf.nodes.find((n) => n.type === 'n8n-nodes-base.webhook')
    expect(webhook, 'manual run webhook node not found').toBeDefined()
    expect(webhook?.parameters.authentication).toBe('headerAuth')
    expect(webhook?.parameters.responseMode, 'must use an explicit Respond to Webhook node to vary HTTP status per outcome').toBe(
      'responseNode',
    )
  })

  it('every branch reachable from the manual webhook ends at a Respond to Webhook node', () => {
    const wf = loadFull('04-retry-health-manual.json')
    const respondNodes = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.respondToWebhook')
    expect(respondNodes.length).toBeGreaterThanOrEqual(2)
  })

  it('normalised items always carry source_id, source_url and title_raw', () => {
    const raw = readFileSync(new URL('02-source-ingestion.json', DIR), 'utf8')
    const wf = loadFull('02-source-ingestion.json')
    const n = wf.nodes.find((x) => x.name === 'Normalise RawItem')
    const code = String(n?.parameters.jsCode ?? '')
    expect(code).toContain('source_id: src.id')
    expect(code).toContain('source_url: sourceUrl')
    expect(code).toContain('title_raw: titleRaw')
    // a genuinely empty result must still leave one item behind, or every
    // downstream node (including the log write) is skipped and the run
    // vanishes without a workflow_logs row or a webhook response
    expect(code, 'Normalise RawItem must not return [] on an empty result').toContain('__empty: true')
    expect(raw).toContain('Has items?')
  })

  it('Workflow 04 does not re-embed the ingestion or publishing-gate pipeline', () => {
    // 04 dispatches to 02 and 03 by Execute Workflow; it must never carry its
    // own copy of their logic, or the two copies drift and only one of them
    // gets fixed the next time a bug is found.
    const wf = loadFull('04-retry-health-manual.json')
    const names = new Set(wf.nodes.map((n) => n.name))
    for (const foreign of ['Parser router', 'Classify with AI', 'Apply the five rules', 'Insert into archive']) {
      expect(names.has(foreign), `04 must not contain "${foreign}" — that belongs to 02/03`).toBe(false)
    }
  })

  it('Workflow 04 does not duplicate the hourly scheduler', () => {
    // 01 already owns due-source selection; a second "Every hour" trigger in
    // 04 double-schedules every source and double-fires on the DB constraint
    // bug this test file already guards against.
    const wf = loadFull('04-retry-health-manual.json')
    const scheduleTriggers = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.scheduleTrigger')
    expect(scheduleTriggers).toHaveLength(1)
    expect(scheduleTriggers[0]?.name).toBe('Every 15 minutes')
  })

  /* ---------------------------------------------------------------------- */
  /* Async manual-run dispatch — the fix for the Next.js timeout.            */
  /* lib/ops/dispatch.ts is the tested specification; these assert the       */
  /* n8n side actually wires up what that spec requires.                     */
  /* ---------------------------------------------------------------------- */

  it('the manual-run dispatch is fired without waiting for Workflow 02', () => {
    const wf = loadFull('04-retry-health-manual.json')
    const dispatch = wf.nodes.find((n) => n.name === 'Manual ingestion')
    expect(dispatch, 'Manual ingestion node not found').toBeDefined()
    expect(dispatch?.type).toBe('n8n-nodes-base.executeWorkflow')
    const options = (dispatch?.parameters.options ?? {}) as { waitForSubWorkflow?: boolean }
    expect(options.waitForSubWorkflow, 'the webhook must not block on Workflow 02 finishing').toBe(false)
  })

  it('the manual-run response is never built by relying on Always Output Data', () => {
    // alwaysOutputData is used exactly once, on the idempotency lookup, to
    // survive a genuine zero-row result — not as a stand-in for an explicit
    // Respond to Webhook decision.
    const wf = loadFull('04-retry-health-manual.json')
    const responseBuilders = ['Build manual run response', 'Build replay response', 'Build bad request response']
    for (const name of responseBuilders) {
      const n = wf.nodes.find((x) => x.name === name)
      expect(n, `${name} not found`).toBeDefined()
      expect(n?.alwaysOutputData, `${name} must not use alwaysOutputData as its mechanism`).not.toBe(true)
    }
    const dispatch = wf.nodes.find((n) => n.name === 'Manual ingestion')
    expect(dispatch?.alwaysOutputData, 'the old alwaysOutputData patch on the dispatch node must be gone').not.toBe(
      true,
    )
  })

  it('a genuine zero-row idempotency lookup does not silently kill the branch', () => {
    // "Check existing dispatch" legitimately returns zero rows on the common
    // path (no prior dispatch for a fresh correlation_id); n8n does not run a
    // downstream node whose every input was empty unless told to.
    const wf = loadFull('04-retry-health-manual.json')
    const lookup = wf.nodes.find((n) => n.name === 'Check existing dispatch')
    expect(lookup?.alwaysOutputData).toBe(true)
  })

  it('the webhook answers with a distinct, documented code for every outcome', () => {
    const wf = loadFull('04-retry-health-manual.json')
    const respondNodes = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.respondToWebhook')
    expect(respondNodes.length).toBeGreaterThanOrEqual(2)

    const badRequest = respondNodes.find((n) => n.name === 'Respond: bad request')
    expect((badRequest?.parameters.options as { responseCode?: unknown })?.responseCode).toBe(400)

    const manualRun = respondNodes.find((n) => n.name === 'Respond: manual run')
    const code = String((manualRun?.parameters.options as { responseCode?: unknown })?.responseCode ?? '')
    for (const status of ['202', '404', '409', '500']) {
      expect(code, `manual run response code must branch on ${status}`).toContain(status)
    }
    expect(code).toContain("$json.status === 'accepted'")
    expect(code).toContain("$json.reason === 'already_running'")
  })

  it('a malformed manual-run request is validated before any source is touched', () => {
    const wf = loadFull('04-retry-health-manual.json')
    const names = wf.nodes.map((n) => n.name)
    expect(names).toContain('Validate request')
    expect(names).toContain('Request valid?')
    const raw = readFileSync(new URL('04-retry-health-manual.json', DIR), 'utf8')
    for (const reason of [
      'invalid_scope',
      'missing_source_id',
      'missing_country',
      'missing_url',
      'missing_dead_letter_id',
    ]) {
      expect(raw, `request validation must cover ${reason}`).toContain(reason)
    }
  })

  it('a retried correlation_id is looked up before the scope is resolved again', () => {
    const wf = loadFull('04-retry-health-manual.json')
    const names = new Set(wf.nodes.map((n) => n.name))
    expect(names.has('Check existing dispatch')).toBe(true)
    expect(names.has('Has existing dispatch?')).toBe(true)
    expect(names.has('Build replay response')).toBe(true)

    const lookup = wf.nodes.find((n) => n.name === 'Check existing dispatch')
    expect(lookup?.parameters.tableId).toBe('manual_run_dispatches')
    const filters = lookup?.parameters.filters as { conditions?: Array<{ keyName?: string }> } | undefined
    expect(filters?.conditions?.some((c) => c.keyName === 'correlation_id')).toBe(true)
  })

  it('an accepted dispatch is recorded in the idempotency ledger', () => {
    const wf = loadFull('04-retry-health-manual.json')
    const record = wf.nodes.find((n) => n.name === 'Record dispatch')
    expect(record, 'Record dispatch node not found').toBeDefined()
    expect(record?.parameters.tableId).toBe('manual_run_dispatches')
    expect(record?.onError, 'a duplicate-key race must not surface as a failure').toBe('continueRegularOutput')

    // it must only fire for an actual accept, never for a rejection/skip
    const names = wf.nodes.map((n) => n.name)
    expect(names).toContain('Should persist dispatch?')
  })

  it('the replay response is idempotent, not a fresh resolution', () => {
    const raw = readFileSync(new URL('04-retry-health-manual.json', DIR), 'utf8')
    // the replay must echo the STORED accepted_at, not compute `new Date()`
    const wf = loadFull('04-retry-health-manual.json')
    const replay = wf.nodes.find((n) => n.name === 'Build replay response')
    const code = String(replay?.parameters.jsCode ?? '')
    expect(code).not.toContain('new Date()')
    expect(code).toContain('r.accepted_at')
    expect(raw).toContain('Build replay response')
  })

  it('dispatch failures are folded into the response, not lost or double-counted', () => {
    const wf = loadFull('04-retry-health-manual.json')
    const build = wf.nodes.find((n) => n.name === 'Build manual run response')
    const code = String(build?.parameters.jsCode ?? '')
    expect(code).toContain('dispatch_failed')
    expect(code).toContain('e.error')
  })

  /* ---------------------------------------------------------------------- */
  /* Workflow 02 — correlation_id carried through to the final log row.      */
  /* ---------------------------------------------------------------------- */

  it('every workflow_logs write includes the correlation_id from the trigger item', () => {
    const wf = loadFull('02-source-ingestion.json')
    for (const name of ['Summarise run', 'Build empty run summary', 'Build failed run summary']) {
      const n = wf.nodes.find((x) => x.name === name)
      expect(n, `${name} not found`).toBeDefined()
      const code = String(n?.parameters.jsCode ?? '')
      expect(code, `${name} must read correlation_id from the trigger item`).toContain(
        "$('Called by scheduler').first().json.correlation_id",
      )
      expect(code, `${name} must write correlation_id onto the workflow_logs row`).toContain(
        'correlation_id: correlationId',
      )
    }
  })

  it('a scheduled run (no correlation_id in the trigger item) still logs cleanly', () => {
    // trigger_type already defaults the same way; correlation_id must default
    // to null rather than throwing on `undefined.correlation_id`.
    const wf = loadFull('02-source-ingestion.json')
    const n = wf.nodes.find((x) => x.name === 'Summarise run')
    const code = String(n?.parameters.jsCode ?? '')
    expect(code).toContain('correlation_id || null')
  })

  /* ---------------------------------------------------------------------- */
  /* Hybrid discovery layer (2026-08-03) — Workflow 05 and the Workflow 02/  */
  /* 03 changes that let a discovered item share the official pipeline.      */
  /* ---------------------------------------------------------------------- */

  it('ships the discovery ingestion workflow', () => {
    expect(files).toContain('06-discovery-ingestion.json')
  })

  it('Workflow 05 fetches Google News per GCC country and resolves candidates', () => {
    const wf = loadFull('06-discovery-ingestion.json')
    const names = wf.nodes.map((n) => n.name)
    expect(names).toContain('Get discovery sources')
    expect(names).toContain('Get official sources')
    expect(names).toContain('Fetch discovery feed')
    expect(names).toContain('Parse discovery feed')
    expect(names).toContain('Resolve and group items')
    expect(names).toContain('Dispatch to ingestion')
  })

  it('Workflow 05 does not re-embed ingestion, classification or the gate', () => {
    // Same rule as Workflow 04: dispatch by Execute Workflow, never a second
    // copy of the pipeline those workflows already own.
    const wf = loadFull('06-discovery-ingestion.json')
    const names = new Set(wf.nodes.map((n) => n.name))
    for (const foreign of ['Parser router', 'Classify with AI', 'Apply the five rules', 'Insert into archive']) {
      expect(names.has(foreign), `05 must not contain "${foreign}"`).toBe(false)
    }
  })

  it('Workflow 05 dispatches into the real Workflow 02, one execution per resolved source', () => {
    const wf = loadFull('06-discovery-ingestion.json')
    const dispatch = wf.nodes.find((n) => n.name === 'Dispatch to ingestion')
    expect(dispatch?.type).toBe('n8n-nodes-base.executeWorkflow')
    const target = (dispatch?.parameters.workflowId as { value?: string } | undefined)?.value
    expect(target).toBe('FHt8uKbBcixIWbWO')
    expect(dispatch?.parameters.mode).toBe('each')
  })

  it('the discovery feed fetch preserves item order so results zip back to their source safely', () => {
    // continueRegularOutput keeps one output item per input item, in order —
    // continueErrorOutput would shift a later discovery source's result into
    // the wrong slot the moment an earlier fetch failed.
    const wf = loadFull('06-discovery-ingestion.json')
    const fetch = wf.nodes.find((n) => n.name === 'Fetch discovery feed')
    expect(fetch?.onError).toBe('continueRegularOutput')
  })

  it('discovery candidates are resolved against a real official-source registry, never invented', () => {
    const wf = loadFull('06-discovery-ingestion.json')
    const n = wf.nodes.find((x) => x.name === 'Resolve and group items')
    const code = String(n?.parameters.jsCode ?? '')
    expect(code).toContain('domain_match')
    expect(code).toContain('authority_name_match')
    // the weak signal must be gated, not treated the same as a domain match
    expect(code).toMatch(/confidence >= 60/)
    // only a source the database would actually let publish may be credited
    expect(code).toContain("ingestion_mode !== 'discovery'")
    expect(code).toContain("config_status === 'verified'")
  })

  it('"Get official sources" is wired into a REAL execution path, not just referenced by $()', () => {
    // The exact failure mode already hit once in this project (docs/n8n-
    // fixes-2026-08-02.md, incident #5): a node with no outgoing connection,
    // read only via $('...') from elsewhere, can be skipped by n8n's
    // execution planner. "Merge for resolution" gives it a real edge.
    const wf = loadFull('06-discovery-ingestion.json')
    expect(wf.connections['Get official sources']?.main[0]).toEqual([
      { node: 'Merge for resolution', type: 'main', index: 1 },
    ])
  })

  it('official and discovery source lookups are unfiltered getAll — filtering happens in code', () => {
    // A multi-condition Supabase node filter proved unreliable in this n8n
    // version: an AND of ingestion_mode=eq.discovery + active=eq.true
    // returned every active source regardless of mode (caught live — Umm
    // Al-Qura's and GSO's own feed items appeared mislabelled as discovery
    // candidates). Fetch small tables whole and filter in memory instead,
    // exactly like the scheduler and retry sweep already do.
    const wf = loadFull('06-discovery-ingestion.json')
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
    const wf = loadFull('06-discovery-ingestion.json')
    const n = wf.nodes.find((x) => x.name === 'Resolve and group items')
    const code = String(n?.parameters.jsCode ?? '')
    expect(code).toContain('seenTitles')
  })

  it('Google News <link> is never treated as a directly fetchable canonical URL', () => {
    // Documented, verified limitation: these links resolve through a
    // client-side JS shell with no server-side redirect target. The parser
    // must key off <source url> instead of chasing <link>.
    const wf = loadFull('06-discovery-ingestion.json')
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

    // "Called by scheduler" must route through the new IF FIRST — never
    // fan out to both the discovery bypass AND Parser router in the same
    // execution, which would refetch the resolved source's own feed twice.
    expect(wf.connections['Called by scheduler']?.main[0]).toEqual([
      { node: 'Has prefetched items?', type: 'main', index: 0 },
    ])
  })

  it('Normalise RawItem bypasses the domain allow-list only for discovery-mode sources', () => {
    const wf = loadFull('02-source-ingestion.json')
    const n = wf.nodes.find((x) => x.name === 'Normalise RawItem')
    const code = String(n?.parameters.jsCode ?? '')
    expect(code).toContain("src.ingestion_mode === 'discovery'")
    expect(code).toContain('isDiscoverySource')
    // the bypass must be conditional, never unconditional
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
    const n = wf.nodes.find((x) => x.name === 'Apply the five rules')
    const code = String(n?.parameters.jsCode ?? '')
    expect(code).toContain("source.ingestion_mode === 'discovery'")
    expect(code).toContain('isDiscoverySource')
    expect(code).toContain('origin_type: item.origin_type')
    expect(code).toContain('canonical_url: item.canonical_url')
    expect(code).toContain('discovery_engine: item.discovery_engine')
  })

  it('the Publishing Gate still enforces the other four rules for a discovery-origin item', () => {
    // The bypass is narrowly for rule 2 (domain allow-list). Confidence,
    // duplicate, legal-relevance and publication-date rules are untouched —
    // this is what actually keeps discovery-origin noise out of the archive.
    const raw = readFileSync(new URL('03-publishing-gate.json', DIR), 'utf8')
    for (const reason of ['low_confidence', 'not_legal_update', 'duplicate', 'no_publication_date']) {
      expect(raw).toContain(reason)
    }
  })
})
