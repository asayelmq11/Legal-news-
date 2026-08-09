'use server'

import { requireActiveUser } from '@/lib/auth/session'
import { getServerEnv } from '@/lib/env'
import { getRefreshStatus } from '@/lib/queries/ingestion'
import type { ActionState } from '@/lib/actions/state'

/**
 * The manual "تحديث المستجدات" catch-up refresh.
 *
 * The only ingestion trigger left on the platform (see n8n/README.md). n8n
 * owns everything past the webhook call: computing the catch-up window from
 * the last successful run, the single-flight lock, fetching, classifying and
 * publishing. This module only asks it to start, and later polls whether it
 * finished — it never touches legal_updates or the ingestion pipeline itself.
 */

/**
 * Requests a refresh. n8n answers immediately (202 accepted / 409 already
 * running) without waiting for the underlying crawl+classify+publish run —
 * that keeps this request fast regardless of how long the run itself takes.
 * The caller is expected to start polling checkRefreshStatus() afterwards
 * either way, since "already running" still means one is in flight.
 */
export async function triggerManualRefresh(): Promise<ActionState> {
  const user = await requireActiveUser()
  const env = getServerEnv()

  if (!env.N8N_TRIGGER_WEBHOOK_URL || !env.N8N_TRIGGER_SECRET) {
    return {
      ok: false,
      message: 'ميزة التحديث غير مُفعّلة على هذا الخادم — لم يتم ضبط رابط أو مفتاح التشغيل.',
    }
  }

  let response: Response
  try {
    response = await fetch(env.N8N_TRIGGER_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Trigger-Secret': env.N8N_TRIGGER_SECRET,
      },
      body: JSON.stringify({ requested_by: user.id }),
      cache: 'no-store',
    })
  } catch {
    return { ok: false, message: 'تعذّر الوصول إلى خدمة التحديث. حاول مرة أخرى لاحقاً.' }
  }

  if (response.status === 202) return { ok: true, message: null }
  if (response.status === 409) return { ok: true, message: 'يوجد تحديث قيد التنفيذ بالفعل.' }

  return { ok: false, message: 'تعذّر بدء التحديث. حاول مرة أخرى لاحقاً.' }
}

/** Polled by the dashboard button while a refresh is (or might be) running. */
export async function checkRefreshStatus() {
  await requireActiveUser()
  return getRefreshStatus()
}
