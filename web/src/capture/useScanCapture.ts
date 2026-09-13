import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { downscaleImage } from './downscale'
import { enqueueCapture, QueueStorageFullError } from './queue/captureQueue'
import type { ScanTarget } from './queue/reducer'

export type { ScanTarget }

function reviewPathFor(target: ScanTarget, expenseId: string) {
  return 'projectId' in target
    ? `/projects/${target.projectId}/expenses/${expenseId}/review`
    : `/expenses/${expenseId}/review`
}

/**
 * Drives a single scan: downscale on device, then hand it to the capture
 * queue (spec 004 ticket 10). The queue persists it before anything else, so
 * a capture always succeeds locally even with no connection; this hook just
 * reports what happened to the immediate flush attempt.
 */
export function useScanCapture(target: ScanTarget | null) {
  const navigate = useNavigate()
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [queuedMessage, setQueuedMessage] = useState<string | null>(null)

  // The flush that follows enqueue can resolve after the member has already left
  // this screen (slow network, quick tap-away); only navigate if they're still here.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  async function capture(file: File) {
    if (!target) return
    setUploading(true)
    setError(null)
    setQueuedMessage(null)
    try {
      const blob = await downscaleImage(file)
      const result = await enqueueCapture(target, blob)
      if (!mountedRef.current) return
      if (result.status === 'uploaded') {
        navigate(reviewPathFor(target, result.expenseId))
      } else if (result.status === 'failed') {
        setError(result.error)
      } else {
        setQueuedMessage('No connection — receipt queued, it will upload automatically.')
      }
    } catch (err) {
      if (err instanceof QueueStorageFullError) {
        setError(err.message)
      } else {
        setError(err instanceof Error ? err.message : 'Failed to capture receipt.')
      }
    } finally {
      setUploading(false)
    }
  }

  return {
    capture,
    uploading,
    error,
    queuedMessage,
    dismissError: () => setError(null),
    dismissQueuedMessage: () => setQueuedMessage(null),
  }
}
