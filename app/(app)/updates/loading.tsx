/**
 * Route-level loading state. The page also wraps its result list in its own
 * Suspense boundary so that filter changes swap only the results, but this
 * covers the initial navigation into the archive.
 */
export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="جارٍ تحميل الأرشيف">
      <div className="h-16 animate-pulse rounded-(--radius-card) bg-(--color-surface-sunken)" />
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="h-[32rem] animate-pulse rounded-(--radius-card) bg-(--color-surface-sunken)" />
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-36 animate-pulse rounded-(--radius-card) bg-(--color-surface-sunken)"
            />
          ))}
        </div>
      </div>
    </div>
  )
}
