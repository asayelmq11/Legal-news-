'use client'

import { useActionState } from 'react'

import { ActionMessage, inputClass, SubmitButton } from '@/components/admin/form-parts'
import { IDLE } from '@/lib/actions/state'
import { updateSetting } from '@/lib/admin/actions'
import type { SettingView } from '@/lib/settings/registry'

/** Serialises a stored JSONB value into the control's text representation. */
function toInputValue(def: SettingView, stored: unknown): string {
  const value = stored ?? def.defaultValue
  switch (def.control) {
    case 'boolean':
      return value === true ? 'true' : 'false'
    case 'string_list':
      return Array.isArray(value) ? value.join('\n') : ''
    case 'json':
      return JSON.stringify(value, null, 2)
    default:
      return String(value ?? '')
  }
}

export function SettingEditor({
  def,
  stored,
  updatedAt,
  updatedByLabel,
}: {
  def: SettingView
  stored: unknown
  updatedAt: string | null
  updatedByLabel: string | null
}) {
  const [state, action] = useActionState(updateSetting, IDLE)
  const value = toInputValue(def, stored)
  const id = `setting-${def.key}`

  return (
    <form
      action={action}
      className="space-y-3 rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-raised) p-5"
    >
      {/* The key is submitted, but it is re-validated against the registry
          server-side — a forged key is refused there, not trusted from here. */}
      <input type="hidden" name="key" value={def.key} />

      <div>
        <label htmlFor={id} className="block text-sm font-medium text-(--color-ink)">
          {def.labelAr}
        </label>
        <p className="mt-0.5 font-mono text-xs text-(--color-ink-subtle)" dir="ltr">
          {def.key}
        </p>
      </div>

      <p className="text-xs leading-relaxed text-(--color-ink-muted)">{def.descriptionAr}</p>

      {def.failClosed ? (
        <p className="rounded-md bg-(--color-warn-subtle) px-3 py-2 text-xs leading-relaxed text-(--color-warn)">
          {def.failClosedNoteAr}
        </p>
      ) : null}

      {def.control === 'boolean' ? (
        <select id={id} name="value" defaultValue={value} className={inputClass}>
          <option value="true">مفعّل</option>
          <option value="false">معطّل</option>
        </select>
      ) : def.control === 'json' || def.control === 'string_list' ? (
        <textarea
          id={id}
          name="value"
          rows={def.control === 'json' ? 7 : 5}
          defaultValue={value}
          className={`${inputClass} font-mono text-xs`}
          dir="ltr"
        />
      ) : (
        <input
          id={id}
          name="value"
          type={def.control === 'number' ? 'number' : 'text'}
          step={def.control === 'number' ? 'any' : undefined}
          defaultValue={value}
          className={inputClass}
          dir="ltr"
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <SubmitButton>حفظ</SubmitButton>
        <p className="text-xs text-(--color-ink-subtle)">
          {updatedAt ? `آخر تعديل ${updatedAt}` : 'لم يُعدَّل بعد'}
          {updatedByLabel ? ` — ${updatedByLabel}` : ''}
        </p>
      </div>

      <ActionMessage state={state} />
    </form>
  )
}
