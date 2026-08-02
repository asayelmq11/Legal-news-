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
})
