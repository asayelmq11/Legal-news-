'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { z } from 'zod'

import {
  authDebug,
  countSessionCookies,
  isCredentialRejection,
  sanitizeAuthError,
} from '@/lib/auth/debug'
import { describeProjectBinding } from '@/lib/auth/project-check'
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

export async function signOut(): Promise<never> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/login')
}
