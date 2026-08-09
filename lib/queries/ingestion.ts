import 'server-only'

import { createClient } from '@/lib/supabase/server'

/**
 * Reads backing the manual "تحديث المستجدات" catch-up refresh.
 *
 * `ingestion_runs` is written only by n8n (service_role) — see migration
 * 0024. This module never writes it; the dashboard only ever asks "is one
 * running right now" and "when did one last succeed".
 */

export interface LatestRun {
  status: 'running' | 'succeeded' | 'failed'
  items_inserted: number | null
  completed_at: string | null
  error_message: string | null
}

export interface RefreshStatus {
  /** A refresh is in flight right now — the button must stay disabled. */
  running: boolean
  /** For "آخر تحديث ناجح: …" — independent of whether the LATEST attempt failed. */
  lastSuccessfulRefreshAt: string | null
  /** The most recent attempt's own outcome, for the polling UI's result message. */
  latest: LatestRun | null
}

export async function getRefreshStatus(): Promise<RefreshStatus> {
  const supabase = await createClient()

  const [{ data: latest }, { data: lastSucceeded }] = await Promise.all([
    supabase
      .from('ingestion_runs')
      .select('status, items_inserted, completed_at, error_message')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('ingestion_runs')
      .select('completed_at')
      .eq('status', 'succeeded')
      .order('window_to', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  return {
    running: latest?.status === 'running',
    lastSuccessfulRefreshAt: lastSucceeded?.completed_at ?? null,
    latest: latest ? { ...latest, status: latest.status as LatestRun['status'] } : null,
  }
}
