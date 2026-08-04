import { describe, expect, it } from 'vitest'

import { deriveSourceStatus, SOURCE_STATUS_META } from '@/lib/sources/status'

describe('source status tallying feeds the dashboard counts', () => {
  const sources = [
    { active: true, config_status: 'verified' as const },
    { active: true, config_status: 'verified' as const },
    { active: false, config_status: 'verified' as const },
    { active: false, config_status: 'pending_verification' as const },
    { active: false, config_status: 'pending_verification' as const },
    { active: false, config_status: 'blocked_by_access' as const },
    { active: false, config_status: 'requires_subscription' as const },
  ]

  function tally() {
    const counts = new Map<string, number>()
    for (const s of sources) {
      const status = deriveSourceStatus(s)
      counts.set(status, (counts.get(status) ?? 0) + 1)
    }
    return counts
  }

  it('counts each of the five distinct states the dashboard reports', () => {
    const counts = tally()
    expect(counts.get('active')).toBe(2)
    expect(counts.get('disabled')).toBe(1)
    expect(counts.get('pending_verification')).toBe(2)
    expect(counts.get('blocked_by_access')).toBe(1)
    expect(counts.get('requires_subscription')).toBe(1)
  })

  it('accounts for every source exactly once', () => {
    const total = [...tally().values()].reduce((a, b) => a + b, 0)
    expect(total).toBe(sources.length)
  })

  it('flags exactly the states that need human action', () => {
    const needing = [...tally().keys()].filter(
      (k) => SOURCE_STATUS_META[k as keyof typeof SOURCE_STATUS_META].needsAction,
    )
    expect(needing.sort()).toEqual([
      'blocked_by_access',
      'pending_verification',
      'requires_subscription',
    ])
  })

  it('reports only active sources as live', () => {
    const live = [...tally().entries()]
      .filter(([k]) => SOURCE_STATUS_META[k as keyof typeof SOURCE_STATUS_META].isLive)
      .map(([, v]) => v)
    expect(live).toEqual([2])
  })
})

/* -------------------------------------------------------------------------- */
/* Role separation                                                             */
/* -------------------------------------------------------------------------- */

describe('dashboard query shape', () => {
  it('the legal overview select list contains no confidence or ai_model column', async () => {
    // Guard against a future edit widening the viewer projection.
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(
      new URL('../lib/queries/dashboard.ts', import.meta.url),
      'utf8',
    )
    const legalFn = src.slice(
      src.indexOf('export async function getLegalOverview'),
      src.indexOf('export async function getRecentUpdates'),
    )
    expect(legalFn).not.toContain('confidence')
    expect(legalFn).not.toContain('ai_model')
    expect(legalFn).not.toContain('content_hash')
    expect(legalFn).not.toContain('raw_excerpt')
  })

  it('never selects whole archive rows for aggregation', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(
      new URL('../lib/queries/dashboard.ts', import.meta.url),
      'utf8',
    )
    const legalFn = src.slice(
      src.indexOf('export async function getLegalOverview'),
      src.indexOf('export async function getRecentUpdates'),
    )
    // A bare select('*') on legal_updates would pull the archive into memory.
    expect(legalFn).not.toContain("select('*'")
    // Counts must be head-only so no row payload is transferred.
    expect(legalFn).toContain('head: true')
  })
})
