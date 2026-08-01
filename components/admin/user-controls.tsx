'use client'

import { useActionState } from 'react'

import { ActionMessage, Field, inputClass, SubmitButton } from '@/components/admin/form-parts'
import { IDLE } from '@/lib/actions/state'
import { createUserProfile, setUserActive, setUserRole } from '@/lib/admin/actions'
import type { UserRow } from '@/lib/admin/queries'
import { USER_ROLE_LABELS_AR } from '@/lib/constants/taxonomy'

export function CreateUserForm() {
  const [state, action] = useActionState(createUserProfile, IDLE)

  return (
    <form action={action} className="space-y-4">
      <ActionMessage state={state} />

      <p className="rounded-md bg-(--color-surface-sunken) px-3 py-2 text-xs leading-relaxed text-(--color-ink-muted)">
        أنشئ الحساب أولاً من <span className="font-medium">Supabase → Authentication → Users</span>{' '}
        ثم انسخ معرّفه هنا. لا تُنشئ المنصة حسابات المصادقة ولا تتعامل مع كلمات المرور إطلاقاً، ولا
        يوجد تسجيل ذاتي.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="new-id" label="معرّف المستخدم في Supabase (UUID)">
          <input id="new-id" name="id" className={inputClass} dir="ltr" required />
        </Field>
        <Field id="new-email" label="البريد الإلكتروني">
          <input id="new-email" name="email" type="email" className={inputClass} dir="ltr" required />
        </Field>
        <Field id="new-name" label="الاسم">
          <input id="new-name" name="full_name" className={inputClass} />
        </Field>
        <Field id="new-role" label="الصلاحية">
          <select id="new-role" name="role" defaultValue="viewer" className={inputClass}>
            <option value="viewer">{USER_ROLE_LABELS_AR.viewer}</option>
            <option value="admin">{USER_ROLE_LABELS_AR.admin}</option>
          </select>
        </Field>
      </div>

      <SubmitButton>إنشاء ملف المستخدم</SubmitButton>
    </form>
  )
}

export function UserRow_({ user, isSelf }: { user: UserRow; isSelf: boolean }) {
  const [roleState, roleAction] = useActionState(setUserRole, IDLE)
  const [activeState, activeAction] = useActionState(setUserActive, IDLE)

  return (
    <li className="space-y-3 rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-raised) p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-(--color-ink)">
            {user.full_name ?? user.email}
            {isSelf ? <span className="mr-2 text-xs text-(--color-ink-subtle)">(أنت)</span> : null}
          </p>
          <p className="font-mono text-xs text-(--color-ink-subtle)" dir="ltr">
            {user.email}
          </p>
        </div>
        <span
          className={
            user.active
              ? 'rounded-full bg-(--color-ok-subtle) px-2.5 py-0.5 text-xs text-(--color-ok)'
              : 'rounded-full bg-(--color-surface-sunken) px-2.5 py-0.5 text-xs text-(--color-ink-muted)'
          }
        >
          {user.active ? 'مفعّل' : 'موقوف'}
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <form action={roleAction} className="flex items-end gap-2">
          <input type="hidden" name="id" value={user.id} />
          <div className="space-y-1">
            <label htmlFor={`role-${user.id}`} className="block text-xs text-(--color-ink-subtle)">
              الصلاحية
            </label>
            <select
              id={`role-${user.id}`}
              name="role"
              defaultValue={user.role}
              disabled={isSelf}
              className="rounded-md border border-(--color-border-strong) bg-(--color-surface) px-3 py-1.5 text-sm disabled:opacity-50"
            >
              <option value="viewer">{USER_ROLE_LABELS_AR.viewer}</option>
              <option value="admin">{USER_ROLE_LABELS_AR.admin}</option>
            </select>
          </div>
          {!isSelf ? <SubmitButton variant="ghost">حفظ</SubmitButton> : null}
        </form>

        {!isSelf ? (
          <form action={activeAction}>
            <input type="hidden" name="id" value={user.id} />
            <input type="hidden" name="active" value={user.active ? 'false' : 'true'} />
            <SubmitButton
              variant={user.active ? 'danger' : 'ghost'}
              confirm={
                user.active
                  ? `إيقاف «${user.full_name ?? user.email}» يمنعه من الدخول فوراً. هل تريد المتابعة؟`
                  : undefined
              }
            >
              {user.active ? 'إيقاف' : 'تفعيل'}
            </SubmitButton>
          </form>
        ) : (
          <p className="text-xs text-(--color-ink-subtle)">
            لا يمكنك تغيير صلاحيتك أو إيقاف حسابك بنفسك.
          </p>
        )}
      </div>

      <ActionMessage state={roleState} />
      <ActionMessage state={activeState} />
    </li>
  )
}
