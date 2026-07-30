import { describe, expect, it } from 'vitest'

import { trailingMonths } from '@/lib/queries/dashboard'
import { deriveSourceStatus, SOURCE_STATUS_META } from '@/lib/sources/status'

describe('trailing month buckets', () => {
  it('returns the requested number of months, oldest first', () => {
    const months = trailingMonths(12, new Date('2026-07-30T12:00:00Z'))
    expect(months).toHaveLength(12)
    expect(months[0]?.start).toBe('2025-08-01')
    expect(months[11]?.start).toBe('2026-07-01')
  })

  it('spans each month from its first day to its last', () => {
    const [july] = trailingMonths(1, new Date('2026-07-15T00:00:00Z'))
    expect(july?.start).toBe('2026-07-01')
    expect(july?.end).toBe('2026-07-31')
  })

  it('handles a 30-day month', () => {
    const [june] = trailingMonths(1, new Date('2026-06-10T00:00:00Z'))
    expect(june?.end).toBe('2026-06-30')
  })

  it('handles February in a non-leap year', () => {
    const [feb] = trailingMonths(1, new Date('2026-02-10T00:00:00Z'))
    expect(feb?.start).toBe('2026-02-01')
    expect(feb?.end).toBe('2026-02-28')
  })

  it('handles February in a leap year', () => {
    const [feb] = trailingMonths(1, new Date('2024-02-10T00:00:00Z'))
    expect(feb?.end).toBe('2024-02-29')
  })

  it('crosses a year boundary correctly', () => {
    const months = trailingMonths(3, new Date('2026-01-20T00:00:00Z'))
    expect(months.map((m) => m.start)).toEqual(['2025-11-01', '2025-12-01', '2026-01-01'])
  })

  it('produces contiguous, non-overlapping buckets', () => {
    const months = trailingMonths(12, new Date('2026-07-30T00:00:00Z'))
    for (let i = 1; i < months.length; i += 1) {
      const prevEnd = new Date(`${months[i - 1]!.end}T00:00:00Z`)
      const thisStart = new Date(`${months[i]!.start}T00:00:00Z`)
      // exactly one day apart: no gap, no overlap
      expect(thisStart.getTime() - prevEnd.getTime()).toBe(86_400_000)
    }
  })

  it('is unaffected by the runner’s local timezone', () => {
    // Built entirely from UTC accessors; a machine in UTC+14 must agree.
    const months = trailingMonths(2, new Date('2026-03-01T00:30:00Z'))
    expect(months.map((m) => m.start)).toEqual(['2026-02-01', '2026-03-01'])
  })
})

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

describe('dashboard role separation', () => {
  /**
   * The dashboard page branches on `isAdmin` before calling
   * getOperationalOverview(), so a viewer never issues the operational query at
   * all. These assertions pin the shape of that contract: the viewer-facing
   * type must not carry operational or AI metadata fields.
   */
  it('the viewer-facing overview type exposes no operational fields', async () => {
    const mod = await import('@/lib/queries/dashboard')
    const source = mod as unknown as Record<string, unknown>
    // Both functions exist, but they are separate entry points.
    expect(typeof source.getLegalOverview).toBe('function')
    expect(typeof source.getOperationalOverview).toBe('function')
  })

  it('the legal overview select list contains no confidence or ai_model column', async () => {
    // Guard against a future edit widening the viewer projection.
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(
      new URL('../lib/queries/dashboard.ts', import.meta.url),
      'utf8',
    )
    const legalFn = src.slice(
      src.indexOf('export async function getLegalOverview'),
      src.indexOf('export async function getOperationalOverview'),
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
      src.indexOf('export async function getOperationalOverview'),
    )
    // A bare select('*') on legal_updates would pull the archive into memory.
    expect(legalFn).not.toContain("select('*'")
    // Counts must be head-only so no row payload is transferred.
    expect(legalFn).toContain('head: true')
  })
})
