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
})
