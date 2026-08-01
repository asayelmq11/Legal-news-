/**
 * The shape a Server Action returns to `useActionState`, and its initial value.
 *
 * These live here rather than beside the actions that use them because a
 * `'use server'` module may export nothing but async functions. Every export
 * from such a file becomes a callable RPC endpoint, so Next.js rejects a plain
 * object at module evaluation:
 *
 *     A "use server" file can only export async functions, found object.
 *
 * The types would survive that check on their own — they are erased before
 * runtime — but keeping the type and its initial value together is what makes
 * the rule easy to remember: nothing that is not an action lives in an action
 * file.
 *
 * tests/server-actions.test.ts enforces this across the repository.
 */
export type ActionState = {
  ok: boolean
  message: string | null
  fieldErrors?: Record<string, string>
}

/** Admin forms — sources, users, settings. */
export const IDLE: ActionState = { ok: false, message: null }

/** Ops forms — manual runs, dead letters, lock release. */
export const OPS_IDLE: ActionState = { ok: false, message: null }
