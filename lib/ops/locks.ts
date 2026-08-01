/**
 * Per-source execution locks.
 *
 * Requirements this satisfies:
 *   · one source never runs twice concurrently
 *   · different sources run freely — no global lock
 *   · a crashed execution does not wedge a source forever
 *   · acquisition is atomic
 *
 * ┌─ HOW ATOMICITY IS ACHIEVED WITHOUT A DATABASE FUNCTION ────────────────────┐
 * │ A single conditional UPDATE:                                              │
 * │                                                                            │
 * │   UPDATE sources SET lock_owner = :owner, lock_expires_at = :expiry        │
 * │    WHERE id = :id                                                          │
 * │      AND (lock_expires_at IS NULL OR lock_expires_at < :now)               │
 * │   RETURNING id                                                             │
 * │                                                                            │
 * │ Postgres takes a row lock for the UPDATE, so of two concurrent attempts    │
 * │ exactly one matches the WHERE and gets a row back; the other updates zero  │
 * │ rows and reports already_running. No advisory lock, no function, no        │
 * │ read-then-write race.                                                      │
 * │                                                                            │
 * │ The lock is a LEASE, not a flag. An execution that dies without releasing  │
 * │ leaves lock_expires_at in the past, and the next attempt's WHERE clause    │
 * │ reclaims it. Nothing has to notice the crash.                              │
 * └────────────────────────────────────────────────────────────────────────────┘
 */

/** Default lease. Long enough for a slow crawl, short enough to self-heal. */
export const DEFAULT_LOCK_TTL_MINUTES = 30

export interface LockRow {
  lock_owner: string | null
  lock_expires_at: string | null
}

export type LockAttempt =
  | { acquired: true; owner: string; expiresAt: string }
  | { acquired: false; reason: 'already_running'; heldBy: string | null; expiresAt: string | null }

/**
 * Whether a lock is currently held. Expired leases are not held.
 *
 * Pure, so the rule is unit-testable and identical in the n8n Code node.
 */
export function isLocked(row: LockRow | null | undefined, now: Date = new Date()): boolean {
  if (!row?.lock_expires_at) return false
  return new Date(row.lock_expires_at).getTime() > now.getTime()
}

/** Builds the values for a lock acquisition attempt. */
export function lockValues(params: {
  owner: string
  ttlMinutes?: number
  now?: Date
}): { owner: string; acquiredAt: string; expiresAt: string; nowIso: string } {
  const now = params.now ?? new Date()
  const ttl = params.ttlMinutes ?? DEFAULT_LOCK_TTL_MINUTES
  return {
    owner: params.owner,
    acquiredAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttl * 60_000).toISOString(),
    nowIso: now.toISOString(),
  }
}

/**
 * Interprets the result of the conditional UPDATE.
 *
 * `updatedRows` is what the database actually changed — 1 means this caller won
 * the row, 0 means somebody else holds an unexpired lease.
 */
export function interpretLockResult(params: {
  updatedRows: number
  owner: string
  expiresAt: string
  current?: LockRow | null
}): LockAttempt {
  if (params.updatedRows > 0) {
    return { acquired: true, owner: params.owner, expiresAt: params.expiresAt }
  }
  return {
    acquired: false,
    reason: 'already_running',
    heldBy: params.current?.lock_owner ?? null,
    expiresAt: params.current?.lock_expires_at ?? null,
  }
}

/**
 * A forced acquisition, available only to an admin who has confirmed it.
 *
 * Deliberately separate from the ordinary path: taking a lock somebody else
 * holds can produce two concurrent runs for one source, which is exactly what
 * the lock exists to prevent. It is offered because a genuinely stuck lease
 * with a long TTL would otherwise block an urgent run, but it must be a
 * decision, never a fallback.
 */
export function forcedLockValues(params: {
  owner: string
  ttlMinutes?: number
  now?: Date
}): ReturnType<typeof lockValues> & { forced: true } {
  return { ...lockValues(params), forced: true }
}
