import { describe, expect, it } from 'vitest'

import {
  foldDispatchFailures,
  httpStatusForManualRun,
  manualRunResponseSchema,
  replayManualRun,
  resolveManualRun,
  validateManualRunBody,
  type ManualRunCandidate,
} from '@/lib/ops/dispatch'

const NOW = new Date('2026-08-02T12:00:00.000Z')

describe('validateManualRunBody', () => {
  it('accepts every scope with its required companion field', () => {
    expect(validateManualRunBody({ scope: 'source', source_id: 'x' })).toEqual({ valid: true })
    expect(validateManualRunBody({ scope: 'country', country: 'SA' })).toEqual({ valid: true })
    expect(validateManualRunBody({ scope: 'url', url: 'https://x' })).toEqual({ valid: true })
    expect(validateManualRunBody({ scope: 'replay', dead_letter_id: 'x' })).toEqual({ valid: true })
    expect(validateManualRunBody({ scope: 'all' })).toEqual({ valid: true })
    expect(validateManualRunBody({ scope: 'drain' })).toEqual({ valid: true })
  })

  it('rejects a scope outside the known set', () => {
    expect(validateManualRunBody({ scope: 'bogus' })).toEqual({ valid: false, reason: 'invalid_scope' })
    expect(validateManualRunBody({})).toEqual({ valid: false, reason: 'invalid_scope' })
  })

  it('rejects a scope missing its required companion field', () => {
    expect(validateManualRunBody({ scope: 'source' })).toEqual({ valid: false, reason: 'missing_source_id' })
    expect(validateManualRunBody({ scope: 'country' })).toEqual({ valid: false, reason: 'missing_country' })
    expect(validateManualRunBody({ scope: 'url' })).toEqual({ valid: false, reason: 'missing_url' })
    expect(validateManualRunBody({ scope: 'replay' })).toEqual({
      valid: false,
      reason: 'missing_dead_letter_id',
    })
  })
})

