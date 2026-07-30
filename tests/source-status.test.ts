import { describe, expect, it } from 'vitest'

import {
  canActivate,
  deriveSourceStatus,
  SOURCE_STATUS_META,
  type ConfigStatus,
  type SourceUiStatus,
} from '@/lib/sources/status'

const ALL_CONFIG_STATUSES: ConfigStatus[] = [
  'pending_verification',
  'verified',
  'blocked_by_access',
  'requires_subscription',
]

describe('source UI status derivation', () => {
  it('reports an active source as active', () => {
    expect(deriveSourceStatus({ active: true, config_status: 'verified' })).toBe('active')
  })

  it('distinguishes deliberately disabled from not-yet-verified', () => {
    expect(deriveSourceStatus({ active: false, config_status: 'verified' })).toBe('disabled')
    expect(deriveSourceStatus({ active: false, config_status: 'pending_verification' })).toBe(
      'pending_verification',
    )
  })

  it('surfaces access obstacles as their own states', () => {
    expect(deriveSourceStatus({ active: false, config_status: 'blocked_by_access' })).toBe(
      'blocked_by_access',
    )
    expect(deriveSourceStatus({ active: false, config_status: 'requires_subscription' })).toBe(
      'requires_subscription',
    )
  })

  it('produces a known status for every stored combination', () => {
    for (const config_status of ALL_CONFIG_STATUSES) {
      for (const active of [true, false]) {
        const status = deriveSourceStatus({ active, config_status })
        expect(SOURCE_STATUS_META[status]).toBeDefined()
      }
    }
  })

  it('labels every status in Arabic', () => {
    const statuses: SourceUiStatus[] = [
      'active',
      'disabled',
      'verified',
      'pending_verification',
      'blocked_by_access',
      'requires_subscription',
    ]
    for (const s of statuses) {
      expect(SOURCE_STATUS_META[s].labelAr.length).toBeGreaterThan(0)
      expect(SOURCE_STATUS_META[s].descriptionAr.length).toBeGreaterThan(0)
    }
  })

  it('marks only the active state as live', () => {
    const live = (Object.keys(SOURCE_STATUS_META) as SourceUiStatus[]).filter(
      (s) => SOURCE_STATUS_META[s].isLive,
    )
    expect(live).toEqual(['active'])
  })

  it('flags the three states that need human action', () => {
    const needing = (Object.keys(SOURCE_STATUS_META) as SourceUiStatus[])
      .filter((s) => SOURCE_STATUS_META[s].needsAction)
      .sort()
    expect(needing).toEqual([
      'blocked_by_access',
      'pending_verification',
      'requires_subscription',
    ])
  })
})

describe('activation eligibility mirrors the database constraint', () => {
  it('permits activating only a verified, inactive source', () => {
    expect(canActivate({ active: false, config_status: 'verified' })).toBe(true)
  })

  it('refuses every non-verified status', () => {
    for (const config_status of ALL_CONFIG_STATUSES) {
      if (config_status === 'verified') continue
      expect(canActivate({ active: false, config_status })).toBe(false)
    }
  })

  it('refuses a source that is already active', () => {
    expect(canActivate({ active: true, config_status: 'verified' })).toBe(false)
  })

  it('refuses the two M3 access-obstacle states specifically', () => {
    // Kuwait Al-Youm and any WAF-blocked source must stay off.
    expect(canActivate({ active: false, config_status: 'requires_subscription' })).toBe(false)
    expect(canActivate({ active: false, config_status: 'blocked_by_access' })).toBe(false)
  })
})
