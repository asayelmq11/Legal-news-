import { COUNTRIES, type CountryCode } from '@/lib/constants/countries'
import {
  DOCUMENT_TYPE_LABELS_AR,
  LEGAL_CATEGORY_LABELS_AR,
  LEGAL_STATUS_LABELS_AR,
  type DocumentType,
  type LegalCategory,
  type LegalStatus,
} from '@/lib/constants/taxonomy'
import { cn } from '@/lib/utils'

type Tone = 'neutral' | 'brand' | 'ok' | 'warn' | 'danger'

const TONE_CLASS: Record<Tone, string> = {
  neutral: 'bg-(--color-surface-sunken) text-(--color-ink-muted)',
  brand: 'bg-(--color-brand-subtle) text-(--color-brand)',
  ok: 'bg-(--color-ok-subtle) text-(--color-ok)',
  warn: 'bg-(--color-warn-subtle) text-(--color-warn)',
  danger: 'bg-(--color-danger-subtle) text-(--color-danger)',
}

export function Badge({
  children,
  tone = 'neutral',
  title,
}: {
  children: React.ReactNode
  tone?: Tone
  title?: string
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-block rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
        TONE_CLASS[tone],
      )}
    >
      {children}
    </span>
  )
}

export function CountryBadge({ country }: { country: CountryCode }) {
  return <Badge tone="brand">{COUNTRIES[country].nameAr}</Badge>
}

export function CategoryBadge({ category }: { category: LegalCategory }) {
  return <Badge>{LEGAL_CATEGORY_LABELS_AR[category]}</Badge>
}

export function DocumentTypeBadge({ documentType }: { documentType: DocumentType | null }) {
  if (!documentType) return null
  return <Badge>{DOCUMENT_TYPE_LABELS_AR[documentType]}</Badge>
}

/**
 * Legal status carries real meaning for a lawyer scanning a list: something
 * already in force reads differently from a draft or a repealed instrument, so
 * the colours are chosen to make that distinction at a glance rather than to
 * decorate.
 */
const LEGAL_STATUS_TONE: Record<LegalStatus, Tone> = {
  effective: 'ok',
  enacted: 'brand',
  amended: 'warn',
  draft: 'warn',
  pending: 'warn',
  repealed: 'danger',
}

export function LegalStatusBadge({ status }: { status: LegalStatus | null }) {
  if (!status) return null
  return <Badge tone={LEGAL_STATUS_TONE[status]}>{LEGAL_STATUS_LABELS_AR[status]}</Badge>
}
