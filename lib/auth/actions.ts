'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { z } from 'zod'

import { authDebug, countSessionCookies } from '@/lib/auth/debug'
import { createClient } from '@/lib/supabase/server'

export type LoginState = { error: string | null }

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
    return { error: parsed.error.issues[0]?.message ?? 'بيانات غير صحيحة' }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email.toLowerCase(),
    password: parsed.data.password,
  })

  if (error) {
    /*
     * One message for every failure mode. Distinguishing "no such account" from
     * "wrong password" would let anyone enumerate who works in the Legal
     * Department.
     */
    authDebug('signIn', { authOk: false })
    return { error: 'بيانات الدخول غير صحيحة' }
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
    return {
      error:
        'تم التحقق من بيانات الدخول لكن تعذّر حفظ الجلسة في المتصفح. ' +
        'راجع سجل الخادم — شغّل التطبيق بالأمر AUTH_DEBUG=1 npm run dev لمعرفة السبب.',
    }
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
