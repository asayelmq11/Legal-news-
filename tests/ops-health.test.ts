import { describe, expect, it } from 'vitest'

import { computeHealth, decideAlert, type HealthInput } from '@/lib/ops/health'
import {
  DEFAULT_LOCK_TTL_MINUTES,
  interpretLockResult,
  isLocked,
  lockValues,
} from '@/lib/ops/locks'

const NOW = new Date('2026-08-01T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString()

function input(overrides: Partial<HealthInput> = {}): HealthInput {
  return {
    active: true,
    configStatus: 'verified',
    consecutiveFailures: 0,
    lastCheckedAt: hoursAgo(1),
    lastSuccessAt: hoursAgo(1),
    lastItemFoundAt: hoursAgo(2),
    deadJobCount: 0,
    window: {
      runs: 10,
      fetchSuccesses: 10,
      extractionSuccesses: 10,
      aiAttempts: 20,
      aiSuccesses: 20,
      gateAttempts: 20,
      gateAccepted: 5,
      duplicates: 10,
      totalDurationMs: 20_000,
    },
    maxSilenceMinutes: null,
    defaultMaxSilenceMinutes: 1440,
    failureAlertThreshold: 5,
    now: NOW,
    ...overrides,
  }
}

describe('health scoring', () => {
  it('scores a fully working source at 100 and calls it healthy', () => {
    const r = computeHealth(input())
    expect(r.score).toBe(100)
    expect(r.classification).toBe('healthy')
  })

  it('DUPLICATES DO NOT reduce the score', () => {
    // 10 of 20 items were duplicates in the baseline above, and the score is
    // still 100. A source republishing something already archived is working.
    const heavy = computeHealth(
      input({ window: { ...input().window, duplicates: 20, gateAccepted: 0 } }),
    )
    expect(heavy.score).toBe(100)
    expect(heavy.classification).toBe('healthy')
  })

  it('GATE REJECTIONS DO NOT reduce the score', () => {
    // Everything fetched and classified fine; the gate simply judged none of it
    // publishable. That is an editorial outcome, not a broken integration.
    const r = computeHealth(input({ window: { ...input().window, gateAccepted: 0 } }))
    expect(r.score).toBe(100)
    expect(r.classification).toBe('healthy')
    expect(r.rates.gateAcceptanceRate).toBe(0)
  })

  it('AN EMPTY RUN DOES NOT reduce the score', () => {
    const r = computeHealth(
      input({
        lastItemFoundAt: null,
        window: { ...input().window, gateAttempts: 0, gateAccepted: 0, aiAttempts: 0, aiSuccesses: 0 },
      }),
    )
    expect(r.score).toBe(100)
    expect(r.classification).toBe('healthy')
    expect(r.checkedButNothingFound).toBe(true)
  })

  it('penalises consecutive failures heavily', () => {
    expect(computeHealth(input({ consecutiveFailures: 1 })).score).toBe(85)
    expect(computeHealth(input({ consecutiveFailures: 2 })).score).toBe(70)
    // capped so other signals still matter
    expect(computeHealth(input({ consecutiveFailures: 99 })).score).toBe(40)
  })

  it('penalises fetch failures', () => {
    const r = computeHealth(
      input({ window: { ...input().window, fetchSuccesses: 5, extractionSuccesses: 5 } }),
    )
    expect(r.score).toBeLessThan(100)
    expect(r.rates.fetchSuccessRate).toBe(0.5)
  })

  it('penalises extraction failure — a selector that stopped matching', () => {
    const r = computeHealth(input({ window: { ...input().window, extractionSuccesses: 0 } }))
    expect(r.score).toBe(80)
    expect(r.rates.extractionSuccessRate).toBe(0)
  })

  it('penalises AI failure', () => {
    const r = computeHealth(input({ window: { ...input().window, aiSuccesses: 10 } }))
    expect(r.score).toBeLessThan(100)
  })

  it('penalises open dead jobs', () => {
    expect(computeHealth(input({ deadJobCount: 2 })).score).toBe(90)
  })

  it('keeps the score inside 0..100', () => {
    const r = computeHealth(
      input({
        consecutiveFailures: 50,
        deadJobCount: 50,
        lastSuccessAt: hoursAgo(1000),
        window: { ...input().window, fetchSuccesses: 0, extractionSuccesses: 0, aiSuccesses: 0 },
      }),
    )
    expect(r.score).toBeGreaterThanOrEqual(0)
    expect(r.score).toBeLessThanOrEqual(100)
  })
})

describe('health classification', () => {
  it('reports a deactivated source as disabled, whatever its rates', () => {
    expect(computeHealth(input({ active: false, consecutiveFailures: 20 })).classification).toBe(
      'disabled',
    )
  })

  it('reports an unverified source as unverified', () => {
    expect(
      computeHealth(input({ configStatus: 'pending_verification' })).classification,
    ).toBe('unverified')
    expect(computeHealth(input({ configStatus: 'blocked_by_access' })).classification).toBe(
      'unverified',
    )
  })

  it('reports a source never checked as never_run', () => {
    const r = computeHealth(input({ lastCheckedAt: null, lastSuccessAt: null }))
    expect(r.classification).toBe('never_run')
    expect(r.neverChecked).toBe(true)
  })

  it('degrades on the first failure', () => {
    expect(computeHealth(input({ consecutiveFailures: 1 })).classification).toBe('degraded')
  })

  it('fails at the configured threshold', () => {
    expect(
      computeHealth(input({ consecutiveFailures: 5, failureAlertThreshold: 5 })).classification,
    ).toBe('failing')
  })

  it('respects a lower configured threshold', () => {
    expect(
      computeHealth(input({ consecutiveFailures: 2, failureAlertThreshold: 2 })).classification,
    ).toBe('failing')
  })
})

describe('staleness', () => {
  it('is measured from the last successful CHECK, not the last item', () => {
    // Checked successfully an hour ago, but nothing published for a month.
    // That is a quiet authority, not a broken source.
    const r = computeHealth(input({ lastSuccessAt: hoursAgo(1), lastItemFoundAt: hoursAgo(720) }))
    expect(r.stale).toBe(false)
    expect(r.classification).toBe('healthy')
  })

  it('marks a source stale once its silence window elapses', () => {
    const r = computeHealth(input({ lastSuccessAt: hoursAgo(48) }))
    expect(r.stale).toBe(true)
    expect(r.classification).toBe('stale')
  })

  it('uses a PER-SOURCE window — a weekly gazette is not a daily feed', () => {
    // 48h since the last successful check. Stale for a daily source…
    expect(computeHealth(input({ lastSuccessAt: hoursAgo(48), maxSilenceMinutes: 1440 })).stale).toBe(
      true,
    )
    // …but perfectly normal for a weekly one.
    expect(
      computeHealth(input({ lastSuccessAt: hoursAgo(48), maxSilenceMinutes: 10_080 })).stale,
    ).toBe(false)
    // and for a monthly publication
    expect(
      computeHealth(input({ lastSuccessAt: hoursAgo(500), maxSilenceMinutes: 44_640 })).stale,
    ).toBe(false)
  })

  it('never calls a source stale before it has ever succeeded', () => {
    const r = computeHealth(input({ lastSuccessAt: null, lastCheckedAt: hoursAgo(100) }))
    expect(r.stale).toBe(false)
  })

  it('distinguishes never-checked from checked-but-empty', () => {
    const never = computeHealth(input({ lastCheckedAt: null, lastSuccessAt: null }))
    expect(never.neverChecked).toBe(true)
    expect(never.checkedButNothingFound).toBe(false)

    const empty = computeHealth(input({ lastItemFoundAt: null }))
    expect(empty.neverChecked).toBe(false)
    expect(empty.checkedButNothingFound).toBe(true)
  })
})

describe('alert transitions and cooldown', () => {
  const base = { cooldownMinutes: 180, lastAlertKind: null, lastAlertAt: null, now: NOW }

  it('emits on entering failing', () => {
    const d = decideAlert({ ...base, previous: 'healthy', current: 'failing' })
    expect(d).toEqual({ emit: true, kind: 'source.failing' })
  })

  it('emits on entering degraded', () => {
    const d = decideAlert({ ...base, previous: 'healthy', current: 'degraded' })
    expect(d).toEqual({ emit: true, kind: 'source.degraded' })
  })

  it('does NOT emit degraded when improving from failing', () => {
    // Going failing → degraded is progress; paging about it is noise.
    const d = decideAlert({ ...base, previous: 'failing', current: 'degraded' })
    expect(d.emit).toBe(false)
  })

  it('emits recovered only from degraded or failing', () => {
    expect(decideAlert({ ...base, previous: 'degraded', current: 'healthy' })).toEqual({
      emit: true,
      kind: 'source.recovered',
    })
    expect(decideAlert({ ...base, previous: 'failing', current: 'healthy' })).toEqual({
      emit: true,
      kind: 'source.recovered',
    })
  })

  it('does NOT emit recovered from never_run, disabled or unverified', () => {
    // None of these are states one recovers from; a "recovered" alert for a
    // source that was merely switched on would be meaningless.
    for (const previous of ['never_run', 'disabled', 'unverified'] as const) {
      expect(decideAlert({ ...base, previous, current: 'healthy' }).emit).toBe(false)
    }
  })

  it('stays silent when nothing changed', () => {
    const d = decideAlert({ ...base, previous: 'failing', current: 'failing' })
    expect(d).toEqual({ emit: false, reason: 'no_transition' })
  })

  it('suppresses a repeat of the same alert inside the cooldown', () => {
    const d = decideAlert({
      previous: 'healthy',
      current: 'failing',
      lastAlertKind: 'source.failing',
      lastAlertAt: new Date(NOW.getTime() - 30 * 60_000).toISOString(),
      cooldownMinutes: 180,
      now: NOW,
    })
    expect(d).toEqual({ emit: false, reason: 'cooldown' })
  })

  it('emits again once the cooldown elapses', () => {
    const d = decideAlert({
      previous: 'healthy',
      current: 'failing',
      lastAlertKind: 'source.failing',
      lastAlertAt: new Date(NOW.getTime() - 240 * 60_000).toISOString(),
      cooldownMinutes: 180,
      now: NOW,
    })
    expect(d.emit).toBe(true)
  })

  it('does not let a different alert kind be suppressed by an unrelated one', () => {
    const d = decideAlert({
      previous: 'healthy',
      current: 'failing',
      lastAlertKind: 'source.degraded',
      lastAlertAt: new Date(NOW.getTime() - 10 * 60_000).toISOString(),
      cooldownMinutes: 180,
      now: NOW,
    })
    expect(d.emit).toBe(true)
  })

  it('NEVER suppresses recovery — silence would leave a source looking broken', () => {
    const d = decideAlert({
      previous: 'failing',
      current: 'healthy',
      lastAlertKind: 'source.recovered',
      lastAlertAt: new Date(NOW.getTime() - 1 * 60_000).toISOString(),
      cooldownMinutes: 180,
      now: NOW,
    })
    expect(d).toEqual({ emit: true, kind: 'source.recovered' })
  })
})

describe('source locking', () => {
  it('reports an unlocked source as free', () => {
    expect(isLocked(null, NOW)).toBe(false)
    expect(isLocked({ lock_owner: null, lock_expires_at: null }, NOW)).toBe(false)
  })

  it('reports a live lease as held', () => {
    const row = {
      lock_owner: 'exec-1',
      lock_expires_at: new Date(NOW.getTime() + 60_000).toISOString(),
    }
    expect(isLocked(row, NOW)).toBe(true)
  })

  it('treats an EXPIRED lease as free — a crashed run must not wedge a source', () => {
    const row = {
      lock_owner: 'exec-crashed',
      lock_expires_at: new Date(NOW.getTime() - 60_000).toISOString(),
    }
    expect(isLocked(row, NOW)).toBe(false)
  })

  it('builds a lease that expires after the TTL', () => {
    const v = lockValues({ owner: 'exec-2', now: NOW })
    expect(new Date(v.expiresAt).getTime() - NOW.getTime()).toBe(
      DEFAULT_LOCK_TTL_MINUTES * 60_000,
    )
  })

  it('honours a custom TTL', () => {
    const v = lockValues({ owner: 'exec-3', ttlMinutes: 5, now: NOW })
    expect(new Date(v.expiresAt).getTime() - NOW.getTime()).toBe(5 * 60_000)
  })

  it('treats a one-row update as acquisition', () => {
    const r = interpretLockResult({ updatedRows: 1, owner: 'exec-4', expiresAt: 'x' })
    expect(r.acquired).toBe(true)
  })

  it('treats a zero-row update as already_running, not an error', () => {
    const r = interpretLockResult({
      updatedRows: 0,
      owner: 'exec-5',
      expiresAt: 'x',
      current: { lock_owner: 'exec-1', lock_expires_at: 'y' },
    })
    expect(r.acquired).toBe(false)
    if (!r.acquired) {
      expect(r.reason).toBe('already_running')
      expect(r.heldBy).toBe('exec-1')
    }
  })
})
