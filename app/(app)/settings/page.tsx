import { SettingEditor } from '@/components/admin/setting-editor'
import { requireAdmin } from '@/lib/auth/session'
import { listSettings, listUsers } from '@/lib/admin/queries'
import { toSettingView } from '@/lib/settings/registry'
import { formatDateAr } from '@/lib/utils'

export const metadata = { title: 'الإعدادات' }

export default async function SettingsPage() {
  await requireAdmin()
  const [{ rows, error }, users] = await Promise.all([listSettings(), listUsers()])

  const nameById = new Map(users.rows.map((u) => [u.id, u.full_name ?? u.email]))

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-(--color-ink)">إعدادات التطبيق</h1>
        <p className="text-sm text-(--color-ink-muted)">
          قيم تشغيلية فقط، يقرأها n8n. تُعرض المفاتيح المعرّفة في السجل حصراً.
        </p>
      </header>

      <p className="rounded-(--radius-control) border border-(--color-border) bg-(--color-surface-sunken) px-4 py-3 text-xs leading-relaxed text-(--color-ink-muted)">
        <strong className="text-(--color-ink)">لا تُخزَّن هنا أي بيانات اعتماد.</strong> مفاتيح الـ
        API وكلمات المرور وأسرار الويب‑هوك مكانها بيانات اعتماد n8n أو مدير الأسرار في بيئة النشر.
        ترفض قاعدة البيانات أي مفتاح يحمل صيغة بيانات اعتماد، ولا يمكن إضافة مفاتيح جديدة من هذه
        الواجهة إطلاقاً.
      </p>

      {error ? (
        <p role="alert" className="rounded-(--radius-control) bg-(--color-danger-subtle) px-3 py-2 text-sm text-(--color-danger)">
          تعذّر تحميل الإعدادات: {error}
        </p>
      ) : null}

      <div className="space-y-4">
        {rows.map(({ def, row }) => (
          <SettingEditor
            key={def.key}
            def={toSettingView(def)}
            stored={row?.value ?? null}
            updatedAt={row?.updated_at ? formatDateAr(row.updated_at) : null}
            updatedByLabel={row?.updated_by ? (nameById.get(row.updated_by) ?? null) : null}
          />
        ))}
      </div>
    </div>
  )
}
