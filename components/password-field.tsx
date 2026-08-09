'use client'

import { useState } from 'react'

import { EyeIcon, EyeOffIcon } from '@/components/icons'
import { CONTROL } from '@/components/ui'
import { cn } from '@/lib/utils'

/**
 * A password input with a show/hide toggle. Presentation only — it never
 * changes what gets submitted, just whether the field is masked while typing.
 * `dir="ltr"` wraps both the input and the toggle button so the field's
 * logical start/end resolve against the field's own (Latin) direction rather
 * than the page's, keeping the toggle pinned to the same edge either way.
 */
export function PasswordField({
  id,
  name,
  label,
  autoComplete,
  value,
  onChange,
  required = true,
}: {
  id: string
  name: string
  label: string
  autoComplete: string
  value?: string
  onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void
  required?: boolean
}) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-(--color-ink)">
        {label}
      </label>
      <div className="relative" dir="ltr">
        <input
          id={id}
          name={name}
          type={visible ? 'text' : 'password'}
          required={required}
          autoComplete={autoComplete}
          value={value}
          onChange={onChange}
          className={cn(CONTROL, 'w-full pe-10')}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute end-0 top-0 flex h-10 w-10 items-center justify-center text-(--color-ink-subtle) transition-colors hover:text-(--color-ink)"
          aria-label={visible ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
          aria-pressed={visible}
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
    </div>
  )
}
