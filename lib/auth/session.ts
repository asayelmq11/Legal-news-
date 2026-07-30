import 'server-only'

import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import type { Tables } from '@/types/database'

export type AppUser = Tables<'users'>

/**
 * Why a session can be refused. Each maps to a distinct screen, because
 * "you are not allowed in" and "your account was switched off" need different
 * words and different next steps.
 */
export type AuthFailure =
  | 'no_session' // not signed in
  | 'not_provisioned' // authenticated with Supabase, but no public.users row
  | 'inactive' // row exists, active = false
  | 'insufficient_role' // signed in, active, wrong role

export type AuthResult =
  | { ok: true; user: AppUser }
  | { ok: false; reason: AuthFailure }

/**
 * Resolves the current user without redirecting, for callers that need to
 * branch on the outcome (the authenticated layout, tests).
 *
 * There is deliberately no self-provisioning path: an authenticated Supabase
 * account with no public.users row is refused rather than having a row created
 * for it. Access to this platform is granted by an admin, never claimed by
 * signing up.
 *
 * The row is fetched under the user's own RLS policies, so this cannot see more
 * than the user is permitted to see. `active` is re-read on every request, which
 * is what makes deactivation take effect immediately rather than at next login.
 */
export async function getAuthResult(): Promise<AuthResult> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { ok: false, reason: 'no_session' }

  const { data: profile } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile) return { ok: false, reason: 'not_provisioned' }
  if (!profile.active) return { ok: false, reason: 'inactive' }

  return { ok: true, user: profile }
}

/**
 * Requires an active, provisioned user. Redirects otherwise.
 *
 * This — not the proxy layer — is the application's authentication boundary. It runs
 * inside the authenticated layout, so every page beneath it is covered without
 * each one having to remember.
 */
export async function requireActiveUser(): Promise<AppUser> {
  const result = await getAuthResult()
  if (result.ok) return result.user

  switch (result.reason) {
    case 'no_session':
      redirect('/login')
    case 'not_provisioned':
      redirect('/no-access?reason=not_provisioned')
    case 'inactive':
      redirect('/no-access?reason=inactive')
    case 'insufficient_role':
      redirect('/unauthorized')
  }
}

/**
 * Requires an admin. Use in admin-only pages and at the top of every
 * admin Server Action — a page guard alone does not protect an action, which
 * can be invoked directly.
 *
 * RLS blocks the write regardless; this exists so the user gets an
 * intelligible screen instead of a silent zero-row update.
 */
export async function requireAdmin(): Promise<AppUser> {
  const user = await requireActiveUser()
  if (user.role !== 'admin') redirect('/unauthorized')
  return user
}

/** Non-redirecting role check, for conditionally rendering navigation. */
export function isAdmin(user: AppUser | null | undefined): boolean {
  return user?.role === 'admin' && user.active
}
