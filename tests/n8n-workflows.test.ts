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
  it('ships both M8 workflows', () => {
    expect(files).toContain('01-source-scheduler.json')
    expect(files).toContain('02-source-ingestion.json')
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

  it('every HTTP fetch retries on transient failure', () => {
    const raw = readFileSync(new URL('02-source-ingestion.json', DIR), 'utf8')
    const wf = JSON.parse(raw) as { nodes: Array<Record<string, unknown>> }
    const http = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest')
    expect(http.length).toBe(4)
    for (const node of http) {
      expect(node.retryOnFail, `${String(node.name)} must retry`).toBe(true)
      expect(node.onError, `${String(node.name)} must isolate its failure`).toBe(
        'continueErrorOutput',
      )
    }
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