describe('resolveManualRun — the 202 accepted response contract', () => {
  it('accepts a single unlocked source', () => {
    const candidates: ManualRunCandidate[] = [
      { sourceId: 'src-1', lock: { lock_owner: null, lock_expires_at: null } },
    ]
    const body = resolveManualRun({
      correlationId: 'c-1',
      requestedSourceId: 'src-1',
      requestedButMissing: false,
      candidates,
      force: false,
      now: NOW,
    })

    expect(body).toEqual({
      ok: true,
      status: 'accepted',
      correlation_id: 'c-1',
      source_id: 'src-1',
      accepted_at: NOW.toISOString(),
      accepted_sources: ['src-1'],
    })
    expect(manualRunResponseSchema.safeParse(body).success).toBe(true)
    expect(httpStatusForManualRun(body)).toBe(202)
  })

  it('rejects a scope naming a source that does not exist at all — 404', () => {
    const body = resolveManualRun({
      correlationId: 'c-2',
      requestedSourceId: 'missing-src',
      requestedButMissing: true,
      candidates: [],
      force: false,
      now: NOW,
    })
    expect(body.ok).toBe(false)
    expect(body.status).toBe('rejected')
    expect(body.reason).toBe('source_not_found')
    expect(httpStatusForManualRun(body)).toBe(404)
  })

  it('reports a scope that matched no eligible sources as skipped, not an error — 200', () => {
    const body = resolveManualRun({
      correlationId: 'c-3',
      requestedSourceId: null,
      requestedButMissing: false,
      candidates: [],
      force: false,
      now: NOW,
    })
    expect(body.ok).toBe(true)
    expect(body.status).toBe('skipped')
    expect(body.reason).toBe('no_matching_sources')
    expect(httpStatusForManualRun(body)).toBe(200)
  })

  it('skips a source whose lock has not expired — 409, distinct from "not found"', () => {
    const candidates: ManualRunCandidate[] = [
      {
        sourceId: 'src-locked',
        lock: { lock_owner: 'exec-1', lock_expires_at: new Date(NOW.getTime() + 60_000).toISOString() },
      },
    ]
    const body = resolveManualRun({
      correlationId: 'c-4',
      requestedSourceId: 'src-locked',
      requestedButMissing: false,
      candidates,
      force: false,
      now: NOW,
    })
    expect(body.ok).toBe(true)
    expect(body.status).toBe('skipped')
    expect(body.reason).toBe('already_running')
    expect(body.skipped_sources).toEqual([{ source_id: 'src-locked', reason: 'already_running' }])
    expect(httpStatusForManualRun(body)).toBe(409)
  })

  it('an EXPIRED lease does not block a manual run — the lock is a lease, not a flag', () => {
    const candidates: ManualRunCandidate[] = [
      {
        sourceId: 'src-1',
        lock: { lock_owner: 'exec-crashed', lock_expires_at: new Date(NOW.getTime() - 1000).toISOString() },
      },
    ]
    const body = resolveManualRun({
      correlationId: 'c-5',
      requestedSourceId: 'src-1',
      requestedButMissing: false,
      candidates,
      force: false,
      now: NOW,
    })
    expect(body.status).toBe('accepted')
  })

  it('force overrides an unexpired lock', () => {
    const candidates: ManualRunCandidate[] = [
      {
        sourceId: 'src-1',
        lock: { lock_owner: 'exec-1', lock_expires_at: new Date(NOW.getTime() + 60_000).toISOString() },
      },
    ]
    const body = resolveManualRun({
      correlationId: 'c-6',
      requestedSourceId: 'src-1',
      requestedButMissing: false,
      candidates,
      force: true,
      now: NOW,
    })
    expect(body.status).toBe('accepted')
  })

  it('a country/all batch accepts the unlocked sources and reports the locked ones', () => {
    const candidates: ManualRunCandidate[] = [
      { sourceId: 'a', lock: { lock_owner: null, lock_expires_at: null } },
      { sourceId: 'b', lock: { lock_owner: 'x', lock_expires_at: new Date(NOW.getTime() + 60_000).toISOString() } },
      { sourceId: 'c', lock: { lock_owner: null, lock_expires_at: null } },
    ]
    const body = resolveManualRun({
      correlationId: 'c-7',
      requestedSourceId: null,
      requestedButMissing: false,
      candidates,
      force: false,
      now: NOW,
    })
    expect(body.status).toBe('accepted')
    expect(body.accepted_sources).toEqual(['a', 'c'])
    expect(body.skipped_sources).toEqual([{ source_id: 'b', reason: 'already_running' }])
    // one bad/locked source in a batch must not turn the whole response into 409
    expect(httpStatusForManualRun(body)).toBe(202)
  })
})

describe('foldDispatchFailures — dispatch failures reported, not lost', () => {
  it('one failed dispatch in a batch is folded into skipped_sources, still 202', () => {
    const accepted = resolveManualRun({
      correlationId: 'c-8',
      requestedSourceId: null,
      requestedButMissing: false,
      candidates: [
        { sourceId: 'a', lock: { lock_owner: null, lock_expires_at: null } },
        { sourceId: 'b', lock: { lock_owner: null, lock_expires_at: null } },
      ],
      force: false,
      now: NOW,
    })

    const folded = foldDispatchFailures(accepted, ['b'])
    expect(folded.status).toBe('accepted')
    expect(folded.accepted_sources).toEqual(['a'])
    expect(folded.skipped_sources).toEqual([{ source_id: 'b', reason: 'dispatch_failed' }])
    expect(httpStatusForManualRun(folded)).toBe(202)
  })

  it('every accepted candidate failing to dispatch becomes a genuine failure — 500', () => {
    const accepted = resolveManualRun({
      correlationId: 'c-9',
      requestedSourceId: 'a',
      requestedButMissing: false,
      candidates: [{ sourceId: 'a', lock: { lock_owner: null, lock_expires_at: null } }],
      force: false,
      now: NOW,
    })

    const folded = foldDispatchFailures(accepted, ['a'])
    expect(folded.ok).toBe(false)
    expect(folded.status).toBe('failed')
    expect(folded.reason).toBe('dispatch_failed')
    expect(httpStatusForManualRun(folded)).toBe(500)
  })

  it('is a no-op when nothing failed to dispatch', () => {
    const accepted = resolveManualRun({
      correlationId: 'c-10',
      requestedSourceId: 'a',
      requestedButMissing: false,
      candidates: [{ sourceId: 'a', lock: { lock_owner: null, lock_expires_at: null } }],
      force: false,
      now: NOW,
    })
    expect(foldDispatchFailures(accepted, [])).toEqual(accepted)
  })
})

