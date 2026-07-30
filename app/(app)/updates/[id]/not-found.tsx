import Link from 'next/link'

export default function UpdateNotFound() {
  return (
    <div className="mx-auto max-w-lg space-y-4 rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-raised) p-8 text-center">
      <h1 className="text-lg font-bold text-(--color-ink)">التحديث غير موجود</h1>
      <p className="text-sm leading-relaxed text-(--color-ink-muted)">
        لا يوجد تحديث قانوني بهذا المعرّف في الأرشيف. قد يكون الرابط قديماً أو غير صحيح.
      </p>
      <Link
        href="/updates"
        className="inline-block rounded-md bg-(--color-brand) px-4 py-2 text-sm font-semibold text-white hover:bg-(--color-brand-hover)"
      >
        العودة إلى الأرشيف
      </Link>
    </div>
  )
}
