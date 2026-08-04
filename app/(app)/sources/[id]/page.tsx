import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Badge } from '@/components/badges'
import { SourceControls } from '@/components/admin/source-controls'
import { SourceForm } from '@/components/admin/source-form'
import { requireAdmin } from '@/lib/auth/session'
import { getSource } from '@/lib/admin/queries'
import { verificationBlockers } from '@/lib/admin/source-schema'
import { COUNTRIES } from '@/lib/constants/countries'
import { INGESTION_MODE_LABELS_AR } from '@/lib/constants/taxonomy'
import { SOURCE_STATUS_META, deriveSourceStatus } from '@/lib/sources/status'
import { formatDateAr } from '@/lib/utils'

export const metadata = { title: 'تفاصيل المصدر' }

export default async function SourceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireAdmin()
  const { id } = await params
  const source = await getSource(id)
  if (!source) notFound()

  const ui = deriveSourceStatus(source)
  const meta = SOURCE_STATUS_META[ui]
  const blockers = verificationBlockers({
    parser_type: source.parser_type,
    parser_config: (source.parser_config ?? {}) as Record<string, unknown>,
    feed_url: source.feed_url,
  })

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <nav className="text-sm">
        <Link href="/sources" className="text-(--color-brand) hover:underline">
          ← المصادر
        </Link>
      </nav>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="brand">{COUNTRIES[source.country].nameAr}</Badge>
          <Badge tone={meta.tone}>{meta.labelAr}</Badge>
        </div>
        <h1 className="text-2xl font-bold text-(--color-ink)">{source.authority_ar}</h1>
        <p className="text-sm text-(--color-ink-muted)">{meta.descriptionAr}</p>
      </header>

      {source.requires_authority_check ? (
        <p className="rounded-md border border-(--color-warn) bg-(--color-warn-subtle) px-4 py-3 text-sm text-(--color-ink-muted)">
          <strong className="text-(--color-warn)">يتطلب التحقق من هوية الجهة.</strong> نطاق هذا
          المصدر غير حكومي، ولا يمنح النطاق وحده أي ضمان. تأكد أنه موقع الجهة الحقيقي قبل الوثوق
          بما ينشره.
        </p>
      ) : null}

      {source.config_status === 'requires_subscription' ? (
        <p className="rounded-md border border-(--color-danger) bg-(--color-danger-subtle) px-4 py-3 text-sm text-(--color-ink-muted)">
          <strong className="text-(--color-danger)">يتطلب اشتراكاً.</strong> لم يُحدَّد مسار وصول
          مشروع بعد. لا يجوز الالتفاف على الحماية أو استخدام وسائل وصول غير مصرّح بها — يبقى المصدر
          موقوفاً حتى تُقرّ الإدارة القانونية وسيلة وصول نظامية.
        </p>
      ) : null}

      {source.exclusion_group ? (
        <p className="rounded-md border border-(--color-warn) bg-(--color-warn-subtle) px-4 py-3 text-sm text-(--color-ink-muted)">
          <strong className="text-(--color-warn)">مجموعة استبعاد: {source.exclusion_group}.</strong>{' '}
          قد يكون هذا المصدر نسخة مطابقة لمصدر آخر. يُسمح بتفعيل عضو واحد فقط، لأن بصمة المحتوى تشمل
          الرابط فلا تكتشف الازدواج بين نسختين.
        </p>
      ) : null}

      {blockers.length > 0 ? (
        <div className="rounded-md border border-(--color-border) bg-(--color-surface-sunken) px-4 py-3 text-sm">
          <p className="font-medium text-(--color-ink)">ما ينقص قبل وسمه «تم التحقق»:</p>
          <ul className="mt-1 list-inside list-disc text-(--color-ink-muted)">
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <section className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-raised) p-5">
        <h2 className="mb-4 text-sm font-semibold text-(--color-ink)">التحقق والتفعيل</h2>
        <SourceControls source={source} />
      </section>

      {source.notes ? (
        <section className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-raised) p-5">
          <h2 className="mb-2 text-sm font-semibold text-(--color-ink)">ملاحظات</h2>
          <p className="whitespace-pre-wrap text-sm text-(--color-ink-muted)">{source.notes}</p>
        </section>
      ) : null}

      <section className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-raised) p-5">
        <h2 className="mb-4 text-sm font-semibold text-(--color-ink)">آخر تشغيل</h2>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <Row label="آخر نجاح" value={formatDateAr(source.last_success_at)} />
          <Row label="آخر إخفاق" value={formatDateAr(source.last_failure_at)} />
        </dl>
        {source.last_failure_reason ? (
          <p className="mt-3 font-mono text-xs text-(--color-ink-subtle)" dir="ltr">
            {source.last_failure_reason}
          </p>
        ) : null}
      </section>

      <section className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-raised) p-5">
        <h2 className="mb-4 text-sm font-semibold text-(--color-ink)">
          آلية الوصول <span className="font-normal text-(--color-ink-subtle)">(الاكتشاف الهجين)</span>
        </h2>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <Row label="الوضع" value={INGESTION_MODE_LABELS_AR[source.ingestion_mode]} />
          <Row label="مستوى الثقة" value={source.confidence !== null ? `${source.confidence}%` : '—'} />
          <Row label="طريقة التحقق" value={source.verification_method ?? '—'} />
          <Row label="آخر اكتشاف ناجح" value={formatDateAr(source.last_discovery_success)} />
          <Row label="آخر تأكيد رسمي" value={formatDateAr(source.last_official_success)} />
          <Row label="آخر جلب ناجح للمحلّل" value={formatDateAr(source.last_parser_success)} />
        </dl>
        {source.ingestion_mode === 'discovery' ? (
          <p className="mt-3 text-xs text-(--color-ink-subtle)">
            هذا مصدر اكتشاف، وليس جهة رسمية — يزوّد المرشحين لبوابة النشر عبر تحليل الذكاء الاصطناعي؛
            لا يُنشر منه شيء إلا بعد تصنيف قانوني وتحقق.
          </p>
        ) : null}
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-(--color-ink)">تعديل المصدر</h2>
        <SourceForm source={source} />
      </section>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1.5">
      <dt className="text-(--color-ink-subtle)">{label}:</dt>
      <dd className="text-(--color-ink-muted)">{value}</dd>
    </div>
  )
}
