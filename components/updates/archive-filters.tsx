'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRef } from 'react'

import { COUNTRIES, COUNTRY_CODES } from '@/lib/constants/countries'
import { LEGAL_CATEGORIES, LEGAL_CATEGORY_LABELS_AR } from '@/lib/constants/taxonomy'

interface SourceOption {
  id: string
  authority_ar: string
  country: string
}

/**
 * Filter form.
 *
 * A plain GET form: submitting navigates, so the URL is always the single
 * source of truth for what is displayed. That keeps a search shareable and
 * bookmarkable, makes back/forward behave, and means the server re-runs the
 * query rather than the browser holding filtered state.
 *
 * `page` is deliberately not carried over — changing a filter should return to
 * page 1, not leave the reader on page 7 of a different result set.
 */
export function ArchiveFilterPanel({ sources }: { sources: readonly SourceOption[] }) {
  const params = useSearchParams()
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)

  const get = (k: string) => params.get(k) ?? ''
  const getAll = (k: string) => params.getAll(k).flatMap((v) => v.split(','))
  const hasAny = [...params.keys()].some((k) => k !== 'page')

  return (
    <form
      ref={formRef}
      method="get"
      action="/updates"
      className="space-y-4 rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-raised) p-5"
      onSubmit={() => {
        // Nothing to do: the browser performs the GET navigation itself.
      }}
    >
      <div className="space-y-1.5">
        <label htmlFor="q" className="block text-sm font-medium text-(--color-ink)">
          البحث
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={get('q')}
          maxLength={200}
          placeholder="ابحث في العناوين والملخصات…"
          className="w-full rounded-md border border-(--color-border-strong) bg-(--color-surface) px-3 py-2 text-sm outline-none focus:border-(--color-brand)"
        />
        <p className="text-xs text-(--color-ink-subtle)">
          يُطبَّق التطبيع العربي تلقائياً، فلا فرق بين «ضريبة» و«ضريبه» أو بين «أحكام» و«احكام».
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <MultiSelect
          id="country"
          label="الدولة"
          options={COUNTRY_CODES.map((c) => ({ value: c, label: COUNTRIES[c].nameAr }))}
          selected={getAll('country')}
        />
        <MultiSelect
          id="category"
          label="التصنيف"
          options={LEGAL_CATEGORIES.map((c) => ({
            value: c,
            label: LEGAL_CATEGORY_LABELS_AR[c],
          }))}
          selected={getAll('category')}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="source" className="block text-sm font-medium text-(--color-ink)">
          المصدر
        </label>
        <select
          id="source"
          name="source"
          defaultValue={get('source')}
          className="w-full rounded-md border border-(--color-border-strong) bg-(--color-surface) px-3 py-2 text-sm outline-none focus:border-(--color-brand)"
        >
          <option value="">كل المصادر</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.authority_ar}
            </option>
          ))}
        </select>
      </div>

      <DateRange
        label="تاريخ النشر"
        fromName="publishedFrom"
        toName="publishedTo"
        fromValue={get('publishedFrom')}
        toValue={get('publishedTo')}
      />

      <div className="flex items-center gap-2">
        <button
          type="submit"
          className="rounded-md bg-(--color-brand) px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-(--color-brand-hover)"
        >
          تطبيق
        </button>
        {hasAny ? (
          <Link
            href="/updates"
            onClick={() => router.push('/updates')}
            className="rounded-md px-3 py-2 text-sm font-medium text-(--color-ink-muted) hover:bg-(--color-surface-sunken)"
          >
            مسح عوامل التصفية
          </Link>
        ) : null}
      </div>
    </form>
  )
}

function MultiSelect({
  id,
  label,
  options,
  selected,
}: {
  id: string
  label: string
  options: ReadonlyArray<{ value: string; label: string }>
  selected: readonly string[]
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-(--color-ink)">
        {label}
      </label>
      <select
        id={id}
        name={id}
        multiple
        defaultValue={[...selected]}
        size={4}
        className="w-full rounded-md border border-(--color-border-strong) bg-(--color-surface) px-2 py-1.5 text-sm outline-none focus:border-(--color-brand)"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

function DateRange({
  label,
  fromName,
  toName,
  fromValue,
  toValue,
}: {
  label: string
  fromName: string
  toName: string
  fromValue: string
  toValue: string
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium text-(--color-ink)">{label}</legend>
      <div className="flex items-center gap-2">
        <input
          type="date"
          name={fromName}
          defaultValue={fromValue}
          aria-label={`${label} — من`}
          className="w-full rounded-md border border-(--color-border-strong) bg-(--color-surface) px-2 py-1.5 text-sm outline-none focus:border-(--color-brand)"
        />
        <span className="text-xs text-(--color-ink-subtle)">إلى</span>
        <input
          type="date"
          name={toName}
          defaultValue={toValue}
          aria-label={`${label} — إلى`}
          className="w-full rounded-md border border-(--color-border-strong) bg-(--color-surface) px-2 py-1.5 text-sm outline-none focus:border-(--color-brand)"
        />
      </div>
    </fieldset>
  )
}
