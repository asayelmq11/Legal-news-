/**
 * The sign-in diagnostics have one hard requirement: they must be safe to leave
 * switched on. Every assertion here is either "this fact is reported" or "this
 * secret is not".
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

import { sanitizeAuthError, isCredentialRejection, countSessionCookies } from '@/lib/auth/debug'

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function b64url(payload: object): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url')
}

/** A legacy Supabase anon key: a JWT carrying `ref` and `role` claims. */
function anonKey(ref: string, role = 'anon'): string {
  return ['header', b64url({ iss: 'supabase', ref, role }), 'signature'].join('.')
}

const REF = 'abcdefghijklmnopqrst'

async function bindingWith(url: string, key: string) {
  vi.resetModules()
  process.env.NEXT_PUBLIC_SUPABASE_URL = url
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = key
  const { describeProjectBinding } = await import('@/lib/auth/project-check')
  return describeProjectBinding()
}

const savedEnv = { ...process.env }

beforeEach(() => {
  process.env = { ...savedEnv }
})

afterEach(() => {
  process.env = { ...savedEnv }
  vi.restoreAllMocks()
})

/* -------------------------------------------------------------------------- */

describe('auth error sanitisation', () => {
  it('reports the four fields that identify a failure', () => {
    const detail = sanitizeAuthError(
      Object.assign(new Error('Invalid API key'), {
        name: 'AuthApiError',
        code: 'invalid_api_key',
        status: 401,
      }),
    )

    expect(detail).toEqual({
      name: 'AuthApiError',
      code: 'invalid_api_key',
      status: 401,
      message: 'Invalid API key',
    })
  })

  it('redacts an email address out of the message', () => {
    const detail = sanitizeAuthError({
      name: 'AuthApiError',
      message: 'User asayel@example.com not found',
    })

    expect(detail.message).toBe('User <redacted> not found')
    expect(detail.message).not.toContain('asayel')
    expect(detail.message).not.toContain('example.com')
  })

  it('redacts anything token-shaped or key-shaped', () => {
    const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9payloadpart'
    const detail = sanitizeAuthError({ name: 'AuthApiError', message: `bad token ${token}` })

    expect(detail.message).toBe('bad token <redacted>')
    expect(detail.message).not.toContain('eyJ')
  })

  it('strips control characters so a message cannot forge a log line', () => {
    const detail = sanitizeAuthError({
      name: 'AuthApiError',
      message: 'oops\n[auth] project binding: match=true',
    })

    expect(detail.message).not.toContain('\n')
  })

  it('caps the message length', () => {
    const detail = sanitizeAuthError({ name: 'AuthApiError', message: 'word '.repeat(200) })

    expect(detail.message.length).toBeLessThanOrEqual(160)
  })

  it('survives a non-error value without throwing', () => {
    expect(sanitizeAuthError(null)).toEqual({
      name: 'Error',
      code: 'none',
      status: null,
      message: '(empty)',
    })
    expect(sanitizeAuthError('boom').name).toBe('Error')
  })
})

describe('credential rejection vs operator problem', () => {
  it('treats a rejected password as routine', () => {
    expect(
      isCredentialRejection(
        sanitizeAuthError({
          name: 'AuthApiError',
          code: 'invalid_credentials',
          status: 400,
          message: 'Invalid login credentials',
        }),
      ),
    ).toBe(true)
  })

  it('does not treat a rejected API key as routine', () => {
    expect(
      isCredentialRejection(
        sanitizeAuthError({
          name: 'AuthApiError',
          code: 'invalid_api_key',
          status: 401,
          message: 'Invalid API key',
        }),
      ),
    ).toBe(false)
  })

  it('does not treat an unreachable host as routine', () => {
    expect(
      isCredentialRejection(
        sanitizeAuthError({ name: 'AuthRetryableFetchError', status: 0, message: 'fetch failed' }),
      ),
    ).toBe(false)
  })

  it('does not treat an unconfirmed email as routine', () => {
    expect(
      isCredentialRejection(
        sanitizeAuthError({
          name: 'AuthApiError',
          code: 'email_not_confirmed',
          status: 400,
          message: 'Email not confirmed',
        }),
      ),
    ).toBe(false)
  })
})

describe('project binding check', () => {
  it('matches when the URL and the anon key name the same project', async () => {
    const binding = await bindingWith(`https://${REF}.supabase.co`, anonKey(REF))

    expect(binding.match).toBe(true)
    expect(binding.urlRef).toBe(binding.keyRef)
    expect(binding.keyRole).toBe('anon')
  })

  it('catches an anon key from a different project', async () => {
    const binding = await bindingWith(`https://${REF}.supabase.co`, anonKey('zzzzzzzzzzzzzzzzzzzz'))

    expect(binding.match).toBe(false)
    expect(binding.urlRef).not.toBe(binding.keyRef)
  })

  it('catches a service-role key pasted where the anon key belongs', async () => {
    const binding = await bindingWith(`https://${REF}.supabase.co`, anonKey(REF, 'service_role'))

    expect(binding.keyRole).toBe('service_role')
  })

  it('reports an unknown binding for the newer non-JWT publishable keys', async () => {
    const binding = await bindingWith(`https://${REF}.supabase.co`, 'sb_publishable_abc123')

    expect(binding.match).toBeNull()
    expect(binding.keyRef).toBe('unknown')
    expect(binding.keyRole).toBe('unknown')
  })

  it('never returns anything from which a ref or a key could be read back', async () => {
    const binding = await bindingWith(`https://${REF}.supabase.co`, anonKey(REF))
    const rendered = JSON.stringify(binding)

    expect(rendered).not.toContain(REF)
    expect(rendered).not.toContain('supabase.co')
    // Truncated digests only.
    expect(binding.urlRef).toMatch(/^[0-9a-f]{8}$/)
    expect(binding.keyRef).toMatch(/^[0-9a-f]{8}$/)
  })
})

describe('session cookie counting stays value-blind', () => {
  it('reports a count and nothing else', () => {
    expect(
      countSessionCookies([
        { name: 'sb-project-auth-token.0' },
        { name: 'sb-project-auth-token.1' },
        { name: 'unrelated' },
      ]),
    ).toBe(2)
  })
})
