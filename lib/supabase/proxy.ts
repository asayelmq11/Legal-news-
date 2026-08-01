import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

import { authDebug, countSessionCookies } from '@/lib/auth/debug'
import type { Database } from '@/types/database'

/** Routes reachable without a session. Everything else requires one. */
const PUBLIC_PATHS = ['/login', '/auth/callback'] as const

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

/**
 * True when getUser() failed for a reason that does NOT mean "signed out".
 *
 * supabase-js raises AuthRetryableFetchError for transport failures — Supabase
 * unreachable, DNS hiccup, timeout, 5xx. Treating that as "no session" would
 * sign a perfectly valid user out on a network blip and bounce them to /login
 * with a working cookie still in their browser. Only a definite answer from
 * Auth (session missing, token rejected, refresh token dead) may do that.
 */
function isInconclusiveAuthError(error: { name?: string } | null): boolean {
  return error?.name === 'AuthRetryableFetchError'
}

/**
 * Refreshes the Supabase session and gates unauthenticated requests.
 *
 * Two responsibilities, both of which must happen in the proxy layer:
 *
 *   1. Token refresh. Server Components cannot write cookies, so without this
 *      an expired access token would never be renewed and the user would be
 *      logged out mid-session.
 *
 *   2. A coarse redirect for requests with no session at all.
 *
 * It is deliberately NOT the security boundary. The proxy runs before the
 * request reaches a page and can be bypassed by anything that does not traverse
 * it, so the real checks live in the authenticated layout (requireActiveUser)
 * and, beneath that, in Postgres RLS. The proxy is an optimisation that saves a
 * render, not a lock.
 *
 * EVERY response leaving this function must carry the cookies the Supabase
 * client asked to write — including the redirects. See `emit()`.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  /*
   * Cookie writes are accumulated here rather than being applied only to the
   * pass-through response.
   *
   * The bug this prevents: supabase-js rotates refresh tokens, so a request
   * that refreshes the session has already consumed the old refresh token
   * server-side. If that response is then thrown away in favour of a fresh
   * NextResponse.redirect(), the browser never receives the new tokens, keeps
   * the consumed one, and every later refresh fails with "Invalid Refresh
   * Token" — sign-in appears to succeed and the next navigation lands back on
   * /login. The same applies in reverse: when Auth invalidates a session it
   * asks for the cookies to be cleared, and dropping that leaves a dead cookie
   * in the browser to fail again on the next request.
   *
   * Keyed by name so a second setAll() in the same request overwrites rather
   * than duplicates.
   */
  const pendingCookies = new Map<string, { value: string; options: CookieOptions }>()

  function emit(response: NextResponse): NextResponse {
    for (const [name, { value, options }] of pendingCookies) {
      response.cookies.set(name, value, options)
    }
    return response
  }

  let response = NextResponse.next({ request })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  /*
   * Fail closed on missing configuration. Without this the client constructor
   * would throw an opaque error on every request; instead the user is sent to a
   * page that explains what is misconfigured. Never fall through to serving the
   * app unauthenticated.
   */
  if (!url || !anonKey) {
    if (request.nextUrl.pathname === '/configuration-error') return response
    const target = request.nextUrl.clone()
    target.pathname = '/configuration-error'
    target.search = ''
    return NextResponse.redirect(target)
  }

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          // Make the new value visible to anything reading the request further
          // down the chain, including a second read inside this same request.
          request.cookies.set(name, value)
          pendingCookies.set(name, { value, options })
        }
        response = emit(NextResponse.next({ request }))
      },
    },
  })

  // getUser() revalidates the token with Supabase rather than trusting the
  // cookie's contents, and refreshes it when needed. getSession() would not.
  const { data, error } = await supabase.auth.getUser()
  const user = data.user

  const { pathname, search } = request.nextUrl

  authDebug('proxy', {
    method: request.method,
    path: pathname,
    // Counts only — never the cookie names or their contents.
    sessionCookiesIn: countSessionCookies(request.cookies.getAll()),
    sessionResolved: Boolean(user),
    authError: error?.name ?? null,
  })

  /*
   * Supabase could not be reached. Do not redirect: that would discard a valid
   * session over a transient failure. Pass the request through to the real
   * boundary — requireActiveUser() in the authenticated layout — which resolves
   * the user itself and fails closed when it cannot.
   */
  if (!user && isInconclusiveAuthError(error)) return emit(response)

  if (!user && !isPublicPath(pathname)) {
    const target = request.nextUrl.clone()
    target.pathname = '/login'
    target.search = ''
    /*
     * Preserve path AND query, so signing in returns the user to the filtered
     * archive search they followed a link to — not to a bare listing with their
     * filters silently discarded. safeNext() in lib/auth/actions.ts re-validates
     * this before redirecting.
     */
    if (pathname !== '/') target.searchParams.set('next', `${pathname}${search}`)
    return emit(NextResponse.redirect(target))
  }

  // A signed-in user has no reason to see the login form.
  if (user && pathname === '/login') {
    const target = request.nextUrl.clone()
    target.pathname = '/'
    target.search = ''
    return emit(NextResponse.redirect(target))
  }

  return emit(response)
}
