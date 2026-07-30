import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

import { isPublicPath } from '@/lib/supabase/proxy'
import { isActivePath, navItemsFor, NAV_ITEMS } from '@/lib/nav'
import { isAdmin } from '@/lib/auth/session'
import type { AppUser } from '@/lib/auth/session'

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

function user(overrides: Partial<AppUser> = {}): AppUser {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    email: 'user@legal.internal',
    full_name: 'مستخدم',
    role: 'viewer',
    active: true,
    created_at: new Date(0).toISOString(),
    ...overrides,
  }
}

/* -------------------------------------------------------------------------- */

describe('public path allow-list', () => {
  it('permits only the login and auth-callback routes', () => {
    expect(isPublicPath('/login')).toBe(true)
    expect(isPublicPath('/auth/callback')).toBe(true)
  })

  it('protects every application route', () => {
    for (const path of ['/', '/updates', '/updates/abc', '/sources', '/users', '/settings']) {
      expect(isPublicPath(path)).toBe(false)
    }
  })

  it('is not fooled by a prefix that merely starts with a public path', () => {
    // "/loginsomething" must NOT be treated as public.
    expect(isPublicPath('/loginsomething')).toBe(false)
    expect(isPublicPath('/login-bypass')).toBe(false)
    expect(isPublicPath('/auth/callbackevil')).toBe(false)
  })

  it('treats sub-paths of a public route as public', () => {
    expect(isPublicPath('/login/reset')).toBe(true)
  })
})

describe('role guard', () => {
  it('recognises an active admin', () => {
    expect(isAdmin(user({ role: 'admin' }))).toBe(true)
  })

  it('refuses a viewer', () => {
    expect(isAdmin(user({ role: 'viewer' }))).toBe(false)
  })

  it('refuses a DEACTIVATED admin — active is checked, not just role', () => {
    expect(isAdmin(user({ role: 'admin', active: false }))).toBe(false)
  })

  it('refuses null and undefined', () => {
    expect(isAdmin(null)).toBe(false)
    expect(isAdmin(undefined)).toBe(false)
  })
})

describe('role-aware navigation', () => {
  it('hides admin sections from a viewer', () => {
    const hrefs = navItemsFor('viewer').map((i) => i.href)
    expect(hrefs).toEqual(['/', '/updates', '/newsletters'])
    expect(hrefs).not.toContain('/sources')
    expect(hrefs).not.toContain('/users')
    expect(hrefs).not.toContain('/settings')
  })

  it('shows every section to an admin', () => {
    expect(navItemsFor('admin')).toHaveLength(NAV_ITEMS.length)
  })

  it('marks the active link without matching sibling prefixes', () => {
    expect(isActivePath('/updates', '/updates')).toBe(true)
    expect(isActivePath('/updates/abc', '/updates')).toBe(true)
    // "/" must not light up for every route
    expect(isActivePath('/updates', '/')).toBe(false)
    expect(isActivePath('/', '/')).toBe(true)
    // a longer sibling must not match
    expect(isActivePath('/users', '/updates')).toBe(false)
  })
})

/* -------------------------------------------------------------------------- */
/* Open-redirect protection on the post-login destination                      */
/* -------------------------------------------------------------------------- */

describe('post-login redirect target', () => {
  // Mirrors safeNext() in lib/auth/actions.ts, which is module-private.
  function safeNext(value: string | undefined): string {
    if (!value) return '/'
    if (!value.startsWith('/') || value.startsWith('//')) return '/'
    return value
  }

  it('keeps a relative in-app path', () => {
    expect(safeNext('/updates')).toBe('/updates')
    expect(safeNext('/sources')).toBe('/sources')
  })

  it('rejects an absolute URL to another origin', () => {
    expect(safeNext('https://evil.example/steal')).toBe('/')
    expect(safeNext('http://evil.example')).toBe('/')
  })

  it('rejects a protocol-relative URL', () => {
    // "//evil.example" is a valid absolute URL to a different host.
    expect(safeNext('//evil.example')).toBe('/')
  })

  it('falls back to the dashboard when absent', () => {
    expect(safeNext(undefined)).toBe('/')
    expect(safeNext('')).toBe('/')
  })
})

/* -------------------------------------------------------------------------- */
/* Environment validation — fails closed                                       */
/* -------------------------------------------------------------------------- */

describe('server environment', () => {
  const ORIGINAL = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    process.env = { ...ORIGINAL }
  })

  it('throws when the Supabase URL is missing, naming the variable', async () => {
    process.env = { ...ORIGINAL }
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    const { getServerEnv } = await import('@/lib/env')
    expect(() => getServerEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/)
  })

  it('throws when the anon key is empty', async () => {
    process.env = { ...ORIGINAL, NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co' }
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ''
    const { getServerEnv } = await import('@/lib/env')
    expect(() => getServerEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY/)
  })

  it('accepts a valid configuration', async () => {
    process.env = {
      ...ORIGINAL,
      NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
    }
    const { getServerEnv } = await import('@/lib/env')
    expect(getServerEnv().NEXT_PUBLIC_SUPABASE_URL).toBe('https://x.supabase.co')
  })

  it('reports the manual trigger as unconfigured when the secret is absent', async () => {
    process.env = {
      ...ORIGINAL,
      NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
    }
    delete process.env.N8N_TRIGGER_WEBHOOK_URL
    delete process.env.N8N_TRIGGER_SECRET
    const { isManualTriggerConfigured } = await import('@/lib/env')
    expect(isManualTriggerConfigured()).toBe(false)
  })

  it('rejects a trigger secret that is too short to be meaningful', async () => {
    process.env = {
      ...ORIGINAL,
      NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      N8N_TRIGGER_WEBHOOK_URL: 'https://n8n.internal/webhook/x',
      N8N_TRIGGER_SECRET: 'short',
    }
    const { getServerEnv } = await import('@/lib/env')
    expect(() => getServerEnv()).toThrow(/N8N_TRIGGER_SECRET/)
  })
})
