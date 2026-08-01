/**
 * Password recovery: the fragment parser, the password policy, and the Server
 * Action that sets the new password.
 *
 * The recovery fragment carries a live access token and refresh token. The
 * standing requirement for this flow is that neither ever reaches a log, a
 * form field of ours, or a returned state — so several of these tests assert
 * an absence rather than a behaviour.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abcdefghijklmnopqrst.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key-not-a-jwt'

/* -------------------------------------------------------------------------- */
/* Stubs                                                                       */
/* -------------------------------------------------------------------------- */

let behaviour = {
  user: null as { id: string } | null,
  getUserError: null as { name: string; message: string } | null,
  updateError: null as { name: string; message: string; code?: string; status?: number } | null,
}

const calls = {
  updateUser: [] as { password?: string }[],
  signOut: [] as ({ scope?: string } | undefined)[],
}

const redirects: string[] = []

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => undefined }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    redirects.push(to)
    throw new Error('NEXT_REDIRECT')
  },
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: behaviour.user },
        error: behaviour.getUserError,
      }),
      updateUser: async (attributes: { password?: string }) => {
        calls.updateUser.push(attributes)
        return { data: { user: behaviour.user }, error: behaviour.updateError }
      },
      signOut: async (options?: { scope?: string }) => {
        calls.signOut.push(options)
        return { error: null }
      },
      signInWithPassword: async () => ({ error: null }),
    },
  }),
}))

const { updatePassword } = await import('@/lib/auth/actions')
const { parseRecoveryFragment, summariseFragment, recoveryErrorMessage } = await import(
  '@/lib/auth/recovery'
)
const { describePasswordProblem, updatePasswordSchema, PASSWORD_MIN } = await import(
  '@/lib/auth/password'
)

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

/*
 * Structurally shaped like the real thing so the assertions are meaningful,
 * but not a real token and never was one. The tokens from the exposed link are
 * deliberately absent from this repository.
 */
const FAKE_ACCESS = 'eyJhbGciOiJIUzI1NiJ9.ZmFrZS1hY2Nlc3MtZm9yLXRlc3Rz.not-a-signature'
const FAKE_REFRESH = 'fake-refresh-token-for-tests'
const GOOD = { password: 'correct-horse-99', confirm: 'correct-horse-99' }

beforeEach(() => {
  redirects.length = 0
  calls.updateUser.length = 0
  calls.signOut.length = 0
  behaviour = { user: { id: 'u1' }, getUserError: null, updateError: null }
})

afterEach(() => {
  vi.restoreAllMocks()
})

/* -------------------------------------------------------------------------- */

describe('recovery fragment parsing', () => {
  it('reads a valid recovery fragment', () => {
    const parsed = parseRecoveryFragment(
      `#access_token=${FAKE_ACCESS}&refresh_token=${FAKE_REFRESH}&expires_in=3600&type=recovery`,
    )

    expect(parsed).toEqual({
      kind: 'recovery',
      accessToken: FAKE_ACCESS,
      refreshToken: FAKE_REFRESH,
    })
  })

  it('refuses a fragment that is not a recovery, even with tokens in it', () => {
    // A session arriving from some other flow is not permission to set a
    // password.
    expect(
      parseRecoveryFragment(
        `#access_token=${FAKE_ACCESS}&refresh_token=${FAKE_REFRESH}&type=magiclink`,
      ),
    ).toEqual({ kind: 'none' })
  })

  it('refuses a recovery fragment missing the refresh token', () => {
    expect(parseRecoveryFragment(`#access_token=${FAKE_ACCESS}&type=recovery`)).toEqual({
      kind: 'none',
    })
  })

  it('recognises an expired link', () => {
    expect(parseRecoveryFragment('#error=access_denied&error_code=otp_expired')).toEqual({
      kind: 'error',
      code: 'otp_expired',
    })
    expect(recoveryErrorMessage('otp_expired')).toContain('انتهت صلاحية')
  })

  it('treats an empty fragment as no recovery', () => {
    expect(parseRecoveryFragment('')).toEqual({ kind: 'none' })
    expect(parseRecoveryFragment('#')).toEqual({ kind: 'none' })
  })

  it('SECURITY: the loggable summary of a fragment contains no token', () => {
    const parsed = parseRecoveryFragment(
      `#access_token=${FAKE_ACCESS}&refresh_token=${FAKE_REFRESH}&type=recovery`,
    )
    const rendered = JSON.stringify(summariseFragment(parsed))

    expect(rendered).not.toContain(FAKE_ACCESS)
    expect(rendered).not.toContain(FAKE_REFRESH)
    expect(rendered).not.toContain('eyJ')
    expect(summariseFragment(parsed)).toEqual({ kind: 'recovery', hasTokens: true, code: null })
  })
})

