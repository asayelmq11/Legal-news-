import type { Metadata } from 'next'

import { StatusScreen } from '@/components/status-screen'

export const metadata: Metadata = { title: 'خطأ في الإعداد' }

/**
 * Reached when required environment variables are absent. The platform fails
 * closed here rather than serving pages in a degraded, unauthenticated state.
 *
 * Names the missing variables — they are configuration keys, not secrets, and a
 * deployer staring at a blank error page helps nobody. No values are shown.
 */
export default function ConfigurationErrorPage() {
  return (
    <StatusScreen
      tone="danger"
      title="المنصة غير مُهيّأة بالكامل"
      body="تعذّر الاتصال بخدمة المصادقة لأن إعدادات البيئة ناقصة. تم إيقاف الوصول بالكامل بدلاً من تشغيل المنصة بدون مصادقة."
      detail={
        <div className="space-y-2">
          <p className="text-xs text-(--color-ink-subtle)">
            على مسؤول النشر التأكد من ضبط المتغيرات التالية:
          </p>
          <ul className="space-y-1 font-mono text-xs" dir="ltr">
            <li>NEXT_PUBLIC_SUPABASE_URL</li>
            <li>NEXT_PUBLIC_SUPABASE_ANON_KEY</li>
          </ul>
          <p className="text-xs text-(--color-ink-subtle)">
            راجع ملف <span dir="ltr">.env.example</span>. لا تُخزَّن مفاتيح الخدمة في التطبيق
            إطلاقاً — مكانها بيانات اعتماد n8n.
          </p>
        </div>
      }
    />
  )
}
