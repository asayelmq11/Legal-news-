import { describe, expect, it } from 'vitest'

import {
  backoffMs,
  buildRetryMetadata,
  codeForHttpStatus,
  decideRetry,
  DEFAULT_BACKOFF_MINUTES,
  isKnownCode,
  isPermanent,
  isRetryable,
  MAX_ATTEMPTS,
  PERMANENT_CODES,
  RETRYABLE_CODES,
} from '@/lib/ops/retry'

describe('error taxonomy', () => {
  it('retries transient network and upstream failures', () => {
    for (const code of [
      'network_timeout',
      'dns_failure',
      'connection_reset',
      'http_408',
      'http_429',
      'http_500',
      'http_502',
      'http_503',
      'http_504',
      'db_connection_failure',
      'ai_provider_unavailable',
      'storage_unavailable',
    ]) {
      expect(isRetryable(code), `${code} should retry`).toBe(true)
    }
  })

  it('never retries a permanent failure', () => {
    for (const code of [
      'invalid_source_config',
      'unsupported_document_type',
      'selector_mismatch',
      'invalid_webhook_signature',
      'schema_validation_failure',
      'no_publication_date',
      'not_legal_update',
      'low_confidence',
      'inactive_source',
      'unverified_source',
      'duplicate',
      'http_400',
      'http_401',
      'http_403',
      'http_404',
    ]) {
      expect(isRetryable(code), `${code} must not retry`).toBe(false)
      expect(isPermanent(code)).toBe(true)
    }
  })

  it('treats an unknown code as permanent, not retryable', () => {
    // Retrying the unknown risks a loop against something nothing will clear.
    // A dead letter is visible; a retry loop is not.
    expect(isRetryable('something_new')).toBe(false)
    expect(isPermanent('something_new')).toBe(true)
    expect(isKnownCode('something_new')).toBe(false)
  })

  it('treats a missing code as permanent', () => {
    expect(isRetryable(null)).toBe(false)
    expect(isRetryable(undefined)).toBe(false)
    expect(isRetryable('')).toBe(false)
  })

  it('has no code in both lists', () => {
    const overlap = RETRYABLE_CODES.filter((c) => (PERMANENT_CODES as readonly string[]).includes(c))
    expect(overlap).toEqual([])
  })
})

describe('HTTP status mapping', () => {
  it('maps retryable statuses', () => {
    expect(isRetryable(codeForHttpStatus(408))).toBe(true)
    expect(isRetryable(codeForHttpStatus(429))).toBe(true)
    for (const s of [500, 502, 503, 504]) {
      expect(isRetryable(codeForHttpStatus(s)), `${s} should retry`).toBe(true)
    }
  })

  it('maps permanent client errors', () => {
    for (const s of [400, 401, 403, 404, 410]) {
      expect(isRetryable(codeForHttpStatus(s)), `${s} must not retry`).toBe(false)
    }
  })

  it('folds unusual 5xx into a retryable code', () => {
    expect(isRetryable(codeForHttpStatus(507))).toBe(true)
  })

  it('reports success as ok', () => {
    expect(codeForHttpStatus(200)).toBe('ok')
  })
})

describe('exponential backoff with jitter', () => {
  it('grows across attempts', () => {
    const noJitter = { jitterRatio: 0, random: () => 0.5 }
    const delays = [1, 2, 3, 4, 5].map((n) => backoffMs(n, noJitter))
    for (let i = 1; i < delays.length; i += 1) {
      expect(delays[i]!).toBeGreaterThan(delays[i - 1]!)
    }
  })

  it('matches the configured schedule exactly when jitter is off', () => {
    const noJitter = { jitterRatio: 0, random: () => 0.5 }
    DEFAULT_BACKOFF_MINUTES.forEach((minutes, i) => {
      expect(backoffMs(i + 1, noJitter)).toBe(minutes * 60_000)
    })
  })

  it('stays within the jitter band at both extremes', () => {
    const base = 5 * 60_000
    const low = backoffMs(1, { jitterRatio: 0.2, random: () => 0 })
    const high = backoffMs(1, { jitterRatio: 0.2, random: () => 1 })
    expect(low).toBe(Math.round(base * 0.8))
    expect(high).toBe(Math.round(base * 1.2))
  })

  it('actually varies between calls', () => {
    // Without jitter, sources that failed together retry in lockstep forever.
    const seen = new Set(Array.from({ length: 50 }, () => backoffMs(2)))
    expect(seen.size).toBeGreaterThan(1)
  })

  it('clamps below attempt 1 and above the schedule length', () => {
    const noJitter = { jitterRatio: 0, random: () => 0.5 }
    expect(backoffMs(0, noJitter)).toBe(DEFAULT_BACKOFF_MINUTES[0]! * 60_000)
    expect(backoffMs(99, noJitter)).toBe(
      DEFAULT_BACKOFF_MINUTES[DEFAULT_BACKOFF_MINUTES.length - 1]! * 60_000,
    )
  })

  it('never returns a non-positive delay', () => {
    expect(backoffMs(1, { jitterRatio: 5, random: () => 0 })).toBeGreaterThan(0)
  })

  it('honours a custom schedule', () => {
    const noJitter = { schedule: [1, 2], jitterRatio: 0, random: () => 0.5 }
    expect(backoffMs(1, noJitter)).toBe(60_000)
    expect(backoffMs(2, noJitter)).toBe(120_000)
  })
})

