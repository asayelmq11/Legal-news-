import type { UserRole } from '@/lib/constants/taxonomy'

export interface NavItem {
  readonly href: string
  readonly labelAr: string
  /** Roles permitted to see the link. Admin-only items are omitted for viewers. */
  readonly roles: readonly UserRole[]
  /** Purely presentational grouping — lets the nav visually separate admin-only
   *  links from everyday ones without touching the role guard below. */
  readonly group: 'primary' | 'admin'
}

/**
 * Navigation is filtered by role for clarity, not for security. A viewer who
 * types /sources reaches requireAdmin(), and beneath that RLS refuses the write
 * regardless. Hiding a link is a courtesy; the guard is the control.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', labelAr: 'لوحة المتابعة', roles: ['admin', 'viewer'], group: 'primary' },
  { href: '/updates', labelAr: 'الأرشيف القانوني', roles: ['admin', 'viewer'], group: 'primary' },
  { href: '/sources', labelAr: 'المصادر', roles: ['admin'], group: 'admin' },
  { href: '/users', labelAr: 'المستخدمون', roles: ['admin'], group: 'admin' },
  { href: '/settings', labelAr: 'الإعدادات', roles: ['admin'], group: 'admin' },
]

export function navItemsFor(role: UserRole): readonly NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role))
}

/** True when `pathname` is within `href` — used to mark the active link. */
export function isActivePath(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}
