'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

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
    return { error: 'بيانات الدخول غير صحيحة' }
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
