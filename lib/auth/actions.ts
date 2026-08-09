'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { cookies, headers } from 'next/headers'
import { z } from 'zod'

import {
  authDebug,
  countSessionCookies,
  isCredentialRejection,
  sanitizeAuthError,
} from '@/lib/auth/debug'
import { describeProjectBinding } from '@/lib/auth/project-check'
import { updatePasswordSchema } from '@/lib/auth/password'
import { createClient } from '@/lib/supabase/server'

/**
 * Discriminated on purpose.
 *
 * The previous shape was `{ error: string | null }`, which meant the initial
 * state was `{ error: null }` — and Next's dev server logs a Server Function
 * call with its arguments, so every submission appeared as
 * `signIn({"error":null}, {})`. That is the *previous* state being echoed, not
 * a result, but it reads exactly like "signed in, no error" and sent this
 * investigation down the wrong path twice. `{"status":"idle"}` cannot be
 * misread.
 */
export type LoginState = { status: 'idle' } | { status: 'failed'; error: string }

function failed(error: string): LoginState {
  return { status: 'failed', error }
}

/** One message for every credential failure — see the comment in signIn(). */
const CREDENTIALS_REJECTED = 'بيانات الدخول غير صحيحة'

const loginSchema = z.object({
  email: z.email({ error: 'صيغة البريد الإلكتروني غير صحيحة' }),
  password: z.string().min(1, { error: 'كلمة المرور مطلوبة' }),
  next: z.string().optional(),
})

/**
 * Only relative, single-slash paths are accepted as a post-login destination.
 * Without this, `?next=https://evil.example` would turn the login form into an
 * open redirect.
 *
 * Three rejections, each for a distinct trick:
 *   - not starting with `/`  — an absolute URL to another origin
 *   - starting with `//`     — protocol-relative, also another origin
 *   - containing a backslash — some browsers normalise `\` to `/`, so
 *                              `/\evil.example` can be read as `//evil.example`
 */
function safeNext(value: string | undefined): string {
  if (!value) return '/'
  if (!value.startsWith('/')) return '/'
  if (value.startsWith('//')) return '/'
  if (value.includes('\\')) return '/'
  return value
}

export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    next: formData.get('next') ?? undefined,
  })

  if (!parsed.success) {
    return failed(parsed.error.issues[0]?.message ?? 'بيانات غير صحيحة')
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email.toLowerCase(),
    password: parsed.data.password,
  })

  if (error) {
    const detail = sanitizeAuthError(error)
    authDebug('signIn', {
      authOk: false,
      name: detail.name,
      code: detail.code,
      status: detail.status ?? 'none',
      message: detail.message,
    })

    /*
     * A rejected password is routine and gets one message for every failure
     * mode — distinguishing "no such account" from "wrong password" would let
     * anyone enumerate who works in the Legal Department.
     *
     * Everything else is an operator problem wearing a credentials costume: a
     * key from the wrong project comes back as "Invalid API key", an
     * unconfirmed account as "Email not confirmed". Telling an administrator
     * their own password is wrong, and logging nothing, is how a
     * misconfiguration survives for hours. These are logged unconditionally —
     * not behind AUTH_DEBUG — and get a message that points at the server log
     * instead of at the user's memory.
     */
    if (!isCredentialRejection(detail)) {
      const binding = await describeProjectBinding()
      console.error(
        `[auth] sign-in rejected by Supabase: name=${detail.name} code=${detail.code} ` +
          `status=${detail.status ?? 'none'} message="${detail.message}"`,
      )
      console.error(
        `[auth] project binding: urlRef=${binding.urlRef} keyRef=${binding.keyRef} ` +
          `match=${binding.match} keyRole=${binding.keyRole}`,
      )
      if (binding.match === false) {
        console.error(
          '[auth] NEXT_PUBLIC_SUPABASE_ANON_KEY belongs to a different project than ' +
            'NEXT_PUBLIC_SUPABASE_URL. Copy both from Project Settings → API of the same project.',
        )
      }
      if (binding.keyRole !== 'anon' && binding.keyRole !== 'unknown') {
        console.error(
          `[auth] NEXT_PUBLIC_SUPABASE_ANON_KEY carries role="${binding.keyRole}", not "anon". ` +
            'Only the anon/publishable key may reach the browser.',
        )
      }

      return failed(
        'تعذّر إتمام تسجيل الدخول بسبب خطأ في خدمة المصادقة أو في إعدادات الاتصال. ' +
          'راجع سجل الخادم — السبب مسجَّل هناك.',
      )
    }

    return failed(CREDENTIALS_REJECTED)
  }

  /*
   * Supabase saying "these credentials are valid" is NOT the same as the user
   * being signed in. What signs a user in is the session cookie reaching the
   * browser, and that is a separate step that can fail on its own — a cookie
   * store that is not writable in this context, a session too large to store,
   * an adapter that never ran.
   *
   * Redirecting on the strength of the auth call alone is what produced the
   * "sign-in succeeds but the user lands back on /login" loop: the action
   * returned `{ error: null }`, the redirect fired, and the very next request
   * had no session, so the proxy bounced it straight back. There was nothing
   * in any log to say why, because nothing had reported a failure.
   *
   * So: confirm the session was actually written, and fail loudly if it was
   * not. This reads the request's own cookie store, which reflects the writes
   * the Supabase client just made.
   */
  const sessionCookies = countSessionCookies((await cookies()).getAll())
  authDebug('signIn', { authOk: true, sessionCookies })

  if (sessionCookies === 0) {
    console.error('[auth] credentials accepted but no session cookie was written')
    return failed(
      'تم التحقق من بيانات الدخول لكن تعذّر حفظ الجلسة في المتصفح. ' +
        'راجع سجل الخادم — شغّل التطبيق بالأمر AUTH_DEBUG=1 npm run dev لمعرفة السبب.',
    )
  }

  revalidatePath('/', 'layout')
  redirect(safeNext(parsed.data.next))
}

