'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'

import { Badge } from '@/components/badges'
import { ChevronIcon, SearchIcon } from '@/components/icons'
import { CONTENT_TYPE_KEYS, CONTENT_TYPE_LABELS_AR } from '@/lib/constants/content-type'
import { COUNTRIES, COUNTRY_CODES } from '@/lib/constants/countries'
import { LEGAL_CATEGORIES, LEGAL_CATEGORY_LABELS_AR } from '@/lib/constants/taxonomy'
import { MAX_PAGE_SIZE, PAGE_SIZE } from '@/lib/updates/filters'
import { cn } from '@/lib/utils'

interface SourceOption {
  id: string
  authority_ar: string
  country: string
}

/**
 * GCC is a real `country` value (the Secretariat's own content) so it stays
 * in `COUNTRY_CODES` everywhere else — badges, query validation, the admin
 * source form. It is deliberately absent only from this filter's own option
 * list: alongside SA/AE/KW/QA/BH/OM it read as a seventh member state rather
 * than the council itself. GCC-tagged items are unaffected and still appear
 * in the unfiltered archive and search.
 */
const FILTERABLE_COUNTRY_CODES = COUNTRY_CODES.filter((c) => c !== 'GCC')

const DATE_PRESETS = [
  { key: 'today', label: 'اليوم', days: 0 },
  { key: '7d', label: 'آخر 7 أيام', days: 6 },
  { key: '30d', label: 'آخر 30 يوم', days: 29 },
] as const

/**
 * Horizontal filter toolbar: one dropdown per dimension (country, category,
 * source, date), each a self-contained popover over the exact same GET form
 * `archive-filters.tsx` (pre-redesign) used — same field `name`s, same
 * `/updates` action, same `parseArchiveFilters`/`buildArchiveQuery` on the
 * other end. Only the chrome around those fields changed: a vertical
 * always-open sidebar became compact triggers that auto-submit on change
 * (`requestSubmit`), so there's no separate "apply" button to hunt for and no
 * JS-disabled dead end — the search field's submit button is the form's real
 * `type="submit"`, so Enter/no-JS still works.
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
  const selectedContentType = getAll('contentType')
  const selectedSource = get('source')
  const publishedFrom = get('publishedFrom')
  const publishedTo = get('publishedTo')
  const dateActive = Boolean(publishedFrom || publishedTo)
  const pageSize = get('pageSize')
  const pageSizeActive = pageSize !== '' && pageSize !== String(PAGE_SIZE)

  const submit = () => formRef.current?.requestSubmit()

  return (
    <form ref={formRef} method="get" action="/updates" className="space-y-3">
      <div className="relative">
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={get('q')}
          maxLength={200}
          placeholder="ابحث في العناوين والملخصات…"
          className="h-11 w-full rounded-(--radius-control) border border-(--color-border-strong) bg-(--color-surface) py-2 ps-11 pe-3 text-sm text-(--color-ink) outline-none transition-colors placeholder:text-(--color-ink-subtle) focus:border-(--color-brand) focus:ring-2 focus:ring-(--color-brand-subtle)"
        />
        <button
          type="submit"
          aria-label="بحث"
          className="absolute inset-y-0 start-0 flex w-11 items-center justify-center text-(--color-ink-subtle) transition-colors hover:text-(--color-brand)"
        >
          <SearchIcon className="size-5" />
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <FilterDropdown label="نوع المحتوى" count={selectedContentType.length}>
            <CheckboxGroup
              name="contentType"
              options={CONTENT_TYPE_KEYS.map((k) => ({ value: k, label: CONTENT_TYPE_LABELS_AR[k] }))}
              selected={selectedContentType}
              onChange={submit}
            />
          </FilterDropdown>

          <FilterDropdown label="المجال القانوني" count={selectedCategory.length}>
            <SearchableCheckboxGroup
              name="category"
              options={LEGAL_CATEGORIES.map((c) => ({ value: c, label: LEGAL_CATEGORY_LABELS_AR[c] }))}
              selected={selectedCategory}
              onChange={submit}
            />
          </FilterDropdown>

          <FilterDropdown label="الدولة" count={selectedCountry.length}>
            <CheckboxGroup
              name="country"
              options={FILTERABLE_COUNTRY_CODES.map((c) => ({ value: c, label: COUNTRIES[c].nameAr }))}
              selected={selectedCountry}
              onChange={submit}
            />
          </FilterDropdown>

          <FilterDropdown label="المصدر" count={selectedSource ? 1 : 0}>
            <SearchableSourceList sources={sources} selected={selectedSource} onChange={submit} />
          </FilterDropdown>

          <FilterDropdown label="تاريخ النشر" count={dateActive ? 1 : 0}>
            <DateFilter from={publishedFrom} to={publishedTo} onChange={submit} />
          </FilterDropdown>

          <FilterDropdown label="المزيد من الفلاتر" count={pageSizeActive ? 1 : 0}>
            <PageSizeFilter value={pageSize || String(PAGE_SIZE)} onChange={submit} />
          </FilterDropdown>
        </div>

        {hasAny ? (
          <Link
            href="/updates"
            onClick={() => router.push('/updates')}
            className="text-sm font-medium text-(--color-ink-muted) transition-colors hover:text-(--color-brand)"
          >
            إعادة تعيين الفلاتر
          </Link>
        ) : null}
      </div>
    </form>
  )
}

/**
 * A single toolbar trigger + its popover panel. Closes on outside click and
 * Escape — the one bit of behaviour native `<details>` doesn't give for
 * free — but stays inside the shared `<form>` above, so every field inside
 * still submits as part of the one archive query.
 */
