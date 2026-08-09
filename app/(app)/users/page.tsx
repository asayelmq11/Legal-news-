import { CreateUserForm, UserRow_ } from '@/components/admin/user-controls'
import { requireAdmin } from '@/lib/auth/session'
import { listUsers } from '@/lib/admin/queries'

export const metadata = { title: 'المستخدمون' }

export default async function UsersPage() {
  const admin = await requireAdmin()
  const { rows, error } = await listUsers()

  const activeAdmins = rows.filter((u) => u.role === 'admin' && u.active).length

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="text-2xl font-bold text-(--color-ink)">المستخدمون</h1>
        <p className="text-sm text-(--color-ink-muted)">
          الوصول ممنوح بقرار إداري فقط. من ليس له ملف هنا لا يرى شيئاً في المنصة.
        </p>
      </header>

      {error ? (
        <p role="alert" className="rounded-(--radius-control) bg-(--color-danger-subtle) px-3 py-2 text-sm text-(--color-danger)">
          تعذّر تحميل المستخدمين: {error}
        </p>
      ) : null}

      {activeAdmins <= 1 ? (
        <p className="rounded-(--radius-control) border border-(--color-warn) bg-(--color-warn-subtle) px-4 py-3 text-sm text-(--color-ink-muted)">
          <strong className="text-(--color-warn)">يوجد مسؤول فعّال واحد فقط.</strong> لا يمكن إيقافه
          أو خفض صلاحيته حتى يُعيَّن مسؤول آخر، وإلا تعذّرت إدارة المنصة نهائياً.
        </p>
      ) : null}

      <section className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface-raised) p-5 sm:p-6">
        <h2 className="mb-4 text-sm font-semibold text-(--color-ink)">إضافة ملف مستخدم</h2>
        <CreateUserForm />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-(--color-ink)">
          المستخدمون المُسجَّلون ({rows.length})
        </h2>
        <ul className="space-y-3">
          {rows.map((u) => (
            <UserRow_ key={u.id} user={u} isSelf={u.id === admin.id} />
          ))}
        </ul>
      </section>
    </div>
  )
}
