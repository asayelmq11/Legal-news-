import 'server-only'

import { cache } from 'react'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

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
 * Memoised per request with React `cache()`. The dashboard alone opens more
 * than twenty queries, and an un-memoised factory gave each of them its own
 * auth client. When the access token is close to expiry they would then all
 * refresh at once — and because Supabase rotates refresh tokens, exactly one
 * wins and the rest fail with "Invalid Refresh Token: Already Used", tearing
 * down a session that was perfectly healthy a moment earlier. One client per
 * request means one refresh per request.
 */
export const createClient = cache(async function createClient() {
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
            if (!/cookies can only be modified/i.test(message)) {
              console.error(`[auth] could not persist session cookies: ${message}`)
            }
          }
        },
      },
    },
  )
})
