import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { Tables } from '@/types/database'

export type HealthSnapshot = Tables<'source_health_snapshots'>
export type DeadLetter = Tables<'job_dead_letters'>
export type WorkflowLog = Tables<'workflow_logs'>

/** Latest snapshot per source, plus the source row for context. */
export async function listSourceHealth() {
  const supabase = await createClient()

  const [sources, snapshots] = await Promise.all([
    supabase
      .from('sources')
      .select(
        'id, authority_ar, country, active, config_status, health_status, health_score, consecutive_failures, last_run_at, last_success_at, last_failure_at, last_failure_reason, last_error_code, last_http_status, lock_owner, lock_expires_at, max_silence_minutes',
      )
      .order('health_score', { ascending: true, nullsFirst: false })
      .order('authority_ar'),
    // Bounded: the most recent snapshots, newest first, then reduced to one
    // per source in memory. Avoids a per-source query.
    supabase
      .from('source_health_snapshots')
      .select('*')
      .order('taken_at', { ascending: false })
      .limit(500),
  ])

  const latest = new Map<string, HealthSnapshot>()
  for (const snap of snapshots.data ?? []) {
    if (!latest.has(snap.source_id)) latest.set(snap.source_id, snap)
  }

  return {
    rows: (sources.data ?? []).map((s) => ({ source: s, snapshot: latest.get(s.id) ?? null })),
    error: sources.error?.message ?? null,
  }
}

/** Snapshot history for one source, for the trend view. */
export async function getSourceHealthHistory(sourceId: string, limit = 30) {
  const supabase = await createClient()
  const { data } = await supabase
    .from('source_health_snapshots')
    .select('*')
    .eq('source_id', sourceId)
    .order('taken_at', { ascending: false })
    .limit(limit)
  return data ?? []
}

export async function listDeadLetters(state: string = 'open', limit = 50) {
  const supabase = await createClient()
  let query = supabase
    .from('job_dead_letters')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (state !== 'all') {
    query = query.eq('state', state as 'open')
  }

  const { data, error } = await query
  return { rows: data ?? [], error: error?.message ?? null }
}

/** Recent executions, for the ops timeline. */
export async function listRecentRuns(limit = 25) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('workflow_logs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit)
  return { rows: data ?? [], error: error?.message ?? null }
}

/** Sources currently holding an unexpired lease. */
export async function listRunningSources() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('sources')
    .select('id, authority_ar, lock_owner, lock_acquired_at, lock_expires_at')
    .gt('lock_expires_at', new Date().toISOString())
  return data ?? []
}

/** Aggregate operational counters for the ops header. */
export async function getOpsMetrics() {
  const supabase = await createClient()
  const since = new Date(Date.now() - 24 * 3600_000).toISOString()

  // head:true keeps every one of these a count-only request — no row payload.
  const logs = () => supabase.from('workflow_logs').select('*', { count: 'exact', head: true })
  const dead = () => supabase.from('job_dead_letters').select('*', { count: 'exact', head: true })

  const [runs24h, failures24h, manualRuns24h, openDeadLetters, totalDeadLetters] =
    await Promise.all([
      logs().gte('started_at', since),
      logs().gte('started_at', since).neq('status', 'success'),
      logs().gte('started_at', since).eq('trigger_type', 'manual'),
      dead().eq('state', 'open'),
      dead(),
    ])

  const n = (r: { count: number | null }) => r.count ?? 0

  return {
    runs24h: n(runs24h),
    failures24h: n(failures24h),
    manualRuns24h: n(manualRuns24h),
    openDeadLetters: n(openDeadLetters),
    totalDeadLetters: n(totalDeadLetters),
  }
}
