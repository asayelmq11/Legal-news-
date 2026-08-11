import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Badge } from '@/components/badges'
import { ExternalLinkIcon } from '@/components/icons'
import { BackLink, BUTTON } from '@/components/ui'
import { Dot } from '@/components/updates/editorial-row'
import { COUNTRIES } from '@/lib/constants/countries'
import { requireActiveUser } from '@/lib/auth/session'
import { getArchiveItem } from '@/lib/queries/updates'
import { LINK_REJECTION_LABELS_AR, verifySourceLink } from '@/lib/updates/links'
import { formatDateAr } from '@/lib/utils'
import {
  DOCUMENT_TYPE_LABELS_AR,
  LEGAL_CATEGORY_LABELS_AR,
  LEGAL_STATUS_LABELS_AR,
  SOURCE_TYPE_LABELS_AR,
} from '@/lib/constants/taxonomy'

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
    <article className="mx-auto max-w-3xl space-y-10">
      <nav className="text-sm">
        <BackLink href="/updates">العودة إلى الأرشيف</BackLink>
      </nav>

      <header className="space-y-4">
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-(--color-ink-muted)">
          <span>{COUNTRIES[item.country].nameAr}</span>
          <Dot />
          <span>{LEGAL_CATEGORY_LABELS_AR[item.category]}</span>
          {item.document_type ? (
            <>
              <Dot />
              <span>{DOCUMENT_TYPE_LABELS_AR[item.document_type]}</span>
            </>
          ) : null}
          {item.legal_status ? (
            <>
              <Dot />
              <span>{LEGAL_STATUS_LABELS_AR[item.legal_status]}</span>
            </>
          ) : null}
        </p>

        <h1 className="text-2xl leading-relaxed font-bold text-(--color-ink) sm:text-[1.6rem]">
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
        <h2 className="text-xs font-semibold tracking-wide text-(--color-ink-subtle)">الملخص</h2>
        <p className="text-base leading-loose text-(--color-ink)">{item.summary_ar}</p>
        <p className="text-xs text-(--color-ink-subtle)">
          ملخص آلي لأغراض الرصد. النص الرسمي في المصدر هو المرجع عند أي اختلاف.
        </p>
      </section>

      <section className="space-y-3 border-t border-(--color-border) pt-6">
        <h2 className="text-xs font-semibold tracking-wide text-(--color-ink-subtle)">المصدر الرسمي</h2>

        <div className="space-y-1">
          <p className="text-sm font-medium text-(--color-ink)">
            {item.sources?.authority_ar ?? 'جهة غير معروفة'}
            {item.sources ? (
              <>
                <span className="mx-2 text-(--color-border-strong)">·</span>
                <span className="text-(--color-ink-subtle)">{SOURCE_TYPE_LABELS_AR[item.sources.source_type]}</span>
              </>
            ) : null}
          </p>
          {item.sources ? (
            <p className="text-xs text-(--color-ink-subtle)" dir="ltr">
              {item.sources.authority_en}
            </p>
          ) : null}
        </div>

        {link.safe ? (
          <a
            href={link.href}
            target="_blank"
            /* noreferrer as well as noopener: the destination has no need to
               learn that an internal legal platform links to it. */
            rel="noopener noreferrer"
            className={BUTTON.primary}
          >
            فتح المصدر الرسمي
            <ExternalLinkIcon />
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
            className="space-y-2 rounded-(--radius-control) border border-(--color-warn) bg-(--color-warn-subtle) p-3"
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
                <Link href={`/updates?keyword=${encodeURIComponent(k)}`} className="transition-opacity hover:opacity-80">
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
            {item.confidence !== null ? (
              <Meta label="ثقة التصنيف" value={`${(item.confidence * 100).toFixed(0)}%`} />
            ) : null}
            <Meta label="النموذج" value={item.ai_model ?? '—'} />
            <Meta label="بصمة المحتوى" value={item.content_hash?.slice(0, 16) ?? '—'} mono />
            <Meta label="تاريخ الإدراج" value={formatDateAr(item.created_at)} />
            <Meta
              label="طريقة الرصد"
              value={item.origin_type === 'discovery' ? 'اكتشاف' : 'رصد مباشر'}
            />
            {item.discovery_engine ? <Meta label="محرك الاكتشاف" value={item.discovery_engine} /> : null}
          </dl>
          {item.canonical_url ? (
            <p className="mt-2 text-xs text-(--color-ink-subtle)">
              رابط رسمي مُستنتَج:{' '}
              <span className="font-mono" dir="ltr">
                {item.canonical_url}
              </span>
            </p>
          ) : null}
        </Section>
      ) : null}
    </article>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold tracking-wide text-(--color-ink-subtle)">{title}</h2>
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