/* -------------------------------------------------------------------------- */
/* Password recovery                                                           */
/* -------------------------------------------------------------------------- */

export type UpdatePasswordState =
  | { status: 'idle' }
  | { status: 'failed'; error: string }
  | { status: 'no_session' }

/**
 * Sets a new password for whoever the current session belongs to.
 *
 * Reached two ways, and it does not need to tell them apart: from a recovery
 * link, where the client has just exchanged the fragment for a session, or
 * from an ordinary signed-in session. `updateUser` only ever touches the
 * session's own user, so there is no way to aim this at somebody else.
 *
 * The recovery session is revoked globally on success. A recovery link hands
 * out a full session to anyone holding the email, so leaving it alive after
 * the password has been changed would mean the reset did not actually end the
 * access it was meant to end. `scope: 'global'` invalidates every refresh
 * token for the user, on every device.
 *
 * Nothing in this function reads or writes a token, a fragment, or a password
 * to any log. Supabase errors go through sanitizeAuthError() first.
 */
export async function updatePassword(
  _prev: UpdatePasswordState,
  formData: FormData,
): Promise<UpdatePasswordState> {
  const parsed = updatePasswordSchema.safeParse({
    password: formData.get('password'),
    confirm: formData.get('confirm'),
  })

  if (!parsed.success) {
    return { status: 'failed', error: parsed.error.issues[0]?.message ?? 'كلمة المرور غير صالحة' }
  }

  const supabase = await createClient()

  /*
   * getUser() rather than getSession(): it revalidates with Supabase instead of
   * trusting the cookie, so an expired or already-consumed recovery session is
   * caught here rather than surfacing as a confusing failure from updateUser.
   */
  const { data, error: sessionError } = await supabase.auth.getUser()
  if (!data.user) {
    authDebug('updatePassword', {
      hasSession: false,
      authError: sanitizeAuthError(sessionError).name,
    })
    return { status: 'no_session' }
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })

  if (error) {
    const detail = sanitizeAuthError(error)
    authDebug('updatePassword', {
      hasSession: true,
      updated: false,
      name: detail.name,
      code: detail.code,
      status: detail.status ?? 'none',
      message: detail.message,
    })
    console.error(
      `[auth] password update rejected: name=${detail.name} code=${detail.code} ` +
        `status=${detail.status ?? 'none'} message="${detail.message}"`,
    )

    /*
     * Supabase refuses a password identical to the current one. Say so — it is
     * not a security-relevant disclosure to someone who already holds the
     * session, and "something went wrong" would leave them retrying the same
     * password.
     */
    if (detail.code === 'same_password') {
      return { status: 'failed', error: 'كلمة المرور الجديدة مطابقة للحالية. اختر كلمة مرور مختلفة.' }
    }

    return {
      status: 'failed',
      error: 'تعذّر تحديث كلمة المرور. راجع سجل الخادم أو اطلب رابطاً جديداً من مسؤول النظام.',
    }
  }

  // Revoke the recovery session everywhere before sending them back to sign in.
  await supabase.auth.signOut({ scope: 'global' })
  authDebug('updatePassword', { hasSession: true, updated: true, revoked: true })

  revalidatePath('/', 'layout')
  redirect('/login?reset=1')
}

export type RequestResetState =
  | { status: 'idle' }
  | { status: 'sent' }
  | { status: 'failed'; error: string }

const requestResetSchema = z.object({
  email: z.email({ error: 'صيغة البريد الإلكتروني غير صحيحة' }),
})

/**
 * Derives the origin `resetPasswordForEmail` needs for `redirectTo`, from the
 * request's own Host header rather than a hard-coded env var — there isn't one
 * in this app, and this keeps the link correct across environments (local,
 * preview, production) without adding one.
 */
async function currentOrigin(): Promise<string> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'https'
  return host ? `${proto}://${host}` : ''
}

/**
 * Sends the existing Supabase recovery email — the one whose link lands on
 * /update-password and is handled entirely by RecoveryForm/updatePassword
 * above. This action only asks Supabase to send it; it changes nothing about
 * how that link is consumed.
 *
 * Always resolves to the same `sent` state regardless of whether the address
 * belongs to an account, or whether Supabase accepted the request — the same
 * reasoning as CREDENTIALS_REJECTED in signIn(): a form that answers
 * differently for a registered address than an unregistered one lets anyone
 * enumerate who works in the Legal Department. A genuine operator problem
 * (misconfiguration, rate limiting) is logged server-side instead of shown.
 */
export async function requestPasswordReset(
  _prev: RequestResetState,
  formData: FormData,
): Promise<RequestResetState> {
  const parsed = requestResetSchema.safeParse({ email: formData.get('email') })

  if (!parsed.success) {
    return { status: 'failed', error: parsed.error.issues[0]?.message ?? 'بريد إلكتروني غير صالح' }
  }

  const supabase = await createClient()
  const origin = await currentOrigin()

  const { error } = await supabase.auth.resetPasswordForEmail(
    parsed.data.email.toLowerCase(),
    origin ? { redirectTo: `${origin}/update-password` } : undefined,
  )

  if (error) {
    const detail = sanitizeAuthError(error)
    authDebug('requestPasswordReset', {
      name: detail.name,
      code: detail.code,
      status: detail.status ?? 'none',
    })
    console.error(
      `[auth] password reset request rejected: name=${detail.name} code=${detail.code} ` +
        `status=${detail.status ?? 'none'} message="${detail.message}"`,
    )
  }

  return { status: 'sent' }
}

export async function signOut(): Promise<never> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/login')
}
