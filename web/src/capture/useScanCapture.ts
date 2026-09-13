import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { expenses, projects } from '@expense-tracker/shared'
import { downscaleImage } from './downscale'

export type ScanTarget = { householdId: string } | { projectId: string }

function resolveTarget(target: ScanTarget) {
  return 'projectId' in target
    ? {
        upload: (blob: Blob, captureId: string) => projects.createExpenseFromReceipt(target.projectId, blob, captureId),
        reviewPath: (expenseId: string) => `/projects/${target.projectId}/expenses/${expenseId}/review`,
      }
    : {
        upload: (blob: Blob, captureId: string) => expenses.createFromReceipt(target.householdId, blob, captureId),
        reviewPath: (expenseId: string) => `/expenses/${expenseId}/review`,
      }
}

/**
 * Drives a single scan: downscale on device, then one API call that
 * sanitises, stores, parses, and creates the draft (spec 004 ticket 8),
 * landing the member on its review screen. Not yet queued for offline use —
 * that's ticket 10; a failed upload here just surfaces an error to retry.
 */
export function useScanCapture(target: ScanTarget | null) {
  const navigate = useNavigate()
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function capture(file: File) {
    if (!target) return
    setUploading(true)
    setError(null)
    try {
      const { upload, reviewPath } = resolveTarget(target)
      const blob = await downscaleImage(file)
      const expense = await upload(blob, crypto.randomUUID())
      navigate(reviewPath(expense.id))
    } catch (err: any) {
      setError(err?.message ?? 'Failed to upload receipt.')
    } finally {
      setUploading(false)
    }
  }

  return { capture, uploading, error, dismissError: () => setError(null) }
}
