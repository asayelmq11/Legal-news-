'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'

import { MenuIcon, XIcon } from '@/components/icons'
import { isActivePath, type NavItem } from '@/lib/nav'
import { cn } from '@/lib/utils'

/**
 * Primary/admin items get a quiet underline for the active link — a nav that
 * should recede once the reader is focused on content, not compete with it —
 * with a thin divider separating the two groups. Below `md` this collapses to
 * a single trigger, since the flat wrapped list otherwise breaks into three
 * lines on a phone-width screen.
 */
export function AppNav({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  const primary = items.filter((item) => item.group === 'primary')
  const admin = items.filter((item) => item.group === 'admin')

  return (
    <nav aria-label="التنقل الرئيسي" className="relative">
      <ul className="hidden items-center md:flex">
        {primary.map((item) => (
          <NavLink key={item.href} item={item} active={isActivePath(pathname, item.href)} />
        ))}
        {admin.length > 0 ? (
          <>
            <li aria-hidden="true" className="mx-2 h-4 w-px bg-(--color-border)" />
            {admin.map((item) => (
              <NavLink key={item.href} item={item} active={isActivePath(pathname, item.href)} />
            ))}
          </>
        ) : null}
      </ul>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? 'إغلاق قائمة التنقل' : 'فتح قائمة التنقل'}
        className="flex size-9 items-center justify-center rounded-(--radius-control) text-(--color-ink-muted) transition-colors hover:bg-(--color-surface-sunken) hover:text-(--color-ink) md:hidden"
      >
        {open ? <XIcon className="size-5" /> : <MenuIcon className="size-5" />}
      </button>

      {open ? (
        <ul className="absolute end-0 top-full z-40 mt-2 w-56 space-y-0.5 rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface-raised) p-2 shadow-(--shadow-raised) md:hidden">
          {primary.map((item) => (
            <MobileNavLink
              key={item.href}
              item={item}
              active={isActivePath(pathname, item.href)}
              onNavigate={() => setOpen(false)}
            />
          ))}
          {admin.length > 0 ? (
            <>
              <li aria-hidden="true" className="my-1 h-px bg-(--color-border)" />
              {admin.map((item) => (
                <MobileNavLink
                  key={item.href}
                  item={item}
                  active={isActivePath(pathname, item.href)}
                  onNavigate={() => setOpen(false)}
                />
              ))}
            </>
          ) : null}
        </ul>
      ) : null}
    </nav>
  )
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'block border-b-2 px-2.5 py-1.5 text-sm font-medium transition-colors',
          active
            ? 'border-(--color-brand) text-(--color-ink)'
            : 'border-transparent text-(--color-ink-muted) hover:text-(--color-ink)',
        )}
      >
        {item.labelAr}
      </Link>
    </li>
  )
}

function MobileNavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem
  active: boolean
  onNavigate: () => void
}) {
  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        onClick={onNavigate}
        className={cn(
          'block rounded-(--radius-control) px-3 py-2 text-sm font-medium transition-colors',
          active
            ? 'bg-(--color-brand-subtle) text-(--color-brand)'
            : 'text-(--color-ink-muted) hover:bg-(--color-surface-sunken) hover:text-(--color-ink)',
        )}
      >
        {item.labelAr}
      </Link>
    </li>
  )
}
