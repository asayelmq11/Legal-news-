import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

import type { Database } from '@/types/database'

/** Routes reachable without a session. Everything else requires one. */
const PUBLIC_PATHS = ['/login', '/auth/callback'] as const

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
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
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
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
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value)
        }
        response = NextResponse.next({ request })
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options)
        }
      },
    },
  })

  // getUser() revalidates the token with Supabase rather than trusting the
  // cookie's contents, and refreshes it when needed. getSession() would not.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  if (!user && !isPublicPath(pathname)) {
    const target = request.nextUrl.clone()
    target.pathname = '/login'
    target.search = ''
    // Preserve the destination so login can return the user to it.
    if (pathname !== '/') target.searchParams.set('next', pathname)
    return NextResponse.redirect(target)
  }

  // A signed-in user has no reason to see the login form.
  if (user && pathname === '/login') {
    const target = request.nextUrl.clone()
    target.pathname = '/'
    target.search = ''
    return NextResponse.redirect(target)
  }

  return response
}
