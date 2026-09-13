import { create } from 'zustand'
import { ApiError, expenses, projects } from '@expense-tracker/shared'
import { captureQueueReducer, type CaptureRecord, type QueueEvent, type ScanTarget } from './reducer'
import { deleteCapture, loadAllCaptures, putCapture } from './db'

const MAX_BACKOFF_MS = 30_000

export class QueueStorageFullError extends Error {
  constructor() {
    super('Storage full — capture was not saved.')
    this.name = 'QueueStorageFullError'
  }
}

export type SettleResult =
  | { status: 'uploaded'; expenseId: string }
  | { status: 'queued' }
  | { status: 'failed'; error: string }

interface QueueState {
  records: CaptureRecord[]
  initialized: boolean
}

export const useCaptureQueueStore = create<QueueState>(() => ({ records: [], initialized: false }))

/** Queued + uploading + failed — every record still in the queue, shown as one badge count. */
export function pendingCount(records: CaptureRecord[]): number {
  return records.length
}

function apply(event: QueueEvent) {
  useCaptureQueueStore.setState((s) => ({ records: captureQueueReducer(s.records, event) }))
}

// Resolved (or rejected) once for each capture's *first* settle — success, permanent
// failure, or "went back to queued" (offline). Later background retries of the same
// item don't notify a caller that already got an answer and may have navigated away.
const pending = new Map<string, (result: SettleResult) => void>()

function settle(id: string, result: SettleResult) {
  const resolve = pending.get(id)
  if (resolve) {
    pending.delete(id)
    resolve(result)
  }
}

function resolveUploader(target: ScanTarget) {
  return 'projectId' in target
    ? (blob: Blob, captureId: string) => projects.createExpenseFromReceipt(target.projectId, blob, captureId)
    : (blob: Blob, captureId: string) => expenses.createFromReceipt(target.householdId, blob, captureId)
}

/** 5xx, network errors, and 401 (session expired — resumes once the member signs in
 * again) go back to `queued` with backoff. Everything else (400, 403, 404, ...) is a
 * permanent client error and is surfaced as `failed` with the server's reason. */
function classifyError(err: unknown): { retryable: boolean; message: string } {
  if (err instanceof ApiError) {
    if (err.status >= 500 || err.status === 401 || err.status === 429) {
      return { retryable: true, message: err.message }
    }
    return { retryable: false, message: err.message }
  }
  return { retryable: true, message: err instanceof Error ? err.message : 'Network error' }
}

let flushing = false

async function uploadOne(record: CaptureRecord): Promise<void> {
  apply({ type: 'uploadStart', id: record.id })
  await putCapture({ ...record, status: 'uploading' })

  try {
    const upload = resolveUploader(record.target)
    const expense = await upload(record.blob, record.id)
    apply({ type: 'uploadSuccess', id: record.id })
    await deleteCapture(record.id)
    settle(record.id, { status: 'uploaded', expenseId: expense.id })
  } catch (err) {
    const classified = classifyError(err)
    const attempts = record.attempts + 1

    if (classified.retryable) {
      const backoffMs = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempts)
      const nextAttemptAt = Date.now() + backoffMs
      apply({ type: 'uploadRetryable', id: record.id, attempts, error: classified.message, nextAttemptAt })
      await putCapture({ ...record, status: 'queued', attempts, lastError: classified.message, nextAttemptAt })
      settle(record.id, { status: 'queued' })
      if (typeof window !== 'undefined') {
        window.setTimeout(() => void flushQueue(), backoffMs)
      }
    } else {
      apply({ type: 'uploadFailed', id: record.id, attempts, error: classified.message })
      await putCapture({ ...record, status: 'failed', attempts, lastError: classified.message, nextAttemptAt: null })
      settle(record.id, { status: 'failed', error: classified.message })
    }
  }
}

/** Serial: one upload in flight at a time, so captures never block each other but
 * also never race the same IndexedDB record. */
export async function flushQueue(): Promise<void> {
  if (flushing) return
  flushing = true
  try {
    for (;;) {
      const now = Date.now()
      const next = useCaptureQueueStore
        .getState()
        .records.filter((r) => r.status === 'queued' && (r.nextAttemptAt === null || r.nextAttemptAt <= now))
        .sort((a, b) => a.capturedAt - b.capturedAt)[0]
      if (!next) break
      await uploadOne(next)
    }
  } finally {
    flushing = false
  }
}

let initPromise: Promise<void> | null = null

/** Loads persisted captures, recovers any left mid-upload by a crash back to
 * `queued`, and wires the flush triggers named in spec 004 US4: enqueue (see
 * enqueueCapture), boot, `online`, and returning to the foreground. */
export function initCaptureQueue(): Promise<void> {
  if (initPromise) return initPromise
  initPromise = (async () => {
    const stored = await loadAllCaptures()
    const recovered = await Promise.all(
      stored.map(async (r) => {
        if (r.status !== 'uploading') return r
        const queued: CaptureRecord = { ...r, status: 'queued' }
        await putCapture(queued)
        return queued
      })
    )
    useCaptureQueueStore.setState({ records: recovered, initialized: true })

    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => void flushQueue())
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void flushQueue()
      })
    }

    void flushQueue()
  })()
  return initPromise
}

/** Writes the capture to IndexedDB before anything else, then triggers a flush
 * attempt and resolves with its outcome. Resolving `queued` means it was written
 * safely but is offline or hit a transient error — never an error state. */
export function enqueueCapture(target: ScanTarget, blob: Blob): Promise<SettleResult> {
  const record: CaptureRecord = {
    id: crypto.randomUUID(),
    blob,
    target,
    capturedAt: Date.now(),
    status: 'queued',
    attempts: 0,
    lastError: null,
    nextAttemptAt: null,
  }

  return new Promise((resolve, reject) => {
    putCapture(record)
      .then(() => {
        apply({ type: 'enqueue', record })
        pending.set(record.id, resolve)
        void flushQueue()
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'QuotaExceededError') {
          reject(new QueueStorageFullError())
        } else {
          reject(err instanceof Error ? err : new Error('Failed to save capture'))
        }
      })
  })
}

export async function retryCapture(id: string): Promise<void> {
  const record = useCaptureQueueStore.getState().records.find((r) => r.id === id)
  if (!record || record.status !== 'failed') return
  apply({ type: 'retry', id })
  await putCapture({ ...record, status: 'queued', nextAttemptAt: null })
  void flushQueue()
}

export async function discardCapture(id: string): Promise<void> {
  apply({ type: 'discard', id })
  await deleteCapture(id)
}
