import { SourceForm } from '@/components/admin/source-form'
import { BackLink } from '@/components/ui'
import { requireAdmin } from '@/lib/auth/session'

export const metadata = { title: 'إضافة مصدر' }

export default async function NewSourcePage() {
  await requireAdmin()
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <nav className="text-sm">
        <BackLink href="/sources">المصادر</BackLink>
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
