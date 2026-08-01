import 'server-only'

import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

import { authDebug } from '@/lib/auth/debug'
import { getServerEnv } from '@/lib/env'
import type { Database } from '@/types/database'

/**
 * Server Supabase client, scoped to the current request's cookies.
 *
 * Carries the anon key plus the signed-in user's JWT, so every query runs
 * under that user's RLS policies. There is deliberately no service-role client
 * anywhere in this application: the web app cannot write the archive, and
 * giving it a key that could would defeat the seal enforced in migration 0005.
 *
 * `server-only` makes importing this from a Client Component a build error.
 *
 * NOT memoised with React `cache()`. That was tried and reverted: `cache()` is
 * scoped to a React render pass, and a Server Action runs outside one. Wrapping
 * this factory made the client — and the mutable cookie store it captures —
 * shared between the action phase and the render that follows it, which is
 * exactly the phase boundary where a cookie store stops being writable. A
 * cheap constructor per call is the safe trade.
 */
export async function createClient() {
  const env = getServerEnv()
  const cookieStore = await cookies()

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options)
            }
            authDebug('server.setAll', { asked: cookiesToSet.length, wrote: true })
          } catch (error) {
            /*
             * Server Components cannot set cookies. That is expected and
             * harmless: the proxy refreshes the session on every request, so
             * the refreshed token is already persisted by the time a page
             * renders. Swallowing this is the documented @supabase/ssr pattern.
             *
             * Anything else is NOT expected — a Server Action that fails to
             * write the session cookie looks exactly like a successful sign-in
             * that never signs anyone in. Surface it. Only the message is
             * logged; cookie names and values are never printed.
             */
            const message = error instanceof Error ? error.message : String(error)
            const duringRender = /cookies can only be modified/i.test(message)
            authDebug('server.setAll', {
              asked: cookiesToSet.length,
              wrote: false,
              duringRender,
            })
            if (!duringRender) {
              console.error(`[auth] could not persist session cookies: ${message}`)
            }
          }
        },
      },
    },
  )
}
