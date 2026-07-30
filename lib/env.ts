import 'server-only'

import { z } from 'zod'

/**
 * Server-side environment. Importing this module from a Client Component is a
 * build error (`server-only`), which is what keeps the service role key and the
 * n8n trigger secret out of the browser bundle.
 *
 * Validation is strict and fails at first use rather than at an arbitrary
 * point later: a missing Supabase URL should stop the process, not surface as
 * a confusing runtime fetch error.
 */
const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url({ error: 'NEXT_PUBLIC_SUPABASE_URL must be a valid URL' }),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(1, { error: 'NEXT_PUBLIC_SUPABASE_ANON_KEY is required' }),

  /**
   * Manual-run trigger (see plan §9). Optional so the app boots without n8n
   * configured, but the "Run now" action fails closed when either is absent —
   * it never falls back to an unauthenticated call.
   */
  N8N_TRIGGER_WEBHOOK_URL: z.url().optional(),
  N8N_TRIGGER_SECRET: z.string().min(16).optional(),

  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
})

export type ServerEnv = z.infer<typeof serverEnvSchema>

let cached: ServerEnv | null = null

/**
 * Reads and validates server environment. Cached after first successful parse.
 *
 * Note the explicit property access: Next.js inlines `process.env.X` at build
 * time only for statically analysable references, so destructuring or dynamic
 * indexing would silently yield undefined in the production bundle.
 */
export function getServerEnv(): ServerEnv {
  if (cached) return cached

  const parsed = serverEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    N8N_TRIGGER_WEBHOOK_URL: process.env.N8N_TRIGGER_WEBHOOK_URL,
    N8N_TRIGGER_SECRET: process.env.N8N_TRIGGER_SECRET,
    NODE_ENV: process.env.NODE_ENV,
  })

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')
    throw new Error(`Invalid server environment configuration:\n${issues}`)
  }

  cached = parsed.data
  return cached
}

/**
 * True when the manual-run trigger is fully configured. The admin UI uses this
 * to disable the control with an explanation instead of offering a button that
 * would fail on click.
 */
export function isManualTriggerConfigured(): boolean {
  const env = getServerEnv()
  return Boolean(env.N8N_TRIGGER_WEBHOOK_URL && env.N8N_TRIGGER_SECRET)
}
