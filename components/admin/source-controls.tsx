'use client'

import { useActionState } from 'react'

import { ActionMessage, SubmitButton } from '@/components/admin/form-parts'
import { CONTROL_COMPACT } from '@/components/ui'
import { IDLE } from '@/lib/actions/state'
import { setSourceActive, setSourceConfigStatus } from '@/lib/admin/actions'
import type { SourceRow } from '@/lib/admin/queries'
import { canActivate } from '@/lib/sources/status'

const STATUS_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'pending_verification', label: 'بانتظار التحقق' },
  { value: 'verified', label: 'تم التحقق' },
  { value: 'blocked_by_access', label: 'محجوب تعذّر الوصول' },
  { value: 'requires_subscription', label: 'يتطلب اشتراكاً' },
]

export function SourceControls({ source }: { source: SourceRow }) {
  const [statusState, statusAction] = useActionState(setSourceConfigStatus, IDLE)
  const [activeState, activeAction] = useActionState(setSourceActive, IDLE)

  const activatable = canActivate(source)

  return (
    <div className="space-y-4">
      <form action={statusAction} className="space-y-2">
        <input type="hidden" name="id" value={source.id} />
        <label htmlFor={`status-${source.id}`} className="block text-sm font-medium text-(--color-ink)">
          حالة التحقق
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <select
            id={`status-${source.id}`}
            name="config_status"
            defaultValue={source.config_status}
            className={CONTROL_COMPACT}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <SubmitButton variant="ghost">تحديث الحالة</SubmitButton>
        </div>
        <ActionMessage state={statusState} />
      </form>

      <form action={activeAction} className="space-y-2">
        <input type="hidden" name="id" value={source.id} />
        <input type="hidden" name="active" value={source.active ? 'false' : 'true'} />

        {source.active ? (
          <SubmitButton
            variant="danger"
            pendingLabel="جارٍ الإيقاف…"
            confirm={`إيقاف «${source.authority_ar}» سيوقف رصد هذا المصدر. هل تريد المتابعة؟`}
          >
            إيقاف المصدر
          </SubmitButton>
        ) : (
          <>
            <SubmitButton
              pendingLabel="جارٍ التفعيل…"
              confirm={`تفعيل «${source.authority_ar}» سيبدأ رصده وفق جدولته. هل تريد المتابعة؟`}
            >
              تفعيل المصدر
            </SubmitButton>
            {!activatable ? (
              <p className="text-xs text-(--color-warn)">
                التفعيل ممكن فقط بعد وسم المصدر «تم التحقق». قاعدة البيانات ترفض غير ذلك.
              </p>
            ) : null}
          </>
        )}
        <ActionMessage state={activeState} />
      </form>
    </div>
  )
}
