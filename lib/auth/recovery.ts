/**
 * Parsing for the URL fragment a Supabase recovery link lands on.
 *
 * The project is configured for the implicit flow, so the recovery email sends
 * the browser to
 *
 *     /update-password#access_token=…&refresh_token=…&type=recovery
 *
 * A fragment never reaches the server — it is not sent in the request — so this
 * runs in the browser, and the tokens go straight into the Supabase client and
 * nowhere else. Nothing here writes to a log, and `summariseFragment()` exists
 * so that anything that ever wants to report on a fragment can do so without
 * touching its contents.
 *
 * An expired or already-used link comes back as
 * `#error=access_denied&error_code=otp_expired`, which is why the error shape
 * is parsed here too rather than being treated as "no fragment".
 */
export type RecoveryFragment =
  | { kind: 'recovery'; accessToken: string; refreshToken: string }
  | { kind: 'error'; code: string }
  | { kind: 'none' }

export function parseRecoveryFragment(hash: string): RecoveryFragment {
  const params = new URLSearchParams(hash.replace(/^#/, ''))

  const errorCode = params.get('error_code') ?? params.get('error')
  if (errorCode) return { kind: 'error', code: errorCode }

  const accessToken = params.get('access_token')
  const refreshToken = params.get('refresh_token')

  /*
   * `type` must say recovery. A fragment carrying tokens from some other flow
   * is not an invitation to change a password, and accepting one would turn
   * this page into a way to set a password from any link that happens to
   * contain a session.
   */
  if (params.get('type') !== 'recovery' || !accessToken || !refreshToken) {
    return { kind: 'none' }
  }

  return { kind: 'recovery', accessToken, refreshToken }
}

/**
 * A description of a fragment that is safe to write down: the shape, never the
 * contents. `hasTokens` is a boolean, not a token.
 */
export function summariseFragment(fragment: RecoveryFragment): {
  kind: RecoveryFragment['kind']
  hasTokens: boolean
  code: string | null
} {
  return {
    kind: fragment.kind,
    hasTokens: fragment.kind === 'recovery',
    code: fragment.kind === 'error' ? fragment.code : null,
  }
}

/** Arabic explanation for the error codes Supabase puts in the fragment. */
export function recoveryErrorMessage(code: string): string {
  if (code === 'otp_expired') {
    return 'انتهت صلاحية رابط إعادة التعيين أو سبق استخدامه. اطلب من مسؤول النظام إرسال رابط جديد.'
  }
  if (code === 'access_denied') {
    return 'رابط إعادة التعيين غير صالح. اطلب من مسؤول النظام إرسال رابط جديد.'
  }
  return 'تعذّر التحقق من رابط إعادة التعيين. اطلب من مسؤول النظام إرسال رابط جديد.'
}