describe('password policy', () => {
  it('rejects a password shorter than the minimum', () => {
    expect(describePasswordProblem('short1', 'short1')).toContain(String(PASSWORD_MIN))
  })

  it('rejects a password with no digit', () => {
    expect(describePasswordProblem('correcthorsebattery', 'correcthorsebattery')).toContain('رقم')
  })

  it('rejects anything past the bcrypt truncation point', () => {
    const tooLong = `${'a'.repeat(72)}1`
    expect(updatePasswordSchema.safeParse({ password: tooLong, confirm: tooLong }).success).toBe(
      false,
    )
  })

  it('rejects a mismatched confirmation', () => {
    expect(describePasswordProblem('correct-horse-99', 'correct-horse-98')).toBe(
      'كلمتا المرور غير متطابقتين',
    )
  })

  it('accepts a compliant pair', () => {
    expect(describePasswordProblem(GOOD.password, GOOD.confirm)).toBeNull()
  })
})

describe('updatePassword — valid recovery session', () => {
  it('sets the password, revokes every session, and returns to login', async () => {
    await expect(updatePassword({ status: 'idle' }, form(GOOD))).rejects.toThrow('NEXT_REDIRECT')

    expect(calls.updateUser).toEqual([{ password: GOOD.password }])
    // Global scope: a recovery link hands a session to anyone holding the
    // email, so the reset has to end that access, not just this tab's.
    expect(calls.signOut).toEqual([{ scope: 'global' }])
    expect(redirects).toEqual(['/login?reset=1'])
  })
})

describe('updatePassword — missing or expired recovery session', () => {
  it('refuses when there is no session at all', async () => {
    behaviour.user = null
    behaviour.getUserError = { name: 'AuthSessionMissingError', message: 'Auth session missing!' }

    const state = await updatePassword({ status: 'idle' }, form(GOOD))

    expect(state).toEqual({ status: 'no_session' })
    expect(calls.updateUser).toEqual([])
    expect(redirects).toEqual([])
  })

  it('refuses when the recovery link has already expired', async () => {
    behaviour.user = null
    behaviour.getUserError = { name: 'AuthApiError', message: 'invalid claim: missing sub claim' }

    const state = await updatePassword({ status: 'idle' }, form(GOOD))

    expect(state.status).toBe('no_session')
    expect(calls.updateUser).toEqual([])
  })
})

describe('updatePassword — invalid input never reaches Supabase', () => {
  it('rejects a mismatched confirmation', async () => {
    const state = await updatePassword(
      { status: 'idle' },
      form({ password: 'correct-horse-99', confirm: 'correct-horse-98' }),
    )

    expect(state).toEqual({ status: 'failed', error: 'كلمتا المرور غير متطابقتين' })
    expect(calls.updateUser).toEqual([])
    expect(redirects).toEqual([])
  })

  it('rejects a weak password', async () => {
    const state = await updatePassword(
      { status: 'idle' },
      form({ password: 'short1', confirm: 'short1' }),
    )

    expect(state.status).toBe('failed')
    expect(calls.updateUser).toEqual([])
  })
})

describe('updatePassword — Supabase refuses the update', () => {
  it('names the same-password case instead of a generic failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    behaviour.updateError = {
      name: 'AuthApiError',
      code: 'same_password',
      status: 422,
      message: 'New password should be different from the old password.',
    }

    const state = await updatePassword({ status: 'idle' }, form(GOOD))

    expect(state).toEqual({
      status: 'failed',
      error: 'كلمة المرور الجديدة مطابقة للحالية. اختر كلمة مرور مختلفة.',
    })
    expect(calls.signOut).toEqual([])
    expect(redirects).toEqual([])
  })
})

describe('SECURITY: nothing sensitive is ever written to a log', () => {
  it('logs no password, token or fragment on the success path', async () => {
    const logged: string[] = []
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(' '))
      })
    }

    await expect(updatePassword({ status: 'idle' }, form(GOOD))).rejects.toThrow('NEXT_REDIRECT')

    const output = logged.join('\n')
    expect(output).not.toContain(GOOD.password)
    expect(output).not.toContain(FAKE_ACCESS)
    expect(output).not.toContain(FAKE_REFRESH)
  })

  it('scrubs a token out of a Supabase error before logging it', async () => {
    const logged: string[] = []
    vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
      logged.push(String(line))
    })

    behaviour.updateError = {
      name: 'AuthApiError',
      code: 'unexpected_failure',
      status: 500,
      // Nothing like this comes back in practice; the point is that if it did,
      // it would not survive to the log.
      message: `token ${FAKE_ACCESS} rejected for admin@legal.internal`,
    }

    const state = await updatePassword({ status: 'idle' }, form(GOOD))

    const output = logged.join('\n')
    expect(output).toContain('name=AuthApiError')
    expect(output).not.toContain(FAKE_ACCESS)
    expect(output).not.toContain('admin@legal.internal')
    expect(output).toContain('<redacted>')

    // And the message shown to the user carries none of it either.
    expect(state.status).toBe('failed')
    expect(state.status === 'failed' && state.error).not.toContain(FAKE_ACCESS)
  })

  it('logs no password when the input is rejected', async () => {
    const logged: string[] = []
    for (const method of ['log', 'info', 'warn', 'error'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(' '))
      })
    }

    await updatePassword({ status: 'idle' }, form({ password: 'weak', confirm: 'weak' }))

    expect(logged.join('\n')).not.toContain('weak')
  })
})
