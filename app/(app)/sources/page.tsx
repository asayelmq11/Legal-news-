import Link from 'next/link'

import { BUTTON, CONTROL } from '@/components/ui'
import { requireAdmin } from '@/lib/auth/session'
import { listSources } from '@/lib/admin/queries'
import { COUNTRIES } from '@/lib/constants/countries'
import { SOURCE_STATUS_META, deriveSourceStatus } from '@/lib/sources/status'
import { INGESTION_MODE_LABELS_AR, SOURCE_TYPE_LABELS_AR } from '@/lib/constants/taxonomy'
import { cn, formatDateAr } from '@/lib/utils'

export const metadata = { title: 'المصادر' }

const STATUS_DOT_TONE: Record<'ok' | 'warn' | 'danger' | 'neutral', string> = {
  ok: 'bg-(--color-ok)',
  warn: 'bg-(--color-warn)',
  danger: 'bg-(--color-danger)',
  neutral: 'bg-(--color-ink-subtle)',
}

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

      <form method="get" action="/sources" className="flex flex-wrap items-end gap-3">
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

      {rows.length === 0 && !error ? (
        <p className="border-t border-(--color-border) py-10 text-center text-sm text-(--color-ink-muted)">
          لا توجد مصادر مطابقة.
        </p>
      ) : (
        <div className="border-t border-(--color-border)">
          {/* Column headers — desktop only, the mobile stack labels each field inline instead. */}
          <div className="hidden gap-4 border-b border-(--color-border) px-1 py-2 text-xs font-medium text-(--color-ink-subtle) sm:grid sm:grid-cols-[1fr_9rem_8rem_9rem_8rem]">
            <span>الجهة</span>
            <span>الدولة</span>
            <span>النوع</span>
            <span>طريقة الرصد</span>
            <span>الحالة</span>
          </div>

          <ul className="divide-y divide-(--color-border)">
            {rows.map((s) => {
              const ui = deriveSourceStatus(s)
              const meta = SOURCE_STATUS_META[ui]
              return (
                <li key={s.id}>
                  <Link
                    href={`/sources/${s.id}`}
                    className="-mx-1 grid gap-x-4 gap-y-1 px-1 py-4 transition-colors hover:bg-(--color-surface-sunken) sm:grid-cols-[1fr_9rem_8rem_9rem_8rem] sm:items-center"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-(--color-ink)">{s.authority_ar}</p>
                      <p className="truncate font-mono text-xs text-(--color-ink-subtle)" dir="ltr">
                        {s.base_url}
                      </p>
                    </div>

                    <FieldOnMobile label="الدولة">{COUNTRIES[s.country].nameAr}</FieldOnMobile>
                    <FieldOnMobile label="النوع">{SOURCE_TYPE_LABELS_AR[s.source_type]}</FieldOnMobile>
                    <FieldOnMobile label="طريقة الرصد">
                      {INGESTION_MODE_LABELS_AR[s.ingestion_mode]}
                    </FieldOnMobile>

                    <div className="flex items-center gap-3 text-sm">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          aria-hidden="true"
                          className={cn('size-1.5 rounded-full', STATUS_DOT_TONE[meta.tone])}
                        />
                        <span className="text-(--color-ink)">{meta.labelAr}</span>
                      </span>
                    </div>

                    {(s.requires_authority_check || s.exclusion_group || (s.last_failure_reason && !s.active)) ? (
                      <p className="col-span-full mt-1 text-xs text-(--color-ink-subtle)">
                        {s.requires_authority_check ? 'يحتاج تحققاً من هوية الجهة' : null}
                        {s.requires_authority_check && s.exclusion_group ? ' · ' : null}
                        {s.exclusion_group ? 'ضمن مجموعة استبعاد' : null}
                        {(s.requires_authority_check || s.exclusion_group) && s.last_failure_reason && !s.active
                          ? ' · '
                          : null}
                        {s.last_failure_reason && !s.active ? (
                          <span className="text-(--color-danger)">{s.last_failure_reason}</span>
                        ) : null}
                      </p>
                    ) : null}

                    <p className="col-span-full text-xs text-(--color-ink-subtle) sm:hidden">
                      أولوية {s.priority} · آخر تحديث {formatDateAr(s.updated_at)}
                      {s.last_success_at ? <> · آخر نجاح {formatDateAr(s.last_success_at)}</> : null}
                    </p>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

/** Repeats its label inline on mobile (where the header row is hidden) — a plain grid cell on desktop. */
function FieldOnMobile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p className="text-sm text-(--color-ink-muted)">
      <span className="text-(--color-ink-subtle) sm:hidden">{label}: </span>
      {children}
    </p>
  )
}
