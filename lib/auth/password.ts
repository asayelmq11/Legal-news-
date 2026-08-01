import { z } from 'zod'

/**
 * Password policy for this platform, in one place so the form and the Server
 * Action cannot drift apart.
 *
 * 72 is not arbitrary: bcrypt truncates at 72 bytes, so anything longer is
 * silently ignored rather than stored, and a user would believe they had a
 * stronger password than they do.
 *
 * Supabase enforces its own minimum on top of this. This one is stricter, and
 * deliberately does not demand symbols or mixed case — length carries far more
 * weight than a character-class checklist, which mostly produces `Passw0rd!`.
 */
export const PASSWORD_MIN = 12
export const PASSWORD_MAX = 72

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, { error: `كلمة المرور يجب ألا تقل عن ${PASSWORD_MIN} خانة` })
  .max(PASSWORD_MAX, { error: `كلمة المرور يجب ألا تزيد عن ${PASSWORD_MAX} خانة` })
  .refine((value) => /\p{L}/u.test(value) && /\d/.test(value), {
    error: 'كلمة المرور يجب أن تحتوي على حرف ورقم على الأقل',
  })

export const updatePasswordSchema = z
  .object({
    password: passwordSchema,
    confirm: z.string().min(1, { error: 'تأكيد كلمة المرور مطلوب' }),
  })
  .refine((value) => value.password === value.confirm, {
    error: 'كلمتا المرور غير متطابقتين',
    path: ['confirm'],
  })

/**
 * Client-side mirror of the same rules, for the message shown while typing.
 * Returns null when the pair is acceptable.
 *
 * The Server Action re-validates with the schema above — this is feedback, not
 * a check.
 */
export function describePasswordProblem(password: string, confirm: string): string | null {
  const result = updatePasswordSchema.safeParse({ password, confirm })
  if (result.success) return null
  return result.error.issues[0]?.message ?? 'كلمة المرور غير صالحة'
}
