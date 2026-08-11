import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

/**
 * Behavioural tests for the API lane's URL construction (parser_config.url).
 *
 * Unlike the rest of tests/n8n-workflows.test.ts, these actually EXECUTE the
 * jsCode shipped in the workflow JSON — the single source of truth — against
 * crafted fixtures, chaining "API → RawItem" straight into "Normalise
 * RawItem" exactly as the real workflow wires them. That chain is what
 * proves a constructed URL is accepted or rejected, without needing a live
 * network call for every case: malformed/empty results are already rejected
 * as no_url, and results pointing at a domain the source doesn't own are
 * already rejected as domain_mismatch — both by Normalise RawItem's existing,
 * unit-tested logic, unchanged by this feature.
 */

const WORKFLOW_URL = new URL('../n8n/workflows/02-source-ingestion.json', import.meta.url)

function loadNodeCode(name: string): string {
  const wf = JSON.parse(readFileSync(WORKFLOW_URL, 'utf8')) as {
    nodes: Array<{ name: string; parameters: { jsCode?: string } }>
  }
  const node = wf.nodes.find((n) => n.name === name)
  if (!node?.parameters.jsCode) throw new Error(`node not found: ${name}`)
  return node.parameters.jsCode
}

interface Item {
  json: Record<string, unknown>
}

/** Normalise RawItem's "empty result" shape — see its own `__empty: true` sentinel. */
interface EmptyResult {
  __empty: true
  rejected: { no_url: number; no_title: number; domain_mismatch: number; out_of_window: number }
}

function rejectedCounts(item: Item): EmptyResult {
  return item.json as unknown as EmptyResult
}

function runCodeNode(code: string, refs: Record<string, Item>, inputItems: Item[]): Item[] {
  const sandbox: Record<string, unknown> = {
    console,
    $input: {
      first: () => inputItems[0],
      all: () => inputItems,
    },
    $: (name: string) => {
      const item = refs[name]
      if (!item) throw new Error(`no mock registered for $('${name}')`)
      return { first: () => item }
    },
  }
  vm.createContext(sandbox)
  const result = vm.runInContext(`(function () {\n${code}\n})()`, sandbox)
  return result as Item[]
}

const BASE_SOURCE = {
  id: 'test-source-id',
  base_url: 'https://example.gov.sa',
  allowed_domains: ['example.gov.sa'],
  ingestion_mode: 'official',
}

/** Runs the API lane, then feeds its output through Normalise RawItem, exactly as the real workflow does. */
function ingest(parser_config: Record<string, unknown>, payload: unknown) {
  const source = { ...BASE_SOURCE, parser_config }
  const apiCode = loadNodeCode('API → RawItem')
  const rawItems = runCodeNode(
    apiCode,
    { 'Called by scheduler': { json: { source } } },
    [{ json: payload as Record<string, unknown> }],
  )

  const normaliseCode = loadNodeCode('Normalise RawItem')
  const normalised = runCodeNode(
    normaliseCode,
    { 'Called by scheduler': { json: { source, window_from: null } } },
    rawItems,
  )

  return { rawItems, normalised }
}

