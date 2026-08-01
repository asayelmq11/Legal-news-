/**
 * Retry policy — error taxonomy and backoff.
 *
 * Pure functions, so the policy is unit-testable. The n8n Code nodes mirror
 * this logic; `tests/ops-retry.test.ts` is the specification both follow.
 *
 * The central rule: retry only what a retry could plausibly fix. A 404 will be
 * a 404 in five minutes, a selector that matched nothing will match nothing
 * again, and an item the gate rejected on its merits is not a failure at all.
 * Retrying those wastes quota, delays real work, and — worst — makes a
 * correctly-working source look broken.
 */

export const MAX_ATTEMPTS = 5

/** Error codes that a later attempt might succeed on. */
export const RETRYABLE_CODES = [
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
  'ai_rate_limited',
  'storage_unavailable',
] as const

/**
 * Error codes that will not change on their own. Retrying these is not
 * caution, it is noise.
 */
export const PERMANENT_CODES = [
  'invalid_source_config',
  'unsupported_document_type',
  'selector_mismatch',
  'no_usable_content',
  'invalid_webhook_signature',
  'schema_validation_failure',
  'ai_parse_failure',
  'ai_invalid_output',
  'no_publication_date',
  'not_legal_update',
  'low_confidence',
  'inactive_source',
  'unverified_source',
  'unknown_source',
  'domain_mismatch',
  'malformed_url',
  'bad_url_scheme',
  'duplicate',
  'missing_confidence_threshold',
  'http_400',
  'http_401',
  'http_403',
  'http_404',
  'http_410',
] as const

export type RetryableCode = (typeof RETRYABLE_CODES)[number]
export type PermanentCode = (typeof PERMANENT_CODES)[number]

const RETRYABLE = new Set<string>(RETRYABLE_CODES)
const PERMANENT = new Set<string>(PERMANENT_CODES)

/**
 * Decides whether an error code is worth another attempt.
 *
 * An unrecognised code is treated as PERMANENT. Retrying the unknown risks a
 * loop against a condition nothing will clear, and a dead letter is visible
 * while a retry loop is not.
 */
export function isRetryable(code: string | null | undefined): boolean {
  if (!code) return false
  if (RETRYABLE.has(code)) return true
  return false
}

export function isPermanent(code: string | null | undefined): boolean {
  if (!code) return true
  return !RETRYABLE.has(code)
}

/** True when the code is in neither list — surfaces taxonomy gaps in tests. */
export function isKnownCode(code: string): boolean {
  return RETRYABLE.has(code) || PERMANENT.has(code)
}

/** Maps an HTTP status to an error code. */
export function codeForHttpStatus(status: number): string {
  if (status === 408) return 'http_408'
  if (status === 429) return 'http_429'
  if (status >= 500 && status <= 599) {
    return [500, 502, 503, 504].includes(status) ? `http_${status}` : 'http_500'
  }
  if (status === 401) return 'http_401'
  if (status === 403) return 'http_403'
  if (status === 404) return 'http_404'
  if (status === 410) return 'http_410'
  if (status >= 400) return 'http_400'
  return 'ok'
}

export interface BackoffOptions {
  /** Ascending base delays in minutes; length also caps the retry count. */
  schedule?: readonly number[]
  /** Fraction of the delay used as jitter spread. 0.2 = ±20%. */
  jitterRatio?: number
  /** Injected for deterministic tests. */
  random?: () => number
}

export const DEFAULT_BACKOFF_MINUTES = [5, 15, 45, 120, 360] as const

/**
 * Delay in milliseconds before attempt `attemptNumber + 1`.
 *
 * Jitter is not decoration: without it, a batch of sources that failed together
 * (a network blip, a shared upstream) would retry in lockstep forever, keeping
 * the thundering herd synchronised.
 */
export function backoffMs(attemptNumber: number, options: BackoffOptions = {}): number {
  const schedule = options.schedule?.length ? options.schedule : DEFAULT_BACKOFF_MINUTES
  const jitterRatio = options.jitterRatio ?? 0.2
  const random = options.random ?? Math.random

  const index = Math.min(Math.max(attemptNumber, 1), schedule.length) - 1
  const baseMinutes = schedule[index] ?? schedule[schedule.length - 1] ?? 5
  const baseMs = baseMinutes * 60_000

  // symmetric jitter in [-ratio, +ratio]
  const spread = baseMs * jitterRatio
  const offset = (random() * 2 - 1) * spread
  return Math.max(1_000, Math.round(baseMs + offset))
}

export interface RetryDecisionInput {
  errorCode: string | null | undefined
  attemptNumber: number
  maxAttempts?: number
  now?: Date
  backoff?: BackoffOptions
}

export type RetryDecision =
  | { action: 'retry'; attemptNumber: number; nextRetryAt: string; delayMs: number }
  | { action: 'dead'; reason: 'max_attempts_exhausted' | 'permanent_error'; errorCode: string }

/**
 * The single retry decision, used by both the ingestion failure branch and the
 * retry sweep so they cannot disagree.
 */
export function decideRetry(input: RetryDecisionInput): RetryDecision {
  const code = input.errorCode ?? 'unknown_error'
  const maxAttempts = input.maxAttempts ?? MAX_ATTEMPTS

  if (!isRetryable(code)) {
    return { action: 'dead', reason: 'permanent_error', errorCode: code }
  }

  const next = input.attemptNumber + 1
  if (next > maxAttempts) {
    return { action: 'dead', reason: 'max_attempts_exhausted', errorCode: code }
  }

  const delayMs = backoffMs(next, input.backoff ?? {})
  const now = input.now ?? new Date()
  return {
    action: 'retry',
    attemptNumber: next,
    delayMs,
    nextRetryAt: new Date(now.getTime() + delayMs).toISOString(),
  }
}

/** Retry metadata carried on every attempt, for the dead letter and the logs. */
export interface RetryMetadata {
  attempt_number: number
  max_attempts: number
  first_attempt_at: string
  last_attempt_at: string
  next_retry_at: string | null
  last_error_code: string
  last_error_message: string | null
  retryable: boolean
  workflow_execution_id: string | null
  source_id: string
  item_url: string | null
  content_hash: string | null
}

export function buildRetryMetadata(params: {
  attemptNumber: number
  maxAttempts?: number
  firstAttemptAt?: string
  now?: Date
  nextRetryAt?: string | null
  errorCode: string
  errorMessage?: string | null
  executionId?: string | null
  sourceId: string
  itemUrl?: string | null
  contentHash?: string | null
}): RetryMetadata {
  const now = params.now ?? new Date()
  const nowIso = now.toISOString()
  return {
    attempt_number: params.attemptNumber,
    max_attempts: params.maxAttempts ?? MAX_ATTEMPTS,
    first_attempt_at: params.firstAttemptAt ?? nowIso,
    last_attempt_at: nowIso,
    next_retry_at: params.nextRetryAt ?? null,
    last_error_code: params.errorCode,
    last_error_message: params.errorMessage?.slice(0, 1000) ?? null,
    retryable: isRetryable(params.errorCode),
    workflow_execution_id: params.executionId ?? null,
    source_id: params.sourceId,
    item_url: params.itemUrl ?? null,
    content_hash: params.contentHash ?? null,
  }
}
