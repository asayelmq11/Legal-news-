'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { isActivePath, type NavItem } from '@/lib/nav'
import { cn } from '@/lib/utils'

export function AppNav({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname()

  return (
    <nav aria-label="التنقل الرئيسي">
      <ul className="flex flex-wrap items-center gap-1">
        {items.map((item) => {
          const active = isActivePath(pathname, item.href)
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'block rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  active
                    ? 'bg-(--color-brand-subtle) text-(--color-brand)'
                    : 'text-(--color-ink-muted) hover:bg-(--color-surface-sunken) hover:text-(--color-ink)',
                )}
              >
                {item.labelAr}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
