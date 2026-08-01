import type { Enums } from '@/types/database'

/**
 * Source health scoring and classification.
 *
 * ┌─ WHAT COUNTS AS ILL-HEALTH ────────────────────────────────────────────────┐
 * │ Health measures whether the platform can RETRIEVE AND PROCESS a source's   │
 * │ content. It does not measure whether that content was interesting.         │
 * │                                                                            │
 * │ These NEVER reduce the score:                                              │
 * │   · duplicates — the source republished something already archived         │
 * │   · gate rejections on the merits — not a legal update, low confidence      │
 * │   · empty runs — the authority simply published nothing                    │
 * │                                                                            │
 * │ A ministry that publishes nothing for a fortnight is a quiet ministry, not │
 * │ a broken integration, and a dashboard that says otherwise trains people to │
 * │ ignore it.                                                                 │
 * └────────────────────────────────────────────────────────────────────────────┘
 */

export type HealthClassification = Enums<'health_status'>

export interface HealthWindow {
  /** Runs sampled for the rates below. */
  runs: number
  /** Runs where the fetch itself succeeded. */
  fetchSuccesses: number
  /** Runs that produced at least one parsed item when the fetch succeeded. */
  extractionSuccesses: number
  /** Items where AI classification returned valid output. */
  aiAttempts: number
  aiSuccesses: number
  /** Items reaching the gate, and those it accepted. */
  gateAttempts: number
  gateAccepted: number
  /** Items rejected as duplicates — reported, never penalised. */
  duplicates: number
  /** Sum of run durations, for the average. */
  totalDurationMs: number
}

export interface HealthInput {
  active: boolean
  configStatus: Enums<'config_status'>
  consecutiveFailures: number
  lastCheckedAt: string | null
  lastSuccessAt: string | null
  lastItemFoundAt: string | null
  deadJobCount: number
  window: HealthWindow
  /** Per-source silence window; falls back to the global default. */
  maxSilenceMinutes: number | null
  defaultMaxSilenceMinutes: number
  failureAlertThreshold: number
  now?: Date
}

export interface HealthResult {
  classification: HealthClassification
  score: number
  stale: boolean
  neverChecked: boolean
  checkedButNothingFound: boolean
  rates: {
    fetchSuccessRate: number | null
    extractionSuccessRate: number | null
    aiSuccessRate: number | null
    gateAcceptanceRate: number | null
    duplicateRate: number | null
  }
  avgResponseMs: number | null
}

const ratio = (num: number, den: number): number | null =>
  den <= 0 ? null : Math.min(1, Math.max(0, num / den))

