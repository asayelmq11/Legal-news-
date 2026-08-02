'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { requireAdmin } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { getServerEnv, isManualTriggerConfigured } from '@/lib/env'
import type { ActionState } from '@/lib/actions/state'

/**
 * Manual runs and dead-letter handling.
 *
 * A manual run does NOT have its own pipeline. It posts to the same n8n
 * ingestion entry point the scheduler uses, so anything it publishes went
 * through the identical parser lanes, AI classification and Publishing Gate. A
 * separate "simplified" path would be a second set of rules to keep in step,
 * and the one that gets used in an emergency is the one least likely to be
 * correct.
 */

const runSchema = z.object({
  scope: z.enum(['source', 'country', 'all', 'url', 'replay', 'drain']),
  sourceId: z.uuid().optional(),
  country: z.enum(['SA', 'AE', 'KW', 'QA', 'BH', 'OM', 'GCC']).optional(),
  url: z.url().optional(),
  deadLetterId: z.uuid().optional(),
  force: z.boolean().default(false),
})

/**
 * Fires the manual-run webhook.
 *
 * Fails closed when the trigger is unconfigured: without both the URL and the
 * secret there is no authenticated way to reach n8n, and firing an
 * unauthenticated request would be worse than doing nothing.
 */
export async function triggerManualRun(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin()

  if (!isManualTriggerConfigured()) {
    return {
      ok: false,
      message:
        'التشغيل اليدوي غير مُهيّأ. يجب ضبط N8N_TRIGGER_WEBHOOK_URL و N8N_TRIGGER_SECRET في بيئة النشر.',
    }
  }

  const parsed = runSchema.safeParse({
    scope: formData.get('scope'),
    sourceId: formData.get('sourceId') || undefined,
    country: formData.get('country') || undefined,
    url: formData.get('url') || undefined,
    deadLetterId: formData.get('deadLetterId') || undefined,
    force: formData.get('force') === 'true',
  })

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'طلب غير صالح' }
  }

  const { scope, sourceId, country, url, deadLetterId, force } = parsed.data

  if (scope === 'source' && !sourceId) return { ok: false, message: 'لم يُحدَّد المصدر' }
  if (scope === 'country' && !country) return { ok: false, message: 'لم تُحدَّد الدولة' }
  if (scope === 'url' && !url) return { ok: false, message: 'لم يُحدَّد الرابط' }
  if (scope === 'replay' && !deadLetterId) return { ok: false, message: 'لم يُحدَّد العنصر' }

  const supabase = await createClient()

  /*
   * Double-submission guard.
   *
   * A source already holding an unexpired lease is reported as
   * already_running rather than queued again — a second concurrent run would
   * duplicate work and race on the same content hashes. `force` overrides it,
   * but only for an admin who deliberately chose to.
   */
  if (scope === 'source' && sourceId && !force) {
    const { data: source } = await supabase
      .from('sources')
      .select('lock_owner, lock_expires_at, authority_ar')
      .eq('id', sourceId)
      .maybeSingle()

    if (source?.lock_expires_at && new Date(source.lock_expires_at) > new Date()) {
      return {
        ok: false,
        message: `«${source.authority_ar}» قيد التشغيل بالفعل حتى ${new Date(source.lock_expires_at).toLocaleTimeString('ar')}. انتظر انتهاءه أو استخدم التشغيل القسري.`,
      }
    }
  }

  // A single, unambiguous id for this run, echoed back and written to
  // workflow_logs by n8n so the UI can follow it.
  const correlationId = crypto.randomUUID()
  const env = getServerEnv()

  try {
    const response = await fetch(env.N8N_TRIGGER_WEBHOOK_URL as string, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Server-side only; never reaches a client bundle.
        'X-Trigger-Secret': env.N8N_TRIGGER_SECRET as string,
      },
      body: JSON.stringify({
        correlation_id: correlationId,
        scope,
        source_id: sourceId ?? null,
        country: country ?? null,
        url: url ?? null,
        dead_letter_id: deadLetterId ?? null,
        force,
        trigger_type: 'manual',
        requested_by: admin.id,
        requested_at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(15_000),
    })

    // n8n answers with a structured contract (ok/status/processed/published/...)
    // documented in n8n/workflows/04-retry-health-manual.json. The HTTP status
    // alone cannot distinguish "started and running" from "ran and published
    // nothing" from "rejected because the source doesn't exist", so the body
    // must be read, not just response.ok.
    let body: Record<string, unknown> | null = null
    try {
      body = await response.json()
    } catch {
      // Non-JSON body (e.g. n8n's own auth-rejection text) — fall through to
      // the status-code-only handling below.
    }

    if (!response.ok) {
      const reason = typeof body?.reason === 'string' ? ` — ${body.reason}` : ''
      return {
        ok: false,
        message: `رفض n8n الطلب (رمز ${response.status})${reason}. راجع سجل التنفيذ في n8n.`,
      }
    }

    if (body && typeof body.status === 'string') {
      if (body.status === 'skipped' || body.status === 'rejected') {
        return {
          ok: true,
          message: `تم التخطي (${typeof body.reason === 'string' ? body.reason : 'قيد التشغيل بالفعل'}). معرّف المتابعة: ${correlationId}`,
        }
      }
      if (body.status === 'empty') {
        return {
          ok: true,
          message: `اكتمل التشغيل دون عناصر جديدة. معرّف المتابعة: ${correlationId}`,
        }
      }
      if (body.status === 'completed') {
        return {
          ok: true,
          message: `اكتمل التشغيل: ${Number(body.published ?? 0)} نُشر، ${Number(body.rejected ?? 0)} مرفوض. معرّف المتابعة: ${correlationId}`,
        }
      }
      if (body.status === 'failed') {
        return {
          ok: false,
          message: `فشل التشغيل. معرّف المتابعة: ${correlationId}. راجع سجل التنفيذ في n8n.`,
        }
      }
    }
  } catch (cause) {
    // The message is an infrastructure detail, not a secret — the URL and key
    // are never included.
    return {
      ok: false,
      message: `تعذّر الاتصال بـ n8n: ${cause instanceof Error ? cause.message : 'خطأ غير معروف'}`,
    }
  }

  revalidatePath('/ops')
  revalidatePath('/sources')
  return {
    ok: true,
    message: `بدأ التشغيل. معرّف المتابعة: ${correlationId}`,
  }
}

