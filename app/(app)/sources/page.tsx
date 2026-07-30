import Link from 'next/link'

import { Badge } from '@/components/badges'
import { requireAdmin } from '@/lib/auth/session'
import { listSources } from '@/lib/admin/queries'
import { COUNTRIES } from '@/lib/constants/countries'
import { SOURCE_STATUS_META, deriveSourceStatus } from '@/lib/sources/status'
import { formatDateAr } from '@/lib/utils'

export const metadata = { title: 'المصادر' }

export default async function SourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>
}) {
  await requireAdmin()
  const params = await searchParams
  const q = typeof params.q === 'string' ? params.q.slice(0, 100) : ''
  const status = typeof params.status === 'string' ? params.status : 'all'

  const { rows, error } = await listSources({ q, status })

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-(--color-ink)">المصادر</h1>
          <p className="text-sm text-(--color-ink-muted)">
            سجل المصادر الموثوقة. لا يُرصد أي مصدر خارج هذا السجل.
          </p>
        </div>
        <Link
          href="/sources/new"
          className="rounded-md bg-(--color-brand) px-4 py-2 text-sm font-semibold text-white hover:bg-(--color-brand-hover)"
        >
          إضافة مصدر
        </Link>
      </header>

      <form method="get" action="/sources" className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <label htmlFor="q" className="block text-sm font-medium text-(--color-ink)">بحث</label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="اسم الجهة…"
            className="rounded-md border border-(--color-border-strong) bg-(--color-surface) px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="status" className="block text-sm font-medium text-(--color-ink)">الحالة</label>
          <select
            id="status"
            name="status"
            defaultValue={status}
            className="rounded-md border border-(--color-border-strong) bg-(--color-surface) px-3 py-2 text-sm"
          >
            <option value="all">الكل</option>
            <option value="active">نشط</option>
            <option value="verified">تم التحقق</option>
            <option value="pending_verification">بانتظار التحقق</option>
            <option value="blocked_by_access">محجوب</option>
            <option value="requires_subscription">يتطلب اشتراكاً</option>
          </select>
        </div>
        <button
          type="submit"
          className="rounded-md border border-(--color-border-strong) px-4 py-2 text-sm font-medium text-(--color-ink-muted) hover:bg-(--color-surface-sunken)"
        >
          تصفية
        </button>
      </form>

      {error ? (
        <p role="alert" className="rounded-md bg-(--color-danger-subtle) px-3 py-2 text-sm text-(--color-danger)">
          تعذّر تحميل المصادر: {error}
        </p>
      ) : null}

      <p className="text-sm text-(--color-ink-muted)">{rows.length} مصدر</p>

      <ul className="space-y-2">
        {rows.map((s) => {
          const ui = deriveSourceStatus(s)
          const meta = SOURCE_STATUS_META[ui]
          return (
            <li key={s.id}>
              <Link
                href={`/sources/${s.id}`}
                className="block rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-raised) p-4 hover:border-(--color-border-strong)"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-(--color-ink)">{s.authority_ar}</span>
                  <Badge tone="brand">{COUNTRIES[s.country].nameAr}</Badge>
                  <Badge tone={meta.tone}>{meta.labelAr}</Badge>
                  {s.requires_authority_check ? <Badge tone="warn">تحقق من هوية الجهة</Badge> : null}
                  {s.exclusion_group ? <Badge tone="warn">مجموعة استبعاد</Badge> : null}
                </div>
                <p className="mt-1 font-mono text-xs text-(--color-ink-subtle)" dir="ltr">
                  {s.base_url}
                </p>
                <p className="mt-1 text-xs text-(--color-ink-subtle)">
                  أولوية {s.priority} · آخر تحديث {formatDateAr(s.updated_at)}
                </p>
              </Link>
            </li>
          )
        })}
      </ul>

      {rows.length === 0 && !error ? (
        <p className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-raised) p-8 text-center text-sm text-(--color-ink-muted)">
          لا توجد مصادر مطابقة.
        </p>
      ) : null}
    </div>
  )
}