function FilterDropdown({
  label,
  count,
  children,
}: {
  label: string
  count: number
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          'flex h-10 items-center gap-1.5 rounded-(--radius-control) border px-3 text-sm font-medium transition-colors',
          count > 0
            ? 'border-(--color-brand) bg-(--color-brand-subtle) text-(--color-brand)'
            : 'border-(--color-border-strong) text-(--color-ink-muted) hover:bg-(--color-surface-sunken) hover:text-(--color-ink)',
        )}
      >
        {label}
        {count > 0 ? <Badge tone="brand">{count}</Badge> : null}
        <ChevronIcon className={cn('size-3.5 rotate-90 transition-transform', open && '-rotate-90')} />
      </button>

      {open ? (
        <div
          role="dialog"
          className="absolute top-full z-30 mt-2 w-72 rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface-raised) p-3 shadow-(--shadow-raised)"
        >
          {children}
        </div>
      ) : null}
    </div>
  )
}

function CheckboxGroup({
  name,
  options,
  selected,
  onChange,
}: {
  name: string
  options: ReadonlyArray<{ value: string; label: string }>
  selected: readonly string[]
  onChange: () => void
}) {
  const selectedSet = new Set(selected)

  return (
    <div className="max-h-72 space-y-0.5 overflow-y-auto">
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
            onChange={onChange}
            className="size-4 shrink-0 rounded-[0.25rem] border-(--color-border-strong) [accent-color:var(--color-brand)]"
          />
          {o.label}
        </label>
      ))}
    </div>
  )
}

