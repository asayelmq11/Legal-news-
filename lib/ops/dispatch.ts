import { z } from 'zod'

import { isLocked, type LockRow } from '@/lib/ops/locks'

/**
 * Manual-run async dispatch contract.
 *
 * The manual-run webhook (Workflow 04) used to hold the HTTP connection open
 * until ingestion, AI classification, publishing and the Supabase writes all
 * finished — a chain long enough to exceed the Next.js server-action timeout.
 * The fix is not a longer timeout: it is a webhook that answers as soon as the
 * request is authenticated, validated and dispatched, and lets Workflow 02
 * keep running after the response is sent.
 *
 * This module is the tested specification for that decision. The n8n Code
 * nodes in `n8n/workflows/04-retry-health-manual.json` mirror it exactly, the
 * same relationship `retry.ts` and `health.ts` already have with their nodes,
 * because a Code node cannot `import` this file — n8n runs it in a sandbox
 * with no module resolution.
 */

export const MANUAL_RUN_SCOPES = ['source', 'country', 'all', 'url', 'replay', 'drain'] as const
export type ManualRunScope = (typeof MANUAL_RUN_SCOPES)[number]

export interface ManualRunRequestBody {
  scope?: unknown
  source_id?: unknown
  country?: unknown
  url?: unknown
  dead_letter_id?: unknown
  correlation_id?: unknown
}

export type RequestValidation = { valid: true } | { valid: false; reason: string }

/**
 * Validates the raw webhook body — the n8n side of the same checks
 * `runSchema` already applies in `lib/ops/actions.ts`.
 *
 * Both must reject the same malformed requests: `actions.ts` guards the
 * button in the admin UI, but the webhook is reachable directly (whoever
 * holds `N8N_TRIGGER_SECRET`), so it cannot trust that every caller went
 * through the Next.js form.
 */
export function validateManualRunBody(body: ManualRunRequestBody): RequestValidation {
  const scope = body.scope
  if (typeof scope !== 'string' || !(MANUAL_RUN_SCOPES as readonly string[]).includes(scope)) {
    return { valid: false, reason: 'invalid_scope' }
  }
  if (scope === 'source' && !body.source_id) return { valid: false, reason: 'missing_source_id' }
  if (scope === 'country' && !body.country) return { valid: false, reason: 'missing_country' }
  if (scope === 'url' && !body.url) return { valid: false, reason: 'missing_url' }
  if (scope === 'replay' && !body.dead_letter_id) {
    return { valid: false, reason: 'missing_dead_letter_id' }
  }
  return { valid: true }
}

/** A source considered for this manual run, after the scope/eligibility filter. */
export interface ManualRunCandidate {
  sourceId: string
  lock: LockRow
}

export type ManualRunStatus = 'accepted' | 'skipped' | 'rejected' | 'failed' | 'invalid_request'

/** The exact contract returned by the webhook, and validated by `actions.ts`. */
export interface ManualRunResponseBody {
  ok: boolean
  status: ManualRunStatus
  correlation_id: string
  source_id: string | null
  accepted_at: string
  reason?: string
  accepted_sources?: string[]
  skipped_sources?: Array<{ source_id: string; reason: string }>
}

/**
 * Maps the outcome to the HTTP status the webhook must answer with.
 *
 * `accepted` is the new fast path (§1): dispatched, not awaited. The others
 * are deliberate, distinguishable outcomes, not degraded successes:
 *   · rejected  → 404, the requested source does not exist
 *   · skipped + already_running → 409, a lock is already held
 *   · skipped + anything else   → 200, the scope matched nothing to run
 *   · failed    → 500, Workflow 02 could not even be started
 */
export function httpStatusForManualRun(body: Pick<ManualRunResponseBody, 'status' | 'reason'>): number {
  if (body.status === 'invalid_request') return 400
  if (body.status === 'failed') return 500
  if (body.status === 'rejected') return 404
  if (body.status === 'accepted') return 202
  return body.reason === 'already_running' ? 409 : 200
}

/**
 * The accept/skip/reject decision for a resolved scope.
 *
 * `requestedButMissing` covers a `scope=source|url|replay` naming a source id
 * that does not exist at all — distinct from one that exists but is
 * inactive/unverified/locked, which never reaches `candidates` in the first
 * place (the n8n resolver filters those out before this decision, same as
 * the scheduler).
 */
