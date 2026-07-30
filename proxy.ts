import type { NextRequest } from 'next/server'

import { updateSession } from '@/lib/supabase/proxy'

/**
 * Next.js 16 renamed the `middleware` file convention to `proxy`. Using the old
 * name still builds but emits a deprecation warning, so this platform starts on
 * the current convention rather than accruing a migration debt on day one.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  /*
   * Run on everything except static assets and image files.
   *
   * The matcher deliberately does NOT exclude /login: the proxy must run there
   * to refresh the session and to bounce an already-signed-in user away from
   * the form. Which paths are public is decided in updateSession, where it can
   * be reasoned about and unit-tested, rather than encoded in a regex.
   */
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)',
  ],
}
