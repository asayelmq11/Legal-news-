import Link from 'next/link'

import { Badge } from '@/components/badges'
import { BUTTON, CONTROL } from '@/components/ui'
import { requireAdmin } from '@/lib/auth/session'
import { listSources } from '@/lib/admin/queries'
import { COUNTRIES } from '@/lib/constants/countries'
import { SOURCE_STATUS_META, deriveSourceStatus } from '@/lib/sources/status'
import { INGESTION_MODE_LABELS_AR } from '@/lib/constants/taxonomy'
import { cn, formatDateAr } from '@/lib/utils'

const PARSER_TYPE_LABELS_AR: Record<string, string> = {
  rss: 'RSS',
  api: 'API',
  html: 'HTML',
  pdf: 'فهرس PDF',
  unknown: 'غير محدَّد',
}

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
        <Link href="/sources/new" className={BUTTON.primary}>
          إضافة مصدر
        </Link>
      </header>

      <form method="get" action="/sources" className="flex flex-wrap items-end gap-3 rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface-raised) p-4">
        <div className="min-w-48 flex-1 space-y-1.5">
          <label htmlFor="q" className="block text-sm font-medium text-(--color-ink)">بحث</label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="اسم الجهة…"
            className={cn(CONTROL, 'w-full')}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="status" className="block text-sm font-medium text-(--color-ink)">الحالة</label>
          <select id="status" name="status" defaultValue={status} className={CONTROL}>
            <option value="all">الكل</option>
            <option value="active">نشط</option>
            <option value="verified">تم التحقق</option>
            <option value="pending_verification">بانتظار التحقق</option>
            <option value="blocked_by_access">محجوب</option>
            <option value="requires_subscription">يتطلب اشتراكاً</option>
          </select>
        </div>
        <button type="submit" className={BUTTON.ghost}>
          تصفية
        </button>
      </form>

      {error ? (
        <p role="alert" className="rounded-(--radius-control) bg-(--color-danger-subtle) px-3 py-2 text-sm text-(--color-danger)">
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
                className="block rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-raised) p-4 transition-colors hover:border-(--color-border-strong) hover:bg-(--color-surface-sunken)/50"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-(--color-ink)">{s.authority_ar}</span>
                  <Badge tone="brand">{COUNTRIES[s.country].nameAr}</Badge>
                  <Badge tone={meta.tone}>{meta.labelAr}</Badge>
                  {s.ingestion_mode !== 'official' ? (
                    <Badge tone="neutral">{INGESTION_MODE_LABELS_AR[s.ingestion_mode]}</Badge>
                  ) : null}
                  {s.requires_authority_check ? <Badge tone="warn">تحقق من هوية الجهة</Badge> : null}
                  {s.exclusion_group ? <Badge tone="warn">مجموعة استبعاد</Badge> : null}
                </div>
                <p className="mt-1 font-mono text-xs text-(--color-ink-subtle)" dir="ltr">
                  {s.base_url}
                </p>
                <p className="mt-1 text-xs text-(--color-ink-subtle)">
                  أولوية {s.priority} · {PARSER_TYPE_LABELS_AR[s.parser_type] ?? s.parser_type} · آخر تحديث{' '}
                  {formatDateAr(s.updated_at)}
                  {s.last_success_at ? <> · آخر نجاح {formatDateAr(s.last_success_at)}</> : null}
                </p>
                {s.last_failure_reason && !s.active ? (
                  <p className="mt-1 text-xs text-(--color-danger)">{s.last_failure_reason}</p>
                ) : null}
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
