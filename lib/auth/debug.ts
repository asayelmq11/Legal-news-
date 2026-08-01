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

/* -------------------------------------------------------------------------- */
/* Auth error sanitisation                                                     */
/* -------------------------------------------------------------------------- */

export type SanitizedAuthError = {
  name: string
  code: string
  status: number | null
  message: string
}

/**
 * Reduces a Supabase auth error to the four fields that identify it, with the
 * message scrubbed.
 *
 * Supabase's own messages are fixed strings ("Invalid login credentials",
 * "Invalid API key", "Email not confirmed"), but a message is the one field
 * that could ever carry an echo of what was submitted, so it is scrubbed
 * rather than trusted: anything email-shaped goes, any long opaque run that
 * could be a token or key goes, and the result is capped. Nothing else about
 * the request is read.
 */
export function sanitizeAuthError(error: unknown): SanitizedAuthError {
  const source = (error ?? {}) as { name?: unknown; code?: unknown; status?: unknown; message?: unknown }

  return {
    name: typeof source.name === 'string' ? source.name : 'Error',
    code: typeof source.code === 'string' && source.code ? source.code : 'none',
    status: typeof source.status === 'number' ? source.status : null,
    message: scrubMessage(typeof source.message === 'string' ? source.message : ''),
  }
}

function scrubMessage(message: string): string {
  return (
    message
      // Anything email-shaped.
      .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '<redacted>')
      // Any long opaque run — JWTs, API keys, refresh tokens, hashes.
      .replace(/[A-Za-z0-9_\-.]{24,}/g, '<redacted>')
      // Control characters, so a message cannot forge log lines.
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .trim()
      .slice(0, 160) || '(empty)'
  )
}

/**
 * True for "that password is wrong / no such account".
 *
 * Routine, expected, and not worth a log line on every typo. Everything else —
 * a rejected API key, an unconfirmed email, a rate limit, an unreachable host —
 * is an operator problem and must be visible whether or not AUTH_DEBUG is on.
 */
export function isCredentialRejection(error: SanitizedAuthError): boolean {
  if (error.code === 'invalid_credentials') return true
  return error.status === 400 && /invalid login credentials/i.test(error.message)
}
