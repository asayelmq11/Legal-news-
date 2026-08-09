import Link from 'next/link'

import { BUTTON } from '@/components/ui'

export default function UpdateNotFound() {
  return (
    <div className="mx-auto max-w-lg space-y-4 rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface-raised) p-8 text-center">
      <h1 className="text-lg font-bold text-(--color-ink)">التحديث غير موجود</h1>
      <p className="text-sm leading-relaxed text-(--color-ink-muted)">
        لا يوجد تحديث قانوني بهذا المعرّف في الأرشيف. قد يكون الرابط قديماً أو غير صحيح.
      </p>
      <Link href="/updates" className={BUTTON.primary}>
        العودة إلى الأرشيف
      </Link>
    </div>
  )
}
