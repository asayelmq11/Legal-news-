import { requireActiveUser } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { deriveSourceStatus, SOURCE_STATUS_META } from '@/lib/sources/status'

export const metadata = { title: 'لوحة المتابعة' }

/**
 * Placeholder dashboard. M6 replaces this with the full health and metrics
 * view; for now it proves the authenticated path end to end — session, role,
 * and an RLS-scoped read.
 */
export default async function DashboardPage() {
  const user = await requireActiveUser()
  const supabase = await createClient()

  const [{ count: sourceCount }, { count: updateCount }, { data: sources }] = await Promise.all([
    supabase.from('sources').select('*', { count: 'exact', head: true }),
    supabase.from('legal_updates').select('*', { count: 'exact', head: true }),
    supabase.from('sources').select('active, config_status'),
  ])

  const byStatus = new Map<string, number>()
  for (const s of sources ?? []) {
    const status = deriveSourceStatus(s)
    byStatus.set(status, (byStatus.get(status) ?? 0) + 1)
  }

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-(--color-ink)">لوحة المتابعة</h1>
        <p className="text-sm text-(--color-ink-muted)">
          أهلاً {user.full_name ?? user.email}
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        <Stat label="المصادر المسجّلة" value={sourceCount ?? 0} />
        <Stat label="التحديثات المنشورة" value={updateCount ?? 0} />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-(--color-ink-muted)">حالة المصادر</h2>
        <ul className="divide-y divide-(--color-border) rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-raised)">
          {[...byStatus.entries()].map(([status, count]) => {
            const meta = SOURCE_STATUS_META[status as keyof typeof SOURCE_STATUS_META]
            return (
              <li key={status} className="flex items-baseline justify-between gap-4 px-4 py-3">
                <div>
                  <span className="text-sm font-medium text-(--color-ink)">{meta.labelAr}</span>
                  <p className="text-xs text-(--color-ink-subtle)">{meta.descriptionAr}</p>
                </div>
                <span className="text-sm font-semibold text-(--color-ink)">{count}</span>
              </li>
            )
          })}
        </ul>
      </section>

      <p className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-sunken) px-4 py-3 text-sm text-(--color-ink-muted)">
        لا يوجد مصدر نشط حتى الآن. يبدأ الرصد بعد التحقق من إمكانية الوصول لكل مصدر من بيئة
        التشغيل الفعلية (المرحلة M7.5).
      </p>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-raised) px-5 py-4">
      <p className="text-sm text-(--color-ink-muted)">{label}</p>
      <p className="mt-1 text-2xl font-bold text-(--color-ink)">{value}</p>
    </div>
  )
}