export function resolveManualRun(params: {
  correlationId: string
  requestedSourceId: string | null
  requestedButMissing: boolean
  candidates: ManualRunCandidate[]
  force: boolean
  now?: Date
}): ManualRunResponseBody {
  const now = params.now ?? new Date()
  const acceptedAt = now.toISOString()

  if (params.requestedButMissing) {
    return {
      ok: false,
      status: 'rejected',
      correlation_id: params.correlationId,
      source_id: params.requestedSourceId,
      accepted_at: acceptedAt,
      reason: 'source_not_found',
    }
  }

  if (params.candidates.length === 0) {
    return {
      ok: true,
      status: 'skipped',
      correlation_id: params.correlationId,
      source_id: params.requestedSourceId,
      accepted_at: acceptedAt,
      reason: 'no_matching_sources',
    }
  }

  const accepted: string[] = []
  const skipped: Array<{ source_id: string; reason: string }> = []

  for (const candidate of params.candidates) {
    if (!params.force && isLocked(candidate.lock, now)) {
      skipped.push({ source_id: candidate.sourceId, reason: 'already_running' })
      continue
    }
    accepted.push(candidate.sourceId)
  }

  if (accepted.length === 0) {
    return {
      ok: true,
      status: 'skipped',
      correlation_id: params.correlationId,
      source_id: params.requestedSourceId,
      accepted_at: acceptedAt,
      reason: 'already_running',
      skipped_sources: skipped,
    }
  }

  return {
    ok: true,
    status: 'accepted',
    correlation_id: params.correlationId,
    source_id: params.requestedSourceId ?? (accepted.length === 1 ? accepted[0] : null) ?? null,
    accepted_at: acceptedAt,
    accepted_sources: accepted,
    ...(skipped.length ? { skipped_sources: skipped } : {}),
  }
}

/**
 * A dispatch attempt that failed to even start — Workflow 02 could not be
 * invoked, not that it later failed internally. Folded into `skipped_sources`
 * when at least one other source dispatched fine, so one bad source id in a
 * `country`/`all` batch does not turn a mostly-successful run into a 500.
 * Only when every accepted candidate failed to start does the response become
 * `failed`.
 */
export function foldDispatchFailures(
  body: ManualRunResponseBody,
  dispatchFailures: string[],
): ManualRunResponseBody {
  if (dispatchFailures.length === 0 || body.status !== 'accepted') return body

  const stillAccepted = (body.accepted_sources ?? []).filter((id) => !dispatchFailures.includes(id))
  const failedEntries = dispatchFailures.map((source_id) => ({ source_id, reason: 'dispatch_failed' }))

  if (stillAccepted.length === 0) {
    return {
      ok: false,
      status: 'failed',
      correlation_id: body.correlation_id,
      source_id: body.source_id,
      accepted_at: body.accepted_at,
      reason: 'dispatch_failed',
      skipped_sources: [...(body.skipped_sources ?? []), ...failedEntries],
    }
  }

  return {
    ...body,
    accepted_sources: stillAccepted,
    skipped_sources: [...(body.skipped_sources ?? []), ...failedEntries],
  }
}

/** A previously-accepted dispatch, as stored in `manual_run_dispatches`. */
export interface StoredManualRunDispatch {
  correlation_id: string
  source_id: string | null
  accepted_at: string
  accepted_sources: string[] | null
  skipped_sources: Array<{ source_id: string; reason: string }> | null
}

/**
 * Idempotent replay: a retry carrying a correlation_id already accepted gets
 * back the ORIGINAL acceptance, unchanged — same `accepted_at`, same sources —
 * instead of resolving the scope again and potentially dispatching a second
 * time. This is what makes the correlation_id an idempotency key rather than
 * just a tracing label.
 */
export function replayManualRun(stored: StoredManualRunDispatch): ManualRunResponseBody {
  return {
    ok: true,
    status: 'accepted',
    correlation_id: stored.correlation_id,
    source_id: stored.source_id,
    accepted_at: stored.accepted_at,
    ...(stored.accepted_sources?.length ? { accepted_sources: stored.accepted_sources } : {}),
    ...(stored.skipped_sources?.length ? { skipped_sources: stored.skipped_sources } : {}),
  }
}

/**
 * Validates the webhook's response body from the Next.js side. Extra fields
 * are ignored (zod strips unknown keys by default) — the two sides only need
 * to agree on what `actions.ts` actually reads.
 */
export const manualRunResponseSchema = z.object({
  ok: z.boolean(),
  status: z.enum(['accepted', 'skipped', 'rejected', 'failed', 'invalid_request']),
  correlation_id: z.string(),
  source_id: z.string().nullable().optional(),
  accepted_at: z.string().optional(),
  reason: z.string().optional(),
  accepted_sources: z.array(z.string()).optional(),
  skipped_sources: z.array(z.object({ source_id: z.string(), reason: z.string() })).optional(),
})

export type ManualRunResponse = z.infer<typeof manualRunResponseSchema>
