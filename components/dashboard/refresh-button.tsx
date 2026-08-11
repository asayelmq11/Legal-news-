'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { BUTTON } from '@/components/ui'
import { ClockIcon, RefreshIcon } from '@/components/icons'
import { checkRefreshStatus, triggerManualRefresh } from '@/lib/ingestion/actions'
import type { RefreshStatus } from '@/lib/queries/ingestion'
import { cn, formatDateTimeAr } from '@/lib/utils'

const POLL_INTERVAL_MS = 4000

type Message = { tone: 'ok' | 'error' | 'info'; text: string }

/**
 * The dashboard's only ingestion trigger. n8n answers the underlying webhook
 * immediately and keeps working in the background (see n8n/README.md), so
 * "busy" here means "a run is in flight", not "this HTTP request is open" —
 * polling is what tells the button when the background run actually finishes.
 */
export function RefreshButton({ initialStatus }: { initialStatus: RefreshStatus }) {
  const router = useRouter()
  const [running, setRunning] = useState(initialStatus.running)
  const [lastSuccessfulRefreshAt, setLastSuccessfulRefreshAt] = useState(
    initialStatus.lastSuccessfulRefreshAt,
  )
  const [message, setMessage] = useState<Message | null>(null)
  const [isPending, startTransition] = useTransition()
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  // Tracks whether WE are the ones waiting on the in-flight run, so the
  // completion message and dashboard revalidation fire exactly once.
  const awaitingCompletion = useRef(initialStatus.running)

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current)
      pollTimer.current = null
    }
  }, [])

  const poll = useCallback(async () => {
    const status = await checkRefreshStatus()
    setRunning(status.running)
    if (status.lastSuccessfulRefreshAt) setLastSuccessfulRefreshAt(status.lastSuccessfulRefreshAt)

    if (status.running) return

    stopPolling()
    if (!awaitingCompletion.current) return
    awaitingCompletion.current = false

    if (status.latest?.status === 'succeeded') {
      const count = status.latest.items_inserted ?? 0
      setMessage({
        tone: 'ok',
        text:
          count > 0
            ? `تم التحديث — تمت إضافة ${count} ${count === 1 ? 'مستجد جديد' : 'مستجدات جديدة'}`
            : 'تم التحديث — لا توجد مستجدات جديدة',
      })
    } else if (status.latest?.status === 'failed') {
      setMessage({ tone: 'error', text: 'تعذّر إكمال التحديث. حاول مرة أخرى.' })
    }
    router.refresh()
  }, [router, stopPolling])

  const startPolling = useCallback(() => {
    awaitingCompletion.current = true
    stopPolling()
    pollTimer.current = setInterval(() => void poll(), POLL_INTERVAL_MS)
  }, [poll, stopPolling])

  useEffect(() => {
    if (initialStatus.running) startPolling()
    return stopPolling
    // Only ever meant to run once, against the server-rendered snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleClick = () => {
    setMessage(null)
    startTransition(async () => {
      const result = await triggerManualRefresh()
      if (!result.ok) {
        setMessage({ tone: 'error', text: result.message ?? 'حدث خطأ غير متوقع.' })
        return
      }
      setRunning(true)
      if (result.message) setMessage({ tone: 'info', text: result.message })
      startPolling()
      void poll()
    })
  }

  const busy = running || isPending

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex items-center gap-1.5 text-xs text-(--color-ink-subtle)">
          <ClockIcon className="size-3.5" />
          آخر تحديث ناجح: {lastSuccessfulRefreshAt ? formatDateTimeAr(lastSuccessfulRefreshAt) : 'لا يوجد بعد'}
        </p>
        {/* Ghost, not primary — the refresh control is a secondary action next to
            the dashboard's actual data, not a headline element competing with the
            KPI strip's own solid tile just below it. */}
        <button type="button" onClick={handleClick} disabled={busy} className={BUTTON.ghost}>
          <RefreshIcon className={cn('size-4', busy && 'animate-spin')} />
          {busy ? 'جارٍ تحديث المستجدات…' : 'تحديث المستجدات'}
        </button>
      </div>
      {message ? (
        <p
          role="status"
          className={cn(
            'text-xs font-medium',
            message.tone === 'ok' && 'text-(--color-ok)',
            message.tone === 'error' && 'text-(--color-danger)',
            message.tone === 'info' && 'text-(--color-ink-muted)',
          )}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  )
}