export function computeHealth(input: HealthInput): HealthResult {
  const now = input.now ?? new Date()
  const w = input.window

  const rates = {
    fetchSuccessRate: ratio(w.fetchSuccesses, w.runs),
    // Extraction is only meaningful where the fetch worked.
    extractionSuccessRate: ratio(w.extractionSuccesses, w.fetchSuccesses),
    aiSuccessRate: ratio(w.aiSuccesses, w.aiAttempts),
    gateAcceptanceRate: ratio(w.gateAccepted, w.gateAttempts),
    duplicateRate: ratio(w.duplicates, w.gateAttempts),
  }

  const avgResponseMs = w.runs > 0 ? Math.round(w.totalDurationMs / w.runs) : null

  /* ---- staleness ------------------------------------------------------- */

  const neverChecked = input.lastCheckedAt === null
  const everSucceeded = input.lastSuccessAt !== null
  const checkedButNothingFound = everSucceeded && input.lastItemFoundAt === null

  const silenceWindow = input.maxSilenceMinutes ?? input.defaultMaxSilenceMinutes

  /*
   * Staleness is measured from the last SUCCESSFUL CHECK, not the last item.
   * A source that is being polled successfully and simply has nothing to say
   * is healthy; one the platform has not managed to check within its window is
   * not. This is the distinction the milestone asks for, and getting it the
   * other way round would flag every quiet gazette as broken.
   */
  const stale =
    everSucceeded &&
    now.getTime() - new Date(input.lastSuccessAt as string).getTime() >
      silenceWindow * 60_000

  /* ---- score ----------------------------------------------------------- */

  let score = 100

  // Consecutive failures dominate: they are the clearest signal of a source
  // the platform genuinely cannot read.
  score -= Math.min(60, input.consecutiveFailures * 15)

  if (rates.fetchSuccessRate !== null) score -= (1 - rates.fetchSuccessRate) * 30
  if (rates.extractionSuccessRate !== null) score -= (1 - rates.extractionSuccessRate) * 20
  if (rates.aiSuccessRate !== null) score -= (1 - rates.aiSuccessRate) * 15

  if (stale) score -= 20
  if (input.deadJobCount > 0) score -= Math.min(15, input.deadJobCount * 5)

  // gateAcceptanceRate and duplicateRate are deliberately absent from the
  // score. They describe the content, not the integration.

  score = Math.max(0, Math.min(100, Math.round(score)))

  /* ---- classification -------------------------------------------------- */

  // Order matters: an unverified source is unverified regardless of its rates,
  // and a disabled one is not being checked at all.
  let classification: HealthClassification
  if (!input.active) classification = 'disabled'
  else if (input.configStatus !== 'verified') classification = 'unverified'
  else if (neverChecked) classification = 'never_run'
  else if (input.consecutiveFailures >= input.failureAlertThreshold || score < 40) {
    classification = 'failing'
  } else if (input.consecutiveFailures > 0 || score < 70) classification = 'degraded'
  else if (stale) classification = 'stale'
  else classification = 'healthy'

  return {
    classification,
    score,
    stale,
    neverChecked,
    checkedButNothingFound,
    rates,
    avgResponseMs,
  }
}

/* -------------------------------------------------------------------------- */
/* Alerting                                                                    */
/* -------------------------------------------------------------------------- */

export type AlertKind =
  | 'source.degraded'
  | 'source.failing'
  | 'source.recovered'
  | 'job.retry_scheduled'
  | 'job.dead'
  | 'manual_run.completed'
  | 'manual_run.failed'

export interface AlertDecisionInput {
  previous: HealthClassification | null
  current: HealthClassification
  lastAlertKind: string | null
  lastAlertAt: string | null
  cooldownMinutes: number
  now?: Date
}

export type AlertDecision =
  | { emit: true; kind: AlertKind }
  | { emit: false; reason: 'no_transition' | 'cooldown' | 'not_alertable' }

const UNHEALTHY: ReadonlySet<HealthClassification> = new Set(['degraded', 'failing'])

/**
 * Decides whether a health change is worth telling anyone about.
 *
 * Two suppressions, both there to keep alerts meaningful:
 *   · no transition — a source that was failing an hour ago and is still
 *     failing is not news; the first alert already said so.
 *   · cooldown — a source flapping between degraded and failing would
 *     otherwise emit on every snapshot.
 *
 * `source.recovered` fires ONLY on a genuine return from degraded or failing to
 * healthy. It never fires from never_run, disabled or unverified, none of which
 * are states one recovers from.
 */
export function decideAlert(input: AlertDecisionInput): AlertDecision {
  const { previous, current } = input
  const now = input.now ?? new Date()

  let kind: AlertKind | null = null

  if (current === 'failing' && previous !== 'failing') kind = 'source.failing'
  else if (current === 'degraded' && previous !== 'degraded' && previous !== 'failing') {
    kind = 'source.degraded'
  } else if (current === 'healthy' && previous !== null && UNHEALTHY.has(previous)) {
    kind = 'source.recovered'
  }

  if (!kind) {
    // Same state as last time, or a transition nobody needs paging about.
    return { emit: false, reason: previous === current ? 'no_transition' : 'not_alertable' }
  }

  // Recovery is always worth hearing, even inside a cooldown — suppressing it
  // would leave an operator believing a source is still broken.
  if (kind !== 'source.recovered' && input.lastAlertAt) {
    const elapsedMs = now.getTime() - new Date(input.lastAlertAt).getTime()
    if (elapsedMs < input.cooldownMinutes * 60_000 && input.lastAlertKind === kind) {
      return { emit: false, reason: 'cooldown' }
    }
  }

  return { emit: true, kind }
}
