'use client'

/**
 * Route error boundary. Catches anything the query layer's Result type does not
 * already handle — a render fault, an auth failure mid-stream.
 *
 * The raw message is shown to an internal audience deliberately: these are all
 * trusted staff, and an opaque "something went wrong" costs more support time
 * than it saves. No secrets pass through here — the query layer returns
 * PostgREST messages, not credentials.
 */
export default function ArchiveError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div
      role="alert"
      className="rounded-(--radius-card) border border-(--color-danger) bg-(--color-danger-subtle) p-6"
    >
      <h2 className="text-sm font-semibold text-(--color-danger)">تعذّر عرض الأرشيف</h2>
      <p className="mt-1 text-sm text-(--color-ink-muted)">
        حدث خطأ غير متوقع. أعد المحاولة، وإن تكرر فأبلغ مسؤول النظام مع الرمز أدناه.
      </p>
      {error.digest ? (
        <p className="mt-2 font-mono text-xs text-(--color-ink-subtle)" dir="ltr">
          {error.digest}
        </p>
      ) : null}
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded-md bg-(--color-brand) px-4 py-2 text-sm font-semibold text-white hover:bg-(--color-brand-hover)"
      >
        إعادة المحاولة
      </button>
    </div>
  )
}
