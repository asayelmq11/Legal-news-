import Link from 'next/link'
import { notFound } from 'next/navigation'

import {
  Badge,
  CategoryBadge,
  CountryBadge,
  DocumentTypeBadge,
  LegalStatusBadge,
} from '@/components/badges'
import { requireActiveUser } from '@/lib/auth/session'
import { getArchiveItem } from '@/lib/queries/updates'
import { LINK_REJECTION_LABELS_AR, verifySourceLink } from '@/lib/updates/links'
import { formatDateAr } from '@/lib/utils'
import { SOURCE_TYPE_LABELS_AR } from '@/lib/constants/taxonomy'

/**
 * Read-only detail view.
 *
 * There is no edit, publish or delete control anywhere on this page, and no
 * Server Action that writes. That is not merely a UI decision: the web
 * application holds no privilege to write legal_updates at all — RLS grants
 * none and the INSERT/UPDATE/DELETE privileges are revoked. n8n is the only
 * writer.
 */
export default async function UpdateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireActiveUser()
  const { id } = await params

  // A malformed id would make Postgres reject the uuid comparison; treating
  // anything unfetchable as 404 avoids leaking whether a row exists.
  const item = await getArchiveItem(id, { isAdmin: user.role === 'admin' })
  if (!item) notFound()

  const isAdmin = user.role === 'admin'
  const link = verifySourceLink(item.source_url, item.sources?.allowed_domains)

  return (
    <article className="mx-auto max-w-3xl space-y-8">
      <nav className="text-sm">
        <Link href="/updates" className="text-(--color-brand) hover:underline">
          ← العودة إلى الأرشيف
        </Link>
      </nav>

      <header className="space-y-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <CountryBadge country={item.country} />
          <CategoryBadge category={item.category} />
          <DocumentTypeBadge documentType={item.document_type} />
          <LegalStatusBadge status={item.legal_status} />
        </div>

        <h1 className="text-2xl font-bold leading-relaxed text-(--color-ink)">
          {item.title_ar}
        </h1>

        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-(--color-ink-subtle)">
          <div className="flex gap-1.5">
            <dt>تاريخ النشر:</dt>
            <dd className="font-medium text-(--color-ink-muted)">
              <time dateTime={item.publication_date}>{formatDateAr(item.publication_date)}</time>
            </dd>
          </div>
          <div className="flex gap-1.5">
            <dt>تاريخ النفاذ:</dt>
            <dd className="font-medium text-(--color-ink-muted)">
              {item.effective_date ? (
                <time dateTime={item.effective_date}>{formatDateAr(item.effective_date)}</time>
              ) : (
                <span title="لم تحدد الجهة تاريخ نفاذ، ولا يستنتجه النظام">غير محدد</span>
              )}
            </dd>
          </div>
        </dl>
      </header>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-(--color-ink-muted)">الملخص</h2>
        <p className="text-base leading-loose text-(--color-ink)">{item.summary_ar}</p>
        <p className="text-xs text-(--color-ink-subtle)">
          ملخص آلي لأغراض الرصد. النص الرسمي في المصدر هو المرجع عند أي اختلاف.
        </p>
      </section>

      <section className="space-y-3 rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-raised) p-5">
        <h2 className="text-sm font-semibold text-(--color-ink-muted)">المصدر الرسمي</h2>

        <div className="space-y-1">
          <p className="text-sm font-medium text-(--color-ink)">
            {item.sources?.authority_ar ?? 'جهة غير معروفة'}
          </p>
          {item.sources ? (
            <p className="text-xs text-(--color-ink-subtle)" dir="ltr">
              {item.sources.authority_en}
            </p>
          ) : null}
          {item.sources ? (
            <Badge>{SOURCE_TYPE_LABELS_AR[item.sources.source_type]}</Badge>
          ) : null}
        </div>

        {link.safe ? (
          <a
            href={link.href}
            target="_blank"
            /* noreferrer as well as noopener: the destination has no need to
               learn that an internal legal platform links to it. */
            rel="noopener noreferrer"
            className="inline-block rounded-md bg-(--color-brand) px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-(--color-brand-hover)"
          >
            فتح المصدر الرسمي ↗
          </a>
        ) : (
          /*
            The stored URL failed re-validation against the source's current
            allow-list. Rendering it as a live link would send a lawyer to an
            unverified destination on the strength of an official-looking page,
            so the link is disabled and the reason stated.
          */
          <div
            role="alert"
            className="space-y-2 rounded-md border border-(--color-warn) bg-(--color-warn-subtle) p-3"
          >
            <p className="text-sm font-medium text-(--color-warn)">
              الرابط الأصلي غير متاح
            </p>
            <p className="text-xs leading-relaxed text-(--color-ink-muted)">
              {LINK_REJECTION_LABELS_AR[link.reason]}
            </p>
            {link.hostname ? (
              <p className="font-mono text-xs text-(--color-ink-subtle)" dir="ltr">
                {link.hostname}
              </p>
            ) : null}
          </div>
        )}

        {item.document_path ? (
          <p className="text-xs text-(--color-ink-muted)">
            توجد نسخة محفوظة من الوثيقة في الأرشيف الداخلي.
            <span className="mx-1 font-mono text-(--color-ink-subtle)" dir="ltr">
              {item.document_path}
            </span>
          </p>
        ) : null}
      </section>

      {item.affected_entities.length > 0 ? (
        <Section title="الجهات المتأثرة">
          <ul className="flex flex-wrap gap-1.5">
            {item.affected_entities.map((e) => (
              <li key={e}>
                <Badge>{e}</Badge>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {item.keywords.length > 0 ? (
        <Section title="الكلمات المفتاحية">
          <ul className="flex flex-wrap gap-1.5">
            {item.keywords.map((k) => (
              <li key={k}>
                <Link href={`/updates?keyword=${encodeURIComponent(k)}`}>
                  <Badge tone="brand">{k}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {/* Administrative metadata. Not selected from the database at all for a
          viewer, so there is nothing here to conditionally hide. */}
      {isAdmin && item.confidence !== undefined ? (
        <Section title="بيانات التصنيف (للمسؤولين)">
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <Meta label="ثقة التصنيف" value={`${(item.confidence * 100).toFixed(0)}%`} />
            <Meta label="النموذج" value={item.ai_model ?? '—'} />
            <Meta label="بصمة المحتوى" value={item.content_hash?.slice(0, 16) ?? '—'} mono />
            <Meta label="تاريخ الإدراج" value={formatDateAr(item.created_at)} />
          </dl>
        </Section>
      ) : null}
    </article>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-(--color-ink-muted)">{title}</h2>
      {children}
    </section>
  )
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-1.5">
      <dt className="text-(--color-ink-subtle)">{label}:</dt>
      <dd className={mono ? 'font-mono text-(--color-ink-muted)' : 'text-(--color-ink-muted)'} dir={mono ? 'ltr' : undefined}>
        {value}
      </dd>
    </div>
  )
}