describe('API lane URL construction (parser_config.url)', () => {
  it('direct absolute URL field — backward compatible', () => {
    const { rawItems, normalised } = ingest(
      { url: 'link', title: 'title', date: 'date' },
      { link: 'https://example.gov.sa/laws/123', title: 'Law 123', date: '2026-01-01' },
    )
    expect(rawItems[0]!.json.source_url).toBe('https://example.gov.sa/laws/123')
    expect(normalised).toHaveLength(1)
    expect(normalised[0]!.json.source_url).toBe('https://example.gov.sa/laws/123')
  })

  it('relative URL + base_url', () => {
    const { rawItems, normalised } = ingest(
      { url: 'path', title: 'title', date: 'date' },
      { path: '/laws/456', title: 'Law 456', date: '2026-01-01' },
    )
    expect(rawItems[0]!.json.source_url).toBe('https://example.gov.sa/laws/456')
    expect(normalised).toHaveLength(1)
  })

  it('URL built from more than one JSON field via a template', () => {
    const { rawItems, normalised } = ingest(
      {
        url: { template: '/regulations/{category}/{id}', fields: { category: 'cat.slug', id: 'id' } },
        title: 'title',
        date: 'date',
      },
      { id: '789', cat: { slug: 'circulars' }, title: 'Circular 789', date: '2026-01-01' },
    )
    expect(rawItems[0]!.json.source_url).toBe('https://example.gov.sa/regulations/circulars/789')
    expect(normalised).toHaveLength(1)
  })

  it('URL field built from a mapped value (numeric/enum field translated to a URL segment)', () => {
    // Mirrors a real shape: an API returns a numeric content-type code that
    // has to become a specific string in the file URL — e.g. Oman FSA's
    // Legislation Encyclopedia, where Type:2 must become "Regulation".
    const { rawItems, normalised } = ingest(
      {
        url: {
          template: '/files/{id}?type={kind}',
          fields: { id: 'Id', kind: { from: 'Type', map: { '1': 'Law', '2': 'Regulation', '3': 'Decision' } } },
        },
        title: 'HeaderEn',
        date: 'IssueDate',
      },
      { Id: 75, Type: 2, HeaderEn: 'Regulation for X', IssueDate: '2023-09-21T00:00:00' },
    )
    expect(rawItems[0]!.json.source_url).toBe('https://example.gov.sa/files/75?type=Regulation')
    expect(normalised).toHaveLength(1)
  })

  it('a mapped value with no matching map entry resolves to empty, never a guessed URL segment', () => {
    const { rawItems, normalised } = ingest(
      {
        url: {
          template: '/files/{id}?type={kind}',
          fields: { id: 'Id', kind: { from: 'Type', map: { '1': 'Law', '2': 'Regulation' } } },
        },
        title: 'HeaderEn',
        date: 'IssueDate',
      },
      { Id: 75, Type: 4, HeaderEn: 'Circular X', IssueDate: '2023-09-21T00:00:00' }, // Type 4 has no map entry
    )
    expect(rawItems[0]!.json.source_url).toBe('')
    expect(rejectedCounts(normalised[0]!).__empty).toBe(true)
  })

  it('nested JSON path (dot-path into a nested object) — plain string form', () => {
    const { rawItems, normalised } = ingest(
      { url: 'links.self.href', title: 'title', date: 'date' },
      { links: { self: { href: '/laws/999' } }, title: 'Law 999', date: '2026-01-01' },
    )
    expect(rawItems[0]!.json.source_url).toBe('https://example.gov.sa/laws/999')
    expect(normalised).toHaveLength(1)
  })

  it('missing field in a template resolves to empty, never a guessed link', () => {
    const { rawItems, normalised } = ingest(
      {
        url: { template: '/regulations/{category}/{id}', fields: { category: 'cat.slug', id: 'id' } },
        title: 'title',
        date: 'date',
      },
      { id: '789', title: 'Circular 789', date: '2026-01-01' }, // cat missing entirely
    )
    expect(rawItems[0]!.json.source_url).toBe('')
    expect(normalised).toEqual([{ json: expect.objectContaining({ __empty: true }) }])
    expect(rejectedCounts(normalised[0]!).rejected.no_url).toBe(1)
  })

  it('malformed template config (no fields object) is rejected, not guessed', () => {
    const { rawItems, normalised } = ingest(
      { url: { template: '/regulations/{id}', fields: {} }, title: 'title', date: 'date' },
      { id: '789', title: 'Circular 789', date: '2026-01-01' },
    )
    expect(rawItems[0]!.json.source_url).toBe('')
    expect(rejectedCounts(normalised[0]!).__empty).toBe(true)
  })

  it('untrusted domain — string form resolving to a foreign absolute URL is rejected downstream', () => {
    const { rawItems, normalised } = ingest(
      { url: 'link', title: 'title', date: 'date' },
      { link: 'https://evil-example.com/phish', title: 'Fake law', date: '2026-01-01' },
    )
    expect(rawItems[0]!.json.source_url).toBe('https://evil-example.com/phish')
    expect(normalised).toEqual([{ json: expect.objectContaining({ __empty: true }) }])
    expect(rejectedCounts(normalised[0]!).rejected.domain_mismatch).toBe(1)
  })

  it('untrusted domain — template field resolving to a foreign absolute URL is rejected downstream', () => {
    const { rawItems, normalised } = ingest(
      { url: { template: '{link}', fields: { link: 'link' } }, title: 'title', date: 'date' },
      { link: 'https://evil-example.com/phish', title: 'Fake law', date: '2026-01-01' },
    )
    expect(rawItems[0]!.json.source_url).toBe('https://evil-example.com/phish')
    expect(rejectedCounts(normalised[0]!).rejected.domain_mismatch).toBe(1)
  })

  it('backward compatibility: existing single-field API sources are unaffected', () => {
    // Mirrors a real shape already in the source registry: a flat JSON array
    // of items with a direct absolute "url" field, no items_path needed.
    const cfg = { url: 'url', title: 'headline', body: 'summary', date: 'published_at' }
    const { rawItems, normalised } = ingest(cfg, [
      { url: 'https://example.gov.sa/news/1', headline: 'A', summary: 'a', published_at: '2026-02-01' },
      { url: 'https://example.gov.sa/news/2', headline: 'B', summary: 'b', published_at: '2026-02-02' },
    ])
    expect(rawItems.map((i) => i.json.source_url)).toEqual([
      'https://example.gov.sa/news/1',
      'https://example.gov.sa/news/2',
    ])
    expect(normalised).toHaveLength(2)
  })
})
