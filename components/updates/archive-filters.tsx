'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRef } from 'react'

import { Badge } from '@/components/badges'
import { SearchIcon, XIcon } from '@/components/icons'
import { BUTTON, CONTROL, GroupLabel, Label } from '@/components/ui'
import { COUNTRIES, COUNTRY_CODES } from '@/lib/constants/countries'
import { LEGAL_CATEGORIES, LEGAL_CATEGORY_LABELS_AR } from '@/lib/constants/taxonomy'
import { cn } from '@/lib/utils'

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
 *
 * Country/category are rendered as checkboxes rather than a native
 * multi-select listbox: same field name repeated per checked value, so the
 * query string — and everything `parseArchiveFilters` does with it — is
 * unchanged. Only how the value gets into the URL is different.
 */
export function ArchiveFilterPanel({ sources }: { sources: readonly SourceOption[] }) {
  const params = useSearchParams()
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)

  const get = (k: string) => params.get(k) ?? ''
  const getAll = (k: string) => params.getAll(k).flatMap((v) => v.split(','))
  const hasAny = [...params.keys()].some((k) => k !== 'page')

  const selectedCountry = getAll('country')
  const selectedCategory = getAll('category')
  const activeCount =
    (get('q') ? 1 : 0) +
    selectedCountry.length +
    selectedCategory.length +
    (get('source') ? 1 : 0) +
    (get('publishedFrom') || get('publishedTo') ? 1 : 0)

  return (
    <form
      ref={formRef}
      method="get"
      action="/updates"
      className="space-y-6 rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface-raised) p-5"
      onSubmit={() => {
        // Nothing to do: the browser performs the GET navigation itself.
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-(--color-ink)">تصفية النتائج</h2>
        {activeCount > 0 ? <Badge tone="brand">{activeCount} نشطة</Badge> : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="q">البحث</Label>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute start-3.5 top-1/2 size-5 -translate-y-1/2 text-(--color-ink-subtle)" />
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={get('q')}
            maxLength={200}
            placeholder="ابحث في العناوين والملخصات…"
            className="h-12 w-full rounded-(--radius-control) border border-(--color-border-strong) bg-(--color-surface) py-2 ps-11 pe-3 text-base text-(--color-ink) outline-none transition-colors placeholder:text-(--color-ink-subtle) focus:border-(--color-brand) focus:ring-2 focus:ring-(--color-brand-subtle)"
          />
        </div>
        <p className="text-xs leading-relaxed text-(--color-ink-subtle)">
          يُطبَّق التطبيع العربي تلقائياً، فلا فرق بين «ضريبة» و«ضريبه» أو بين «أحكام» و«احكام».
        </p>
      </div>

      <div className="h-px bg-(--color-border)" />

      <div className="space-y-2.5">
        <GroupLabel>
          الدولة <span className="text-(--color-ink-subtle)">({COUNTRY_CODES.length})</span>
        </GroupLabel>
        <CheckboxGroup
          name="country"
          options={COUNTRY_CODES.map((c) => ({ value: c, label: COUNTRIES[c].nameAr }))}
          selected={selectedCountry}
        />
      </div>

      <Disclosure label="التصنيف" count={LEGAL_CATEGORIES.length} defaultOpen={selectedCategory.length > 0}>
        <CheckboxGroup
          name="category"
          options={LEGAL_CATEGORIES.map((c) => ({ value: c, label: LEGAL_CATEGORY_LABELS_AR[c] }))}
          selected={selectedCategory}
        />
      </Disclosure>

      <div className="h-px bg-(--color-border)" />

      <div className="space-y-1.5">
        <Label htmlFor="source">المصدر</Label>
        <select id="source" name="source" defaultValue={get('source')} className={cn(CONTROL, 'w-full')}>
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

      <div className="flex items-center gap-2 border-t border-(--color-border) pt-4">
        <button type="submit" className={cn(BUTTON.primary, 'flex-1')}>
          تطبيق التصفية
        </button>
        {hasAny ? (
          <Link
            href="/updates"
            onClick={() => router.push('/updates')}
            className={BUTTON.compact}
            aria-label="مسح عوامل التصفية"
            title="مسح عوامل التصفية"
          >
            <XIcon className="size-4" />
            مسح
          </Link>
        ) : null}
      </div>
    </form>
  )
}

function CheckboxGroup({
  name,
  options,
  selected,
}: {
  name: string
  options: ReadonlyArray<{ value: string; label: string }>
  selected: readonly string[]
}) {
  const selectedSet = new Set(selected)

  return (
    <div className="space-y-0.5">
      {options.map((o) => (
        <label
          key={o.value}
          className="flex items-center gap-2.5 rounded-(--radius-control) px-2 py-1.5 text-sm text-(--color-ink-muted) transition-colors hover:bg-(--color-surface-sunken) has-[:checked]:bg-(--color-brand-subtle) has-[:checked]:font-medium has-[:checked]:text-(--color-brand)"
        >
          <input
            type="checkbox"
            name={name}
            value={o.value}
            defaultChecked={selectedSet.has(o.value)}
            className="size-4 shrink-0 rounded-[0.25rem] border-(--color-border-strong) [accent-color:var(--color-brand)]"
          />
          {o.label}
        </label>
      ))}
    </div>
  )
}

/**
 * Native disclosure — no client state needed. `defaultOpen` reflects the
 * server-rendered filter state once; a subsequent manual toggle by the user
 * is left alone because `open` is never re-driven by React after mount.
 */
function Disclosure({
  label,
  count,
  defaultOpen,
  children,
}: {
  label: string
  count: number
  defaultOpen: boolean
  children: React.ReactNode
}) {
  return (
    <details className="group space-y-2.5" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
        <GroupLabel>
          {label} <span className="text-(--color-ink-subtle)">({count})</span>
        </GroupLabel>
        <svg
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
          className="size-3.5 shrink-0 text-(--color-ink-subtle) transition-transform group-open:rotate-180"
        >
          <path d="m5 8 5 5 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      {children}
    </details>
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
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-(--color-ink)">{label}</legend>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label htmlFor={fromName} className="block text-xs text-(--color-ink-subtle)">
            من
          </label>
          <input
            id={fromName}
            type="date"
            name={fromName}
            defaultValue={fromValue}
            className={cn(CONTROL, 'w-full px-2')}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={toName} className="block text-xs text-(--color-ink-subtle)">
            إلى
          </label>
          <input
            id={toName}
            type="date"
            name={toName}
            defaultValue={toValue}
            className={cn(CONTROL, 'w-full px-2')}
          />
        </div>
      </div>
    </fieldset>
  )
}
