import 'server-only'

import { getServerEnv } from '@/lib/env'

/**
 * Answers one question: does the anon key belong to the project the URL points
 * at?
 *
 * A key from a different project is the classic cause of a sign-in that fails
 * with a valid password — Supabase rejects the request as `Invalid API key`,
 * which reads like a credentials problem and is not one. It happens whenever
 * .env.local is assembled from two dashboard tabs, or a project is recreated
 * and only one of the two values is updated.
 *
 * The legacy anon key is a JWT whose payload carries a `ref` claim naming its
 * project. That is compared against the sub-domain of the Supabase URL. Neither
 * value is ever logged: only truncated SHA-256 digests and the verdict.
 *
 * Nothing here reads a secret. The anon key is public by design — it is shipped
 * to every browser — and the service-role key is not present in this
 * application at all. The `keyRole` field exists to catch the one dangerous
 * mistake: a service-role key pasted where the anon key belongs.
 */
export type ProjectBinding = {
  /** First 8 hex of SHA-256 of the ref in NEXT_PUBLIC_SUPABASE_URL. */
  urlRef: string
  /** First 8 hex of SHA-256 of the ref claimed by the anon key, or 'unknown'. */
  keyRef: string
  /** true / false, or null when the key format carries no ref to compare. */
  match: boolean | null
  /** The key's `role` claim — must be 'anon'. 'unknown' for non-JWT keys. */
  keyRole: string
}

export async function describeProjectBinding(): Promise<ProjectBinding> {
  const env = getServerEnv()

  const urlRef = projectRefFromUrl(env.NEXT_PUBLIC_SUPABASE_URL)
  const claims = claimsFromKey(env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

  return {
    urlRef: await digest(urlRef),
    keyRef: claims?.ref ? await digest(claims.ref) : 'unknown',
    match: claims?.ref ? claims.ref === urlRef : null,
    keyRole: claims?.role ?? 'unknown',
  }
}

/** `https://abcdefgh.supabase.co` → `abcdefgh`. */
function projectRefFromUrl(url: string): string {
  try {
    const [first = ''] = new URL(url).hostname.split('.')
    return first
  } catch {
    return ''
  }
}

/**
 * Reads the `ref` and `role` claims out of a legacy anon key.
 *
 * The payload is decoded, not verified — this is a configuration check, not an
 * authentication one, and the signature is Supabase's business. The newer
 * `sb_publishable_…` keys are not JWTs and carry no ref, so they yield null and
 * the comparison reports `match=null` rather than a false alarm.
 */
function claimsFromKey(key: string): { ref?: string; role?: string } | null {
  const parts = key.split('.')
  if (parts.length !== 3) return null

  try {
    const payload: unknown = JSON.parse(atob((parts[1] ?? '').replace(/-/g, '+').replace(/_/g, '/')))
    if (typeof payload !== 'object' || payload === null) return null

    const { ref, role } = payload as { ref?: unknown; role?: unknown }
    return {
      ...(typeof ref === 'string' ? { ref } : {}),
      ...(typeof role === 'string' ? { role } : {}),
    }
  } catch {
    return null
  }
}

/** Truncated SHA-256, so two refs can be compared without either being shown. */
async function digest(value: string): Promise<string> {
  if (!value) return 'unknown'
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(bytes)]
    .slice(0, 4)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
