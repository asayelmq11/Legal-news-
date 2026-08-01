/**
 * Regression suite for the "sign-in succeeds but the user never enters the app"
 * failure.
 *
 * The defect: lib/supabase/proxy.ts collected the Supabase client's cookie
 * writes onto its pass-through response, then returned a *different*
 * NextResponse.redirect() object in both redirect branches — silently dropping
 * every Set-Cookie header the client had produced for that request.
 *
 * Because Supabase rotates refresh tokens, a refresh that never reaches the
 * browser leaves the browser holding a token the server has already consumed.
 * The next refresh fails with "Invalid Refresh Token", the session is torn
 * down, and the user is bounced to /login — while sign-in itself reports
 * success. The mirror image is just as bad: when Auth invalidates a session it
 * asks for the cookies to be *cleared*, and dropping that leaves a dead cookie
 * behind to fail again on the next request.
 *
 * Every assertion below is about what leaves updateSession(), not about what it
 * decided internally.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const AUTH_COOKIE = 'sb-project-auth-token'

/* -------------------------------------------------------------------------- */
/* Supabase client stub                                                        */
/* -------------------------------------------------------------------------- */

type GetUserBehaviour = {
  /** Cookies the client asks to write during getUser() — a refresh or a clear. */
  writes?: { name: string; value: string; options: Record<string, unknown> }[]
  user: { id: string } | null
  error?: { name: string; message: string } | null
}

let behaviour: GetUserBehaviour = { user: null }

vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, options: {
    cookies: {
      getAll: () => { name: string; value: string }[]
      setAll: (c: { name: string; value: string; options: Record<string, unknown> }[]) => void
    }
  }) => ({
    auth: {
      getUser: async () => {
        if (behaviour.writes?.length) options.cookies.setAll(behaviour.writes)
        return { data: { user: behaviour.user }, error: behaviour.error ?? null }
      },
    },
  }),
}))

const { updateSession } = await import('@/lib/supabase/proxy')

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function request(path: string, cookies: Record<string, string> = {}): NextRequest {
  const req = new NextRequest(new URL(path, 'http://localhost:3000'))
  for (const [name, value] of Object.entries(cookies)) req.cookies.set(name, value)
  return req
}

/** A token refresh: new value, normal lifetime. */
const REFRESH = [
  { name: AUTH_COOKIE, value: 'rotated-token', options: { path: '/', maxAge: 34560000 } },
]

/** A session teardown: empty value, maxAge 0. */
const CLEAR = [{ name: AUTH_COOKIE, value: '', options: { path: '/', maxAge: 0 } }]

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
  behaviour = { user: null }
})

afterEach(() => {
  vi.restoreAllMocks()
})

/* -------------------------------------------------------------------------- */

describe('proxy session persistence — cookies survive every exit path', () => {
  it('carries refreshed cookies on the pass-through response', async () => {
    behaviour = { writes: REFRESH, user: { id: 'u1' } }

    const res = await updateSession(request('/updates'))

    expect(res.cookies.get(AUTH_COOKIE)?.value).toBe('rotated-token')
  })

  it('carries refreshed cookies on the signed-in /login → / redirect', async () => {
    // THE REGRESSION. The rotated token was written onto the pass-through
    // response and then discarded when this branch returned a fresh redirect.
    behaviour = { writes: REFRESH, user: { id: 'u1' } }

    const res = await updateSession(request('/login', { [AUTH_COOKIE]: 'stale-token' }))

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('http://localhost:3000/')
    expect(res.cookies.get(AUTH_COOKIE)?.value).toBe('rotated-token')
  })

  it('carries cookie clears on the signed-out → /login redirect', async () => {
    // The mirror image: a dead session must actually be cleared in the browser,
    // otherwise the same doomed refresh runs again on the next request.
    behaviour = {
      writes: CLEAR,
      user: null,
      error: { name: 'AuthApiError', message: 'Invalid Refresh Token' },
    }

    const res = await updateSession(request('/updates', { [AUTH_COOKIE]: 'dead-token' }))

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/login')

    const cleared = res.cookies.get(AUTH_COOKIE)
    expect(cleared?.value).toBe('')
    expect(cleared?.maxAge).toBe(0)
  })

  it('emits a Set-Cookie header, not just an internal cookie record', async () => {
    // res.cookies.get() reading back is necessary but not sufficient — the
    // header is what the browser actually sees.
    behaviour = { writes: REFRESH, user: { id: 'u1' } }

    const res = await updateSession(request('/login'))

    expect(res.headers.get('set-cookie')).toContain(`${AUTH_COOKIE}=rotated-token`)
  })
})

describe('proxy session persistence — a transport failure is not a sign-out', () => {
  it('does not redirect to /login when Supabase is unreachable', async () => {
    // AuthRetryableFetchError means "we do not know", not "no session". A
    // redirect here would log a valid user out on a network blip.
    behaviour = {
      user: null,
      error: { name: 'AuthRetryableFetchError', message: 'fetch failed' },
    }

    const res = await updateSession(request('/updates', { [AUTH_COOKIE]: 'valid-token' }))

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
  })

  it('still redirects when Auth definitively reports no session', async () => {
    behaviour = {
      user: null,
      error: { name: 'AuthSessionMissingError', message: 'Auth session missing!' },
    }

    const res = await updateSession(request('/updates'))

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/login')
  })
})

describe('proxy redirect behaviour is unchanged', () => {
  it('sends an unauthenticated user to /login and preserves path and query', async () => {
    behaviour = { user: null }

    const res = await updateSession(request('/updates?q=%D8%B6%D8%B1%D9%8A%D8%A8%D8%A9&page=2'))

    const location = new URL(res.headers.get('location') ?? '')
    expect(location.pathname).toBe('/login')
    expect(location.searchParams.get('next')).toBe('/updates?q=%D8%B6%D8%B1%D9%8A%D8%A8%D8%A9&page=2')
  })

  it('adds no next parameter for the root path', async () => {
    behaviour = { user: null }

    const res = await updateSession(request('/'))

    const location = new URL(res.headers.get('location') ?? '')
    expect(location.pathname).toBe('/login')
    expect(location.searchParams.has('next')).toBe(false)
  })

  it('lets an unauthenticated user reach /login', async () => {
    behaviour = { user: null }

    const res = await updateSession(request('/login'))

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
  })

  it('fails closed to /configuration-error when Supabase is not configured', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL

    const res = await updateSession(request('/updates'))

    expect(res.headers.get('location')).toContain('/configuration-error')
  })
})
