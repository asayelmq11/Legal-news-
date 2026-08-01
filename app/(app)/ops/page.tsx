import { Badge } from '@/components/badges'
import { Card, Stat } from '@/components/dashboard/primitives'
import {
  DeadLetterActions,
  ManualRunPanel,
  ReleaseLockButton,
  ReplayButton,
} from '@/components/ops/ops-controls'
import { requireAdmin } from '@/lib/auth/session'
import { isManualTriggerConfigured } from '@/lib/env'
import { HEALTH_STATUS_LABELS_AR } from '@/lib/constants/taxonomy'
import { COUNTRIES } from '@/lib/constants/countries'
import {
  getOpsMetrics,
  listDeadLetters,
  listRecentRuns,
  listRunningSources,
  listSourceHealth,
} from '@/lib/ops/queries'
import { formatDateAr, formatDurationAr } from '@/lib/utils'

export const metadata = { title: 'التشغيل' }

const HEALTH_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'neutral'> = {
  healthy: 'ok',
  degraded: 'warn',
  stale: 'warn',
  failing: 'danger',
  never_run: 'neutral',
  disabled: 'neutral',
  unverified: 'neutral',
}

export default async function OpsPage() {
  await requireAdmin()

  const [metrics, health, dead, runs, running] = await Promise.all([
    getOpsMetrics(),
    listSourceHealth(),
    listDeadLetters('open', 25),
    listRecentRuns(15),
    listRunningSources(),
  ])

  const sourceOptions = health.rows.map((r) => ({
    id: r.source.id,
    authority_ar: r.source.authority_ar,
  }))

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold text-(--color-ink)">التشغيل والموثوقية</h1>
        <p className="text-sm text-(--color-ink-muted)">
          صحة المصادر، إعادة المحاولة، العناصر المتعثّرة، والتشغيل اليدوي.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="تشغيلات ٢٤ ساعة" value={metrics.runs24h} />
        <Stat
          label="إخفاقات ٢٤ ساعة"
          value={metrics.failures24h}
          tone={metrics.failures24h > 0 ? 'warn' : 'neutral'}
        />
        <Stat label="تشغيل يدوي ٢٤ ساعة" value={metrics.manualRuns24h} />
        <Stat
          label="عناصر متعثّرة مفتوحة"
          value={metrics.openDeadLetters}
          tone={metrics.openDeadLetters > 0 ? 'danger' : 'neutral'}
        />
        <Stat label="قيد التشغيل الآن" value={running.length} />
      </section>

      <Card title="تشغيل يدوي" hint="يستخدم خط الإنتاج نفسه المستخدم في الجدولة">
        <ManualRunPanel sources={sourceOptions} configured={isManualTriggerConfigured()} />
      </Card>

      {running.length > 0 ? (
        <Card title="مصادر قيد التشغيل" hint="القفل ينتهي تلقائياً حتى لو تعطّل التنفيذ">
          <ul className="divide-y divide-(--color-border)">
            {running.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-sm text-(--color-ink)">{r.authority_ar}</p>
                  <p className="text-xs text-(--color-ink-subtle)">
                    المالك <span dir="ltr" className="font-mono">{r.lock_owner}</span> · ينتهي{' '}
                    {r.lock_expires_at ? formatDateAr(r.lock_expires_at) : '—'}
                  </p>
                </div>
                <ReleaseLockButton sourceId={r.id} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card
        title="صحة المصادر"
        hint="لا تُحتسب التكرارات ولا رفض بوابة النشر ولا غياب التحديثات ضمن الإخفاق"
      >
        {health.error ? (
          <p className="text-sm text-(--color-danger)">{health.error}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-sm">
              <thead>
                <tr className="border-b border-(--color-border) text-xs text-(--color-ink-subtle)">
                  <th scope="col" className="pb-2 text-start font-medium">الجهة</th>
                  <th scope="col" className="pb-2 text-start font-medium">الدولة</th>
                  <th scope="col" className="pb-2 text-start font-medium">التصنيف</th>
                  <th scope="col" className="pb-2 text-start font-medium">النقاط</th>
                  <th scope="col" className="pb-2 text-start font-medium">إخفاقات</th>
                  <th scope="col" className="pb-2 text-start font-medium">آخر نجاح</th>
                  <th scope="col" className="pb-2 text-start font-medium">آخر خطأ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-(--color-border)">
                {health.rows.map(({ source, snapshot }) => (
                  <tr key={source.id}>
                    <td className="py-2 text-(--color-ink)">{source.authority_ar}</td>
                    <td className="py-2 text-(--color-ink-muted)">
                      {COUNTRIES[source.country].nameAr}
                    </td>
                    <td className="py-2">
                      <Badge tone={HEALTH_TONE[source.health_status] ?? 'neutral'}>
                        {HEALTH_STATUS_LABELS_AR[source.health_status] ?? source.health_status}
                      </Badge>
                    </td>
                    <td className="py-2 tabular-nums text-(--color-ink-muted)">
                      {source.health_score ?? '—'}
                    </td>
                    <td className="py-2 tabular-nums text-(--color-ink-muted)">
                      {source.consecutive_failures}
                    </td>
                    <td className="py-2 text-(--color-ink-muted)">
                      {formatDateAr(source.last_success_at)}
                    </td>
                    <td className="max-w-xs truncate py-2 text-xs text-(--color-ink-subtle)">
                      {source.last_error_code ?? snapshot?.last_error_code ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title={`عناصر متعثّرة (${dead.rows.length})`}
        hint="استنفدت محاولات إعادة التنفيذ. سجل الإخفاق الأصلي لا يُعدَّل أبداً."
      >
        {dead.rows.length === 0 ? (
          <p className="text-sm text-(--color-ink-subtle)">لا توجد عناصر متعثّرة مفتوحة.</p>
        ) : (
          <ul className="space-y-4">
            {dead.rows.map((d) => (
              <li
                key={d.id}
                className="space-y-3 rounded-md border border-(--color-border) p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="danger">{d.error_code}</Badge>
                  <Badge>{d.stage}</Badge>
                  <span className="text-xs text-(--color-ink-subtle)">
                    محاولة {d.attempt_number} من {d.max_attempts} · {formatDateAr(d.created_at)}
                    {d.replay_count > 0 ? ` · أُعيدت ${d.replay_count} مرة` : ''}
                  </span>
                </div>

                {d.item_url ? (
                  <p className="font-mono text-xs break-all text-(--color-ink-muted)" dir="ltr">
                    {d.item_url}
                  </p>
                ) : null}

                {d.error_message ? (
                  <p className="font-mono text-xs text-(--color-ink-subtle)" dir="ltr">
                    {d.error_message}
                  </p>
                ) : null}

                <div className="flex flex-wrap items-start gap-6">
                  <ReplayButton deadLetterId={d.id} />
                  <div className="min-w-64 flex-1">
                    <DeadLetterActions id={d.id} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="آخر التنفيذات">
        {runs.rows.length === 0 ? (
          <p className="text-sm text-(--color-ink-subtle)">لا توجد تنفيذات مسجّلة بعد.</p>
        ) : (
          <ul className="divide-y divide-(--color-border)">
            {runs.rows.map((r) => (
              <li key={r.id} className="space-y-1 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-(--color-ink)" dir="ltr">
                    {r.workflow_name}
                  </span>
                  <Badge
                    tone={
                      r.status === 'success' ? 'ok' : r.status === 'partial' ? 'warn' : 'danger'
                    }
                  >
                    {r.status === 'success' ? 'نجح' : r.status === 'partial' ? 'جزئي' : 'فشل'}
                  </Badge>
                  <Badge>{r.trigger_type === 'manual' ? 'يدوي' : r.trigger_type === 'retry' ? 'إعادة' : 'مجدول'}</Badge>
                  <span className="text-xs text-(--color-ink-subtle)">
                    {formatDateAr(r.started_at)} · {formatDurationAr(r.duration_ms)}
                  </span>
                </div>
                <p className="text-xs text-(--color-ink-subtle)">
                  جُلب {r.items_fetched} · نُشر {r.items_published} · رُفض {r.items_rejected}
                  {r.retry_attempt > 0 ? ` · محاولة ${r.retry_attempt}` : ''}
                </p>
                {r.error_message ? (
                  <p className="font-mono text-xs text-(--color-danger)" dir="ltr">
                    {r.error_message}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