/* -------------------------------------------------------------------------- */
/* Dead letters                                                                */
/* -------------------------------------------------------------------------- */

const resolveSchema = z.object({
  id: z.uuid({ error: 'معرّف غير صالح' }),
  note: z.string().trim().min(3, { error: 'سبب المعالجة مطلوب' }).max(2000),
  state: z.enum(['dismissed', 'resolved']),
})

/**
 * Annotates a dead letter as dismissed or resolved.
 *
 * The failure record itself is untouched: error, payload, attempt history and
 * timestamps all stay exactly as written. Only the lifecycle fields change, so
 * "what went wrong last March" remains answerable after somebody closed it.
 */
export async function resolveDeadLetter(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin()

  const parsed = resolveSchema.safeParse({
    id: formData.get('id'),
    note: formData.get('note'),
    state: formData.get('state'),
  })

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'بيانات غير صالحة' }
  }

  const supabase = await createClient()
  const { error, count } = await supabase
    .from('job_dead_letters')
    .update(
      {
        state: parsed.data.state,
        resolution_note: parsed.data.note,
        resolved_at: new Date().toISOString(),
        resolved_by: admin.id,
      },
      { count: 'exact' },
    )
    .eq('id', parsed.data.id)

  if (error) return { ok: false, message: `تعذّر الحفظ: ${error.message}` }
  if ((count ?? 0) === 0) return { ok: false, message: 'لم يُحدَّث أي سجل. تحقق من صلاحيتك.' }

  revalidatePath('/ops')
  return {
    ok: true,
    message: parsed.data.state === 'dismissed' ? 'تم صرف النظر عن العنصر.' : 'تم وسم العنصر كمُعالَج.',
  }
}

/**
 * Releases a stuck lock.
 *
 * Leases expire on their own, so this is only for the case where an admin needs
 * a source back before its TTL elapses. Recorded as an admin action; the run it
 * interrupts is not resumed.
 */
export async function releaseSourceLock(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin()

  const id = String(formData.get('id') ?? '')
  if (!z.uuid().safeParse(id).success) return { ok: false, message: 'معرّف المصدر غير صالح' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('sources')
    .update({
      lock_owner: null,
      lock_acquired_at: null,
      lock_expires_at: null,
      updated_at: new Date().toISOString(),
      updated_by: admin.id,
    })
    .eq('id', id)

  if (error) return { ok: false, message: `تعذّر التحرير: ${error.message}` }

  revalidatePath('/ops')
  return { ok: true, message: 'تم تحرير القفل.' }
}
