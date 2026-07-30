import Link from 'next/link'

import { SourceForm } from '@/components/admin/source-form'
import { requireAdmin } from '@/lib/auth/session'

export const metadata = { title: 'إضافة مصدر' }

export default async function NewSourcePage() {
  await requireAdmin()
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <nav className="text-sm">
        <Link href="/sources" className="text-(--color-brand) hover:underline">← المصادر</Link>
      </nav>
      <header>
        <h1 className="text-2xl font-bold text-(--color-ink)">إضافة مصدر</h1>
        <p className="text-sm text-(--color-ink-muted)">
          يُنشأ المصدر غير مفعّل وبانتظار التحقق. لا يمكن تفعيله قبل التحقق من الوصول والمحلّل.
        </p>
      </header>
      <SourceForm />
    </div>
  )
}
