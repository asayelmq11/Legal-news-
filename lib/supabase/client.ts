'use client'

import { createBrowserClient } from '@supabase/ssr'

import type { Database } from '@/types/database'

/**
 * Browser Supabase client.
 *
 * Used ONLY for authentication actions that must run client-side — sign-out and
 * the auth state listener that keeps a tab in step after a token refresh.
 *
 * Data is never fetched through this client. Every read happens in a Server
 * Component via lib/supabase/server.ts, which keeps queries out of the network
 * tab and off the client bundle. This client therefore only ever carries the
 * anon key, which is safe to expose: RLS decides what it can see, and the
 * archive tables have no write grant at all.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