function SearchableCheckboxGroup({
  name,
  options,
  selected,
  onChange,
}: {
  name: string
  options: ReadonlyArray<{ value: string; label: string }>
  selected: readonly string[]
  onChange: () => void
}) {
  const [query, setQuery] = useState('')
  const filtered = useMemo(
    () => options.filter((o) => o.label.includes(query.trim())),
    [options, query],
  )
  const selectedSet = new Set(selected)

  return (
    <div className="space-y-2">
      <SearchBox value={query} onChange={setQuery} placeholder="ابحث في التصنيفات…" />
      {/* Selected-but-filtered-out options stay in the form as hidden fields,
          so typing a search query never silently drops an existing selection. */}
      {selected
        .filter((v) => !filtered.some((o) => o.value === v))
        .map((v) => (
          <input key={v} type="hidden" name={name} value={v} />
        ))}
      <div className="max-h-64 space-y-0.5 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="px-2 py-3 text-center text-xs text-(--color-ink-subtle)">لا نتائج</p>
        ) : (
          filtered.map((o) => (
            <label
              key={o.value}
              className="flex items-center gap-2.5 rounded-(--radius-control) px-2 py-1.5 text-sm text-(--color-ink-muted) transition-colors hover:bg-(--color-surface-sunken) has-[:checked]:bg-(--color-brand-subtle) has-[:checked]:font-medium has-[:checked]:text-(--color-brand)"
            >
              <input
                type="checkbox"
                name={name}
                value={o.value}
                defaultChecked={selectedSet.has(o.value)}
                onChange={onChange}
                className="size-4 shrink-0 rounded-[0.25rem] border-(--color-border-strong) [accent-color:var(--color-brand)]"
              />
              {o.label}
            </label>
          ))
        )}
      </div>
    </div>
  )
}

function SearchableSourceList({
  sources,
  selected,
  onChange,
}: {
  sources: readonly SourceOption[]
  selected: string
  onChange: () => void
}) {
  const [query, setQuery] = useState('')
  const filtered = useMemo(
    () => sources.filter((s) => s.authority_ar.includes(query.trim())),
    [sources, query],
  )

  return (
    <div className="space-y-2">
      <SearchBox value={query} onChange={setQuery} placeholder="ابحث في المصادر…" />
      <div className="max-h-64 space-y-0.5 overflow-y-auto">
        <label className="flex items-center gap-2.5 rounded-(--radius-control) px-2 py-1.5 text-sm text-(--color-ink-muted) transition-colors hover:bg-(--color-surface-sunken) has-[:checked]:bg-(--color-brand-subtle) has-[:checked]:font-medium has-[:checked]:text-(--color-brand)">
          <input
            type="radio"
            name="source"
            value=""
            defaultChecked={!selected}
            onChange={onChange}
            className="size-4 shrink-0 border-(--color-border-strong) [accent-color:var(--color-brand)]"
          />
          كل المصادر
        </label>
        {filtered.length === 0 ? (
          <p className="px-2 py-3 text-center text-xs text-(--color-ink-subtle)">لا نتائج</p>
        ) : (
          filtered.map((s) => (
            <label
              key={s.id}
              className="flex items-center gap-2.5 rounded-(--radius-control) px-2 py-1.5 text-sm text-(--color-ink-muted) transition-colors hover:bg-(--color-surface-sunken) has-[:checked]:bg-(--color-brand-subtle) has-[:checked]:font-medium has-[:checked]:text-(--color-brand)"
            >
              <input
                type="radio"
                name="source"
                value={s.id}
                defaultChecked={selected === s.id}
                onChange={onChange}
                className="size-4 shrink-0 border-(--color-border-strong) [accent-color:var(--color-brand)]"
              />
              <span className="truncate">{s.authority_ar}</span>
            </label>
          ))
        )}
      </div>
    </div>
  )
}

function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  return (
    <div className="relative">
      <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-(--color-ink-subtle)" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 w-full rounded-(--radius-control) border border-(--color-border) bg-(--color-surface) ps-8 pe-2 text-xs text-(--color-ink) outline-none focus:border-(--color-brand)"
      />
    </div>
  )
}

function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

