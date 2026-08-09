/**
 * Route-level loading state. The page also wraps its result list in its own
 * Suspense boundary so that filter changes swap only the results, but this
 * covers the initial navigation into the archive.
 */
export default function Loading() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="جارٍ تحميل الأرشيف">
      <div className="h-14 animate-pulse rounded-(--radius-lg) bg-(--color-surface-sunken)" />
      <div className="grid gap-6 lg:grid-cols-[300px_1fr] xl:grid-cols-[340px_1fr]">
        <div className="h-[36rem] animate-pulse rounded-(--radius-lg) bg-(--color-surface-sunken)" />
        <div className="space-y-5">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-(--radius-control) bg-(--color-surface-sunken)"
            />
          ))}
        </div>
      </div>
    </div>
  )
}
