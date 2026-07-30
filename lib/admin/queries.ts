import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { SETTING_DEFINITIONS } from '@/lib/settings/registry'
import type { Enums, Tables } from '@/types/database'

export type SourceRow = Tables<'sources'>
export type UserRow = Tables<'users'>
export type SettingRow = Tables<'app_settings'>

/** Sources with optional text search and status filter. Small table; no paging. */
export async function listSources(params: { q?: string; status?: string } = {}) {
  const supabase = await createClient()
  let query = supabase.from('sources').select('*').order('country').order('authority_ar')

  if (params.q) {
    // ilike on authority_ar is served by the trigram index from migration 0004.
    query = query.ilike('authority_ar', `%${params.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)
  }
  if (params.status === 'active') query = query.eq('active', true)
  else if (params.status && params.status !== 'all') {
    query = query.eq('config_status', params.status as Enums<'config_status'>)
  }

  const { data, error } = await query
  return { rows: data ?? [], error: error?.message ?? null }
}

export async function getSource(id: string) {
  const supabase = await createClient()
  const { data } = await supabase.from('sources').select('*').eq('id', id).maybeSingle()
  return data
}

export async function listUsers() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .order('role')
    .order('email')
  return { rows: data ?? [], error: error?.message ?? null }
}

/** Settings joined against the registry, so unknown stored keys are ignored. */
export async function listSettings() {
  const supabase = await createClient()
  const { data, error } = await supabase.from('app_settings').select('*')
  const stored = new Map((data ?? []).map((r) => [r.key, r]))

  return {
    rows: SETTING_DEFINITIONS.map((def) => ({
      def,
      row: stored.get(def.key) ?? null,
    })),
    error: error?.message ?? null,
  }
}
