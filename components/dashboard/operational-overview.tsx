import { Badge } from '@/components/badges'
import { BarList, Card, Stat } from '@/components/dashboard/primitives'
import { COUNTRIES } from '@/lib/constants/countries'
import { HEALTH_STATUS_LABELS_AR } from '@/lib/constants/taxonomy'
import type {
  OperationalOverview,
  SourceHealthRow,
  WorkflowRunSummary,
} from '@/lib/queries/dashboard'
import { SOURCE_STATUS_META, type SourceUiStatus } from '@/lib/sources/status'
import { formatDateAr, formatDurationAr } from '@/lib/utils'

/**
 * Operational metrics — administrators only.
 *
 * Rendered from a branch the viewer path never reaches, and the underlying
 * query is never issued for a viewer, so none of this data is fetched let alone
 * transmitted to them.
 */
export function OperationalOverviewSection({ data }: { data: OperationalOverview }) {
  const {
    sourceStatusCounts,
    totalSources,
    lastSuccessfulRun,
    lastFailedRun,
    recentFailures,
    sourceHealth,
    newsletter,
  } = data

  const countOf = (status: SourceUiStatus) =>
    sourceStatusCounts.find((s) => s.key === status)?.count ?? 0

  const failing = sourceHealth.filter((s) => s.health_status === 'failing')
  const degraded = sourceHealth.filter((s) => s.health_status === 'degraded')
  const needingAttention = sourceHealth.filter(
    (s) => SOURCE_STATUS_META[s.uiStatus].needsAction,
  )

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-2 border-b border-(--color-border) pb-2">
        <h2 className="text-lg font-bold text-(--color-ink)">المؤشرات التشغيلية</h2>
        <Badge tone="brand">للمسؤولين فقط</Badge>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="إجمالي المصادر" value={totalSources} />
        <Stat
          label="مصادر نشطة"
          value={countOf('active')}
          tone={countOf('active') === 0 ? 'warn' : 'ok'}
          hint={countOf('active') === 0 ? 'لم يبدأ الرصد بعد' : undefined}
        />
        <Stat
          label="مصادر متعطلة"
          value={failing.length}
          tone={failing.length > 0 ? 'danger' : 'neutral'}
        />
        <Stat
          label="تحتاج إجراءً"
          value={needingAttention.length}
          tone={needingAttention.length > 0 ? 'warn' : 'neutral'}
          hint="بانتظار التحقق أو محجوبة أو تتطلب اشتراكاً"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="حالة المصادر" hint="مشتقّة من حالة التحقق وحالة التفعيل">
          <BarList
            items={sourceStatusCounts.map((s) => ({
              label: SOURCE_STATUS_META[s.key].labelAr,
              count: s.count,
            }))}
          />
        </Card>

        <Card title="آخر عمليات الرصد">
          <dl className="space-y-3 text-sm">
            <RunSummary label="آخر عملية ناجحة" run={lastSuccessfulRun} tone="ok" />
            <RunSummary label="آخر عملية فاشلة" run={lastFailedRun} tone="danger" />
          </dl>
        </Card>
      </div>

      <Card
        title="ملخص صحة المصادر"
        hint={
          failing.length + degraded.length > 0
            ? `${failing.length} متعطل · ${degraded.length} متدهور`
            : 'لا توجد مصادر متعطلة'
        }
      >
        <SourceHealthTable rows={[...failing, ...degraded].slice(0, 10)} />
      </Card>

      <Card title="إخفاقات سير العمل الأخيرة" hint="آخر عشر عمليات غير ناجحة">
        {recentFailures.length === 0 ? (
          <p className="text-sm text-(--color-ink-subtle)">لا توجد إخفاقات مسجّلة.</p>
        ) : (
          <ul className="divide-y divide-(--color-border)">
            {recentFailures.map((run) => (
              <li key={run.id} className="space-y-1 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-(--color-ink)" dir="ltr">
                    {run.workflow_name}
                  </span>
                  <Badge tone={run.status === 'failed' ? 'danger' : 'warn'}>
                    {run.status === 'failed' ? 'فشل' : 'جزئي'}
                  </Badge>
                  <span className="text-xs text-(--color-ink-subtle)">
                    {formatDateAr(run.started_at)}
                  </span>
                </div>
                {run.error_message ? (
                  <p className="font-mono text-xs leading-relaxed text-(--color-ink-muted)" dir="ltr">
                    {run.error_message}
                  </p>
                ) : null}
                <p className="text-xs text-(--color-ink-subtle)">
                  جُلب {run.items_fetched} · نُشر {run.items_published} · رُفض {run.items_rejected}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="ملخص إرسال النشرات">
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="أُرسلت" value={newsletter.totalSent} tone="ok" />
          <Stat
            label="أخفقت"
            value={newsletter.totalFailed}
            tone={newsletter.totalFailed > 0 ? 'danger' : 'neutral'}
          />
          <Stat label="تُخطّيت" value={newsletter.totalSkipped} />
        </div>
        <p className="mt-4 text-sm text-(--color-ink-muted)">
          {newsletter.lastSentAt ? (
            <>
              آخر إرسال {formatDateAr(newsletter.lastSentAt)}
              {newsletter.lastRecipientCount !== null
                ? ` إلى ${newsletter.lastRecipientCount} مستلماً`
                : ''}
              .
            </>
          ) : (
            'لم تُرسل أي نشرة بعد. النشرة معطّلة افتراضياً حتى تُضبط قائمة المستلمين.'
          )}
        </p>
      </Card>
    </div>
  )
}

function RunSummary({
  label,
  run,
  tone,
}: {
  label: string
  run: WorkflowRunSummary | null
  tone: 'ok' | 'danger'
}) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-(--color-ink-subtle)">{label}</dt>
      <dd>
        {run ? (
          <div className="space-y-0.5">
            <p className={tone === 'ok' ? 'text-(--color-ok)' : 'text-(--color-danger)'}>
              {formatDateAr(run.started_at)}
              <span className="mx-1.5 text-(--color-ink-subtle)">·</span>
              <span className="font-mono text-xs" dir="ltr">
                {run.workflow_name}
              </span>
            </p>
            <p className="text-xs text-(--color-ink-subtle)">
              المدة {formatDurationAr(run.duration_ms)} · جُلب {run.items_fetched} · نُشر{' '}
              {run.items_published}
            </p>
          </div>
        ) : (
          <p className="text-(--color-ink-subtle)">لا يوجد سجل بعد</p>
        )}
      </dd>
    </div>
  )
}

function SourceHealthTable({ rows }: { rows: readonly SourceHealthRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-(--color-ink-subtle)">
        لا توجد مصادر متعطلة أو متدهورة. لن تظهر بيانات صحة حقيقية قبل تفعيل أول مصدر.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-start text-sm">
        <thead>
          <tr className="border-b border-(--color-border) text-xs text-(--color-ink-subtle)">
            <th scope="col" className="pb-2 text-start font-medium">الجهة</th>
            <th scope="col" className="pb-2 text-start font-medium">الدولة</th>
            <th scope="col" className="pb-2 text-start font-medium">الصحة</th>
            <th scope="col" className="pb-2 text-start font-medium">إخفاقات متتالية</th>
            <th scope="col" className="pb-2 text-start font-medium">آخر نجاح</th>
            <th scope="col" className="pb-2 text-start font-medium">سبب الإخفاق</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-(--color-border)">
          {rows.map((s) => (
            <tr key={s.id}>
              <td className="py-2 text-(--color-ink)">{s.authority_ar}</td>
              <td className="py-2 text-(--color-ink-muted)">{COUNTRIES[s.country].nameAr}</td>
              <td className="py-2">
                <Badge tone={s.health_status === 'failing' ? 'danger' : 'warn'}>
                  {HEALTH_STATUS_LABELS_AR[s.health_status]}
                </Badge>
              </td>
              <td className="py-2 tabular-nums text-(--color-ink-muted)">
                {s.consecutive_failures}
              </td>
              <td className="py-2 text-(--color-ink-muted)">
                {s.last_success_at ? formatDateAr(s.last_success_at) : '—'}
              </td>
              <td className="max-w-xs truncate py-2 text-xs text-(--color-ink-subtle)">
                {s.last_failure_reason ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
