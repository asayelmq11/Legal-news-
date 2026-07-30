import 'server-only'

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
          } catch {
            /*
             * Server Components cannot set cookies. That is expected and
             * harmless: the middleware refreshes the session on every request,
             * so the refreshed token is already persisted by the time a page
             * renders. Swallowing this is the documented @supabase/ssr pattern.
             */
          }
        },
      },
    },
  )
}