describe('retry decision', () => {
  const now = new Date('2026-08-01T12:00:00Z')
  const noJitter = { jitterRatio: 0, random: () => 0.5 }

  it('schedules the next attempt for a transient failure', () => {
    const d = decideRetry({ errorCode: 'http_503', attemptNumber: 1, now, backoff: noJitter })
    expect(d.action).toBe('retry')
    if (d.action === 'retry') {
      expect(d.attemptNumber).toBe(2)
      expect(new Date(d.nextRetryAt).getTime()).toBeGreaterThan(now.getTime())
    }
  })

  it('kills a permanent failure on the first attempt', () => {
    const d = decideRetry({ errorCode: 'http_404', attemptNumber: 1, now })
    expect(d.action).toBe('dead')
    if (d.action === 'dead') expect(d.reason).toBe('permanent_error')
  })

  it('never retries a duplicate — it is not a failure', () => {
    const d = decideRetry({ errorCode: 'duplicate', attemptNumber: 1, now })
    expect(d.action).toBe('dead')
    if (d.action === 'dead') expect(d.reason).toBe('permanent_error')
  })

  it('never retries a gate rejection on the merits', () => {
    for (const code of ['not_legal_update', 'low_confidence', 'no_publication_date']) {
      const d = decideRetry({ errorCode: code, attemptNumber: 1, now })
      expect(d.action, `${code} must not retry`).toBe('dead')
    }
  })

  it('dies once attempts are exhausted', () => {
    const d = decideRetry({
      errorCode: 'http_503',
      attemptNumber: MAX_ATTEMPTS,
      now,
      backoff: noJitter,
    })
    expect(d.action).toBe('dead')
    if (d.action === 'dead') expect(d.reason).toBe('max_attempts_exhausted')
  })

  it('retries right up to the boundary, then stops', () => {
    const last = decideRetry({
      errorCode: 'http_503',
      attemptNumber: MAX_ATTEMPTS - 1,
      now,
      backoff: noJitter,
    })
    expect(last.action).toBe('retry')

    const past = decideRetry({
      errorCode: 'http_503',
      attemptNumber: MAX_ATTEMPTS,
      now,
      backoff: noJitter,
    })
    expect(past.action).toBe('dead')
  })

  it('honours a custom max attempts', () => {
    const d = decideRetry({ errorCode: 'http_503', attemptNumber: 2, maxAttempts: 2, now })
    expect(d.action).toBe('dead')
  })

  it('is deterministic for the same input, so a repeat is idempotent', () => {
    const a = decideRetry({ errorCode: 'http_404', attemptNumber: 1, now })
    const b = decideRetry({ errorCode: 'http_404', attemptNumber: 1, now })
    expect(a).toEqual(b)
  })
})

describe('retry metadata', () => {
  const now = new Date('2026-08-01T12:00:00Z')

  it('carries every required field', () => {
    const meta = buildRetryMetadata({
      attemptNumber: 2,
      errorCode: 'http_503',
      errorMessage: 'upstream unavailable',
      sourceId: '11111111-1111-4111-8111-111111111111',
      itemUrl: 'https://x.gov.sa/1',
      contentHash: 'a'.repeat(64),
      executionId: 'exec-9',
      nextRetryAt: '2026-08-01T12:15:00Z',
      firstAttemptAt: '2026-08-01T11:00:00Z',
      now,
    })

    for (const key of [
      'attempt_number',
      'max_attempts',
      'first_attempt_at',
      'last_attempt_at',
      'next_retry_at',
      'last_error_code',
      'last_error_message',
      'retryable',
      'workflow_execution_id',
      'source_id',
      'item_url',
      'content_hash',
    ]) {
      expect(meta, `missing ${key}`).toHaveProperty(key)
    }
    expect(meta.retryable).toBe(true)
    expect(meta.first_attempt_at).toBe('2026-08-01T11:00:00Z')
  })

  it('marks a permanent error as not retryable', () => {
    const meta = buildRetryMetadata({
      attemptNumber: 1,
      errorCode: 'selector_mismatch',
      sourceId: '11111111-1111-4111-8111-111111111111',
      now,
    })
    expect(meta.retryable).toBe(false)
    expect(meta.next_retry_at).toBeNull()
  })

  it('truncates a runaway error message', () => {
    const meta = buildRetryMetadata({
      attemptNumber: 1,
      errorCode: 'http_500',
      errorMessage: 'x'.repeat(5000),
      sourceId: '11111111-1111-4111-8111-111111111111',
      now,
    })
    expect(meta.last_error_message!.length).toBeLessThanOrEqual(1000)
  })

  it('defaults first_attempt_at to now on the first attempt', () => {
    const meta = buildRetryMetadata({
      attemptNumber: 1,
      errorCode: 'http_500',
      sourceId: '11111111-1111-4111-8111-111111111111',
      now,
    })
    expect(meta.first_attempt_at).toBe(now.toISOString())
  })
})
