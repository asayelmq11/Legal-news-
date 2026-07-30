import type { Metadata } from 'next'

import { StatusScreen } from '@/components/status-screen'

export const metadata: Metadata = { title: 'صلاحية غير كافية' }

export default function UnauthorizedPage() {
  return (
    <StatusScreen
      tone="warn"
      title="صلاحية غير كافية"
      body="هذه الصفحة مخصصة لمسؤولي النظام. حسابك مُفعَّل ويمكنه الاطلاع على الأرشيف القانوني ولوحة المتابعة، لكن إدارة المصادر والمستخدمين والإعدادات تتطلب صلاحية مسؤول."
      action={{ href: '/', label: 'العودة إلى لوحة المتابعة' }}
      detail={
        <p className="text-xs text-(--color-ink-subtle)">
          حتى لو تم الوصول إلى الصفحة مباشرة، فإن قاعدة البيانات ترفض أي تعديل عبر سياسات أمان
          الصفوف.
        </p>
      }
    />
  )
}