describe('replayManualRun — correlation_id idempotency', () => {
  it('a retried correlation_id is answered with the ORIGINAL acceptance, unchanged', () => {
    const stored = {
      correlation_id: 'c-11',
      source_id: 'src-1',
      accepted_at: '2026-08-02T11:00:00.000Z',
      accepted_sources: ['src-1'],
      skipped_sources: [],
    }
    const replay = replayManualRun(stored)

    expect(replay.status).toBe('accepted')
    expect(replay.correlation_id).toBe('c-11')
    // the defining property of a replay: the SAME timestamp as the original
    // acceptance, not a freshly computed one from the retry.
    expect(replay.accepted_at).toBe('2026-08-02T11:00:00.000Z')
    expect(replay.accepted_sources).toEqual(['src-1'])
    expect(manualRunResponseSchema.safeParse(replay).success).toBe(true)
    expect(httpStatusForManualRun(replay)).toBe(202)
  })

  it('never dispatches — replaying is a pure reshape of stored data, not a new resolution', () => {
    // Calling it twice with the same input produces byte-identical output;
    // nothing about it is time-dependent or has side effects.
    const stored = {
      correlation_id: 'c-12',
      source_id: null,
      accepted_at: '2026-08-02T11:00:00.000Z',
      accepted_sources: ['a', 'b'],
      skipped_sources: [{ source_id: 'c', reason: 'already_running' }],
    }
    expect(replayManualRun(stored)).toEqual(replayManualRun(stored))
  })
})

describe('httpStatusForManualRun — every branch answers deliberately', () => {
  it('maps every status/reason combination to a distinct, documented code', () => {
    expect(httpStatusForManualRun({ status: 'invalid_request' })).toBe(400)
    expect(httpStatusForManualRun({ status: 'rejected' })).toBe(404)
    expect(httpStatusForManualRun({ status: 'accepted' })).toBe(202)
    expect(httpStatusForManualRun({ status: 'skipped', reason: 'already_running' })).toBe(409)
    expect(httpStatusForManualRun({ status: 'skipped', reason: 'no_matching_sources' })).toBe(200)
    expect(httpStatusForManualRun({ status: 'failed' })).toBe(500)
  })
})

describe('manualRunResponseSchema', () => {
  it('validates the documented 202 contract', () => {
    const result = manualRunResponseSchema.safeParse({
      ok: true,
      status: 'accepted',
      correlation_id: '11111111-1111-1111-1111-111111111111',
      source_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      accepted_at: '2026-08-02T12:00:00.000Z',
    })
    expect(result.success).toBe(true)
  })

  it('rejects a response missing the required fields', () => {
    expect(manualRunResponseSchema.safeParse({ ok: true }).success).toBe(false)
    expect(manualRunResponseSchema.safeParse({ status: 'accepted' }).success).toBe(false)
  })

  it('rejects an unrecognised status — a contract drift, not a silently-accepted new state', () => {
    expect(
      manualRunResponseSchema.safeParse({
        ok: true,
        status: 'completed',
        correlation_id: 'x',
      }).success,
    ).toBe(false)
  })
})