function DateFilter({
  from,
  to,
  onChange,
}: {
  from: string
  to: string
  onChange: () => void
}) {
  const [custom, setCustom] = useState(() => {
    if (!from && !to) return false
    return !DATE_PRESETS.some((p) => from === isoDaysAgo(p.days) && to === isoDaysAgo(0))
  })
  const today = isoDaysAgo(0)

  return (
    <div className="space-y-3">
      <div className="space-y-0.5">
        {/* Uncontrolled (defaultChecked), like every other filter here: the DOM
            owns the checked state once rendered, so a click shows as checked
            immediately rather than waiting on the page-nav round trip that
            actually applies it — a `checked` prop tied to the URL would fight
            the user's click until that navigation lands. */}
        {DATE_PRESETS.map((preset) => {
          const presetFrom = isoDaysAgo(preset.days)
          const active = !custom && from === presetFrom && to === today
          return (
            <label
              key={preset.key}
              className="flex items-center gap-2.5 rounded-(--radius-control) px-2 py-1.5 text-sm text-(--color-ink-muted) transition-colors hover:bg-(--color-surface-sunken) has-[:checked]:bg-(--color-brand-subtle) has-[:checked]:font-medium has-[:checked]:text-(--color-brand)"
            >
              <input
                type="radio"
                name="publishedFrom"
                value={presetFrom}
                defaultChecked={active}
                onChange={() => {
                  setCustom(false)
                  onChange()
                }}
                className="size-4 shrink-0 border-(--color-border-strong) [accent-color:var(--color-brand)]"
              />
              {preset.label}
            </label>
          )
        })}
        <label className="flex items-center gap-2.5 rounded-(--radius-control) px-2 py-1.5 text-sm text-(--color-ink-muted) transition-colors hover:bg-(--color-surface-sunken) has-[:checked]:bg-(--color-brand-subtle) has-[:checked]:font-medium has-[:checked]:text-(--color-brand)">
          <input
            type="radio"
            name="__date_mode"
            defaultChecked={custom}
            onChange={() => setCustom(true)}
            className="size-4 shrink-0 border-(--color-border-strong) [accent-color:var(--color-brand)]"
          />
          نطاق مخصص
        </label>
      </div>

      {custom ? (
        <div className="grid grid-cols-2 gap-2 border-t border-(--color-border) pt-3">
          <div className="space-y-1">
            <label htmlFor="publishedFrom" className="block text-xs text-(--color-ink-subtle)">
              من
            </label>
            <input
              id="publishedFrom"
              type="date"
              name="publishedFrom"
              defaultValue={from}
              onChange={onChange}
              className="h-9 w-full rounded-(--radius-control) border border-(--color-border-strong) bg-(--color-surface) px-2 text-xs text-(--color-ink) outline-none focus:border-(--color-brand)"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="publishedTo" className="block text-xs text-(--color-ink-subtle)">
              إلى
            </label>
            <input
              id="publishedTo"
              type="date"
              name="publishedTo"
              defaultValue={to}
              onChange={onChange}
              className="h-9 w-full rounded-(--radius-control) border border-(--color-border-strong) bg-(--color-surface) px-2 text-xs text-(--color-ink) outline-none focus:border-(--color-brand)"
            />
          </div>
        </div>
      ) : (
        // A preset still needs its own publishedTo submitted — a plain hidden
        // input rather than another radio group, always "today".
        <input type="hidden" name="publishedTo" value={today} disabled={custom} />
      )}
    </div>
  )
}

function PageSizeFilter({ value, onChange }: { value: string; onChange: () => void }) {
  const options = [10, 20, 30, 50].filter((n) => n <= MAX_PAGE_SIZE)
  return (
    <div className="space-y-1">
      <p className="px-1 pb-1 text-xs text-(--color-ink-subtle)">عدد النتائج بالصفحة</p>
      {options.map((n) => (
        <label
          key={n}
          className="flex items-center gap-2.5 rounded-(--radius-control) px-2 py-1.5 text-sm text-(--color-ink-muted) transition-colors hover:bg-(--color-surface-sunken) has-[:checked]:bg-(--color-brand-subtle) has-[:checked]:font-medium has-[:checked]:text-(--color-brand)"
        >
          <input
            type="radio"
            name="pageSize"
            value={n}
            defaultChecked={value === String(n)}
            onChange={onChange}
            className="size-4 shrink-0 border-(--color-border-strong) [accent-color:var(--color-brand)]"
          />
          {n}
        </label>
      ))}
    </div>
  )
}
