import { COUNTRIES, COUNTRY_CODES } from '@/lib/constants/countries'

/**
 * Placeholder root. Replaced in M4 by the authenticated shell, at which point
 * this route redirects to /login or the dashboard depending on session state.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-8 px-6 py-16">
      <header className="space-y-3">
        <p className="text-sm font-medium text-(--color-brand)">منصة داخلية · الإدارة القانونية</p>
        <h1 className="text-3xl font-bold tracking-tight text-(--color-ink)">
          منصة الرصد القانوني الخليجي
        </h1>
        <p className="text-(--color-ink-muted)">
          رصد آلي للتحديثات القانونية والتنظيمية الصادرة عن الجهات الرسمية المعتمدة في دول مجلس
          التعاون الخليجي.
        </p>
      </header>

      <section
        aria-labelledby="coverage-heading"
        className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-raised) p-6"
      >
        <h2 id="coverage-heading" className="mb-4 text-sm font-semibold text-(--color-ink-muted)">
          نطاق التغطية
        </h2>
        <ul className="flex flex-wrap gap-2">
          {COUNTRY_CODES.map((code) => (
            <li
              key={code}
              className="rounded-full bg-(--color-surface-sunken) px-3 py-1 text-sm text-(--color-ink)"
            >
              {COUNTRIES[code].nameAr}
            </li>
          ))}
        </ul>
      </section>

      <footer className="text-sm text-(--color-ink-subtle)">
        المرحلة الأولى — تهيئة المشروع. لوحة التحكم والأرشيف القانوني قيد الإنشاء.
      </footer>
    </main>
  )
}
