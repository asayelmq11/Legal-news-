import 'server-only'

/**
 * Opt-in sign-in diagnostics: `AUTH_DEBUG=1 npm run dev`.
 *
 * Exists because a session that fails to persist is invisible — sign-in
 * reports success, the redirect fires, and the user lands back on /login with
 * nothing in any log to say why. This prints the four facts that distinguish
 * the possible causes.
 *
 * WHAT IS LOGGED: counts, booleans, request paths and error class names.
 * WHAT IS NEVER LOGGED: cookie names, cookie values, tokens, keys, emails,
 * passwords, or any part of a session. Call sites must pass numbers and
 * booleans, never strings taken from a cookie or a credential.
 */
export const AUTH_DEBUG = process.env.AUTH_DEBUG === '1'

type Fact = string | number | boolean | null

export function authDebug(stage: string, facts: Record<string, Fact>): void {
  if (!AUTH_DEBUG) return
  const rendered = Object.entries(facts)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ')
  console.warn(`[auth-debug] ${stage} ${rendered}`)
}

/**
 * Matches the Supabase session cookie and its chunks — `sb-<ref>-auth-token`,
 * `sb-<ref>-auth-token.0`, `.1`, … — and nothing else. The PKCE verifier
 * (`…-auth-token-code-verifier`) is deliberately excluded: it is not a session.
 */
const SESSION_COOKIE = /^sb-.+-auth-token(\.\d+)?$/

export function countSessionCookies(cookies: readonly { name: string }[]): number {
  return cookies.filter((cookie) => SESSION_COOKIE.test(cookie.name)).length
}
