/**
 * Regression suite for "sign-in reports success but the user never enters the
 * app".
 *
 * The login action used to treat a clean answer from Supabase Auth as proof
 * that the user was signed in, and redirect on it. But what signs a user in is
 * the session cookie reaching the browser — a separate step, with its own ways
 * of failing. When it failed the action still returned `{ error: null }`, still
 * redirected, and the next request had no session, so the proxy bounced the
 * user straight back to /login. Nothing anywhere reported a failure.
 *
 * These tests pin the invariant: no session cookie, no redirect.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

/* -------------------------------------------------------------------------- */
/* Request stubs                                                               */
/* -------------------------------------------------------------------------- */

/** Stands in for the request's cookie store. */
const cookieStore = new Map<string, string>()

/** Set by each test to steer the stubbed Supabase client. */
let behaviour = {
  signInError: null as { name: string; message: string } | null,
  /** Whether signInWithPassword persists a session cookie, as it normally does. */
  persistsSession: true,
  getUserError: null as { name: string; message: string } | null,
  user: null as { id: string } | null,
  profile: null as Record<string, unknown> | null,
}

const redirects: string[] = []

vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => [...cookieStore].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => cookieStore.set(name, value),
  }),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    redirects.push(to)
    // next/navigation's redirect() signals by throwing; mirror that so a caller
    // that swallowed it would be caught by these tests.
    throw new Error('NEXT_REDIRECT')
  },
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      signInWithPassword: async () => {
        if (!behaviour.signInError && behaviour.persistsSession) {
          // Two chunks, exactly as @supabase/ssr writes a real session.
          cookieStore.set('sb-project-auth-token.0', 'chunk-0')
          cookieStore.set('sb-project-auth-token.1', 'chunk-1')
        }
        return { error: behaviour.signInError }
      },
      getUser: async () => ({
        data: { user: behaviour.user },
        error: behaviour.getUserError,
      }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: behaviour.profile, error: null }),
        }),
      }),
    }),
  }),
}))

const { signIn } = await import('@/lib/auth/actions')
const { getAuthResult } = await import('@/lib/auth/session')
const { countSessionCookies } = await import('@/lib/auth/debug')

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

const CREDENTIALS = { email: 'admin@legal.internal', password: 'correct-horse' }

beforeEach(() => {
  cookieStore.clear()
  redirects.length = 0
  behaviour = {
    signInError: null,
    persistsSession: true,
    getUserError: null,
    user: null,
    profile: null,
  }
})

/* -------------------------------------------------------------------------- */

describe('session cookie detection', () => {
  it('counts the session cookie and every chunk of it', () => {
    expect(
      countSessionCookies([
        { name: 'sb-project-auth-token.0' },
        { name: 'sb-project-auth-token.1' },
      ]),
    ).toBe(2)
    expect(countSessionCookies([{ name: 'sb-project-auth-token' }])).toBe(1)
  })

  it('does not count the PKCE verifier or unrelated cookies as a session', () => {
    expect(
      countSessionCookies([
        { name: 'sb-project-auth-token-code-verifier' },
        { name: 'theme' },
        { name: 'sb-project-something-else' },
      ]),
    ).toBe(0)
  })
})

describe('signIn — a redirect is earned, not assumed', () => {
  it('redirects once the session cookie is actually present', async () => {
    await expect(signIn({ error: null }, form(CREDENTIALS))).rejects.toThrow('NEXT_REDIRECT')

    expect(redirects).toEqual(['/'])
  })

  it('honours a safe next destination', async () => {
    await expect(
      signIn({ error: null }, form({ ...CREDENTIALS, next: '/updates?page=2' })),
    ).rejects.toThrow('NEXT_REDIRECT')

    expect(redirects).toEqual(['/updates?page=2'])
  })

  it('refuses an off-site next destination', async () => {
    await expect(
      signIn({ error: null }, form({ ...CREDENTIALS, next: '//evil.example/x' })),
    ).rejects.toThrow('NEXT_REDIRECT')

    expect(redirects).toEqual(['/'])
  })

  it('THE REGRESSION: does not redirect when the session cookie was not written', async () => {
    // Auth says yes, the cookie never lands. Previously: redirect to /, then
    // straight back to /login with nothing logged.
    behaviour.persistsSession = false

    const state = await signIn({ error: null }, form(CREDENTIALS))

    expect(redirects).toEqual([])
    expect(state.error).toBeTruthy()
    expect(state.error).toContain('AUTH_DEBUG=1')
  })

  it('still returns one indistinguishable message for bad credentials', async () => {
    behaviour.signInError = { name: 'AuthApiError', message: 'Invalid login credentials' }

    const state = await signIn({ error: null }, form(CREDENTIALS))

    expect(redirects).toEqual([])
    expect(state.error).toBe('بيانات الدخول غير صحيحة')
  })

  it('never reports a credential failure as a cookie failure', async () => {
    behaviour.signInError = { name: 'AuthApiError', message: 'Invalid login credentials' }

    const state = await signIn({ error: null }, form(CREDENTIALS))

    expect(state.error).not.toContain('AUTH_DEBUG')
  })
})

describe('getAuthResult — an outage is not a sign-out', () => {
  it('reports auth_unavailable when Supabase cannot be reached', async () => {
    behaviour.getUserError = { name: 'AuthRetryableFetchError', message: 'fetch failed' }

    const result = await getAuthResult()

    expect(result).toEqual({ ok: false, reason: 'auth_unavailable' })
  })

  it('still reports no_session when Auth definitively has none', async () => {
    behaviour.getUserError = { name: 'AuthSessionMissingError', message: 'Auth session missing!' }

    const result = await getAuthResult()

    expect(result).toEqual({ ok: false, reason: 'no_session' })
  })

  it('resolves an active admin from public.users', async () => {
    behaviour.user = { id: 'u1' }
    behaviour.profile = {
      id: 'u1',
      email: 'admin@legal.internal',
      full_name: 'مسؤول',
      role: 'admin',
      active: true,
      created_at: new Date(0).toISOString(),
    }

    const result = await getAuthResult()

    expect(result.ok).toBe(true)
  })

  it('refuses a deactivated user even though the session is valid', async () => {
    behaviour.user = { id: 'u1' }
    behaviour.profile = {
      id: 'u1',
      email: 'admin@legal.internal',
      full_name: 'مسؤول',
      role: 'admin',
      active: false,
      created_at: new Date(0).toISOString(),
    }

    const result = await getAuthResult()

    expect(result).toEqual({ ok: false, reason: 'inactive' })
  })
})
