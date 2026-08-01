'use client'

import { useActionState } from 'react'

import { ActionMessage, SubmitButton, inputClass } from '@/components/admin/form-parts'
import { OPS_IDLE } from '@/lib/actions/state'
import { releaseSourceLock, resolveDeadLetter, triggerManualRun } from '@/lib/ops/actions'
import { COUNTRIES, COUNTRY_CODES } from '@/lib/constants/countries'

interface SourceOption { id: string; authority_ar: string }

export function ManualRunPanel({
  sources,
  configured,
}: {
  sources: readonly SourceOption[]
  configured: boolean
}) {
  const [state, action] = useActionState(triggerManualRun, OPS_IDLE)

  if (!configured) {
    return (
      <p className="rounded-md border border-(--color-warn) bg-(--color-warn-subtle) px-4 py-3 text-sm text-(--color-ink-muted)">
        <strong className="text-(--color-warn)">التشغيل اليدوي غير مُهيّأ.</strong> يلزم ضبط{' '}
        <span dir="ltr" className="font-mono text-xs">N8N_TRIGGER_WEBHOOK_URL</span> و{' '}
        <span dir="ltr" className="font-mono text-xs">N8N_TRIGGER_SECRET</span> في بيئة النشر. تم
        تعطيل الزر بدلاً من إرسال طلب غير موثّق.
      </p>
    )
  }

  return (
    <form action={action} className="space-y-4">
      <ActionMessage state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="scope" className="block text-sm font-medium text-(--color-ink)">النطاق</label>
          <select id="scope" name="scope" defaultValue="source" className={inputClass}>
            <option value="source">مصدر واحد</option>
            <option value="country">كل مصادر دولة</option>
            <option value="all">كل المصادر المفعّلة والمتحقَّق منها</option>
            <option value="url">رابط واحد</option>
            <option value="drain">تصريف قائمة الانتظار</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="sourceId" className="block text-sm font-medium text-(--color-ink)">المصدر</label>
          <select id="sourceId" name="sourceId" defaultValue="" className={inputClass}>
            <option value="">—</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>{s.authority_ar}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="country" className="block text-sm font-medium text-(--color-ink)">الدولة</label>
          <select id="country" name="country" defaultValue="" className={inputClass}>
            <option value="">—</option>
            {COUNTRY_CODES.map((c) => (
              <option key={c} value={c}>{COUNTRIES[c].nameAr}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="url" className="block text-sm font-medium text-(--color-ink)">رابط محدد</label>
          <input id="url" name="url" className={inputClass} dir="ltr" placeholder="https://…" />
        </div>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="force" value="true" className="mt-1" />
        <span>
          <span className="font-medium text-(--color-ink)">تشغيل قسري</span>
          <span className="block text-xs text-(--color-ink-subtle)">
            يتجاوز قفل التشغيل. قد يؤدي إلى تشغيلين متزامنين للمصدر نفسه — استخدمه فقط عند التأكد
            من أن القفل عالق.
          </span>
        </span>
      </label>

      <SubmitButton
        pendingLabel="جارٍ البدء…"
        confirm="سيبدأ التشغيل عبر خط الإنتاج نفسه المستخدم في الجدولة. هل تريد المتابعة؟"
      >
        بدء التشغيل
      </SubmitButton>

      <p className="text-xs text-(--color-ink-subtle)">
        يستخدم التشغيل اليدوي خط المعالجة الإنتاجي نفسه — المحلّلات والتصنيف وبوابة النشر — ولا يوجد
        مسار مبسّط منفصل.
      </p>
    </form>
  )
}

export function DeadLetterActions({ id }: { id: string }) {
  const [state, action] = useActionState(resolveDeadLetter, OPS_IDLE)

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <textarea
        name="note"
        rows={2}
        required
        minLength={3}
        placeholder="سبب المعالجة أو صرف النظر…"
        className={`${inputClass} text-xs`}
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          name="state"
          value="resolved"
          className="rounded-md bg-(--color-ok) px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90"
        >
          وسم كمُعالَج
        </button>
        <button
          type="submit"
          name="state"
          value="dismissed"
          className="rounded-md border border-(--color-border-strong) px-3 py-1.5 text-sm font-medium text-(--color-ink-muted) hover:bg-(--color-surface-sunken)"
        >
          صرف النظر
        </button>
      </div>
      <ActionMessage state={state} />
    </form>
  )
}

export function ReplayButton({ deadLetterId }: { deadLetterId: string }) {
  const [state, action] = useActionState(triggerManualRun, OPS_IDLE)
  return (
    <form action={action}>
      <input type="hidden" name="scope" value="replay" />
      <input type="hidden" name="deadLetterId" value={deadLetterId} />
      <SubmitButton
        variant="ghost"
        pendingLabel="جارٍ الإعادة…"
        confirm="ستُنشأ محاولة تنفيذ جديدة. يبقى سجل الإخفاق الأصلي كما هو."
      >
        إعادة المحاولة
      </SubmitButton>
      <ActionMessage state={state} />
    </form>
  )
}

export function ReleaseLockButton({ sourceId }: { sourceId: string }) {
  const [state, action] = useActionState(releaseSourceLock, OPS_IDLE)
  return (
    <form action={action}>
      <input type="hidden" name="id" value={sourceId} />
      <SubmitButton
        variant="danger"
        pendingLabel="جارٍ التحرير…"
        confirm="سيُحرَّر القفل ولن يُستأنف التشغيل الجاري. هل تريد المتابعة؟"
      >
        تحرير القفل
      </SubmitButton>
      <ActionMessage state={state} />
    </form>
  )
}
