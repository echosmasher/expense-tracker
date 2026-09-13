export type ScanTarget = { householdId: string } | { projectId: string }

export type CaptureStatus = 'queued' | 'uploading' | 'failed'

export interface CaptureRecord {
  id: string
  blob: Blob
  target: ScanTarget
  capturedAt: number
  status: CaptureStatus
  attempts: number
  lastError: string | null
  /** Earliest time this record is eligible for another upload attempt (backoff). */
  nextAttemptAt: number | null
}

export type QueueEvent =
  | { type: 'enqueue'; record: CaptureRecord }
  | { type: 'uploadStart'; id: string }
  | { type: 'uploadSuccess'; id: string }
  | { type: 'uploadRetryable'; id: string; attempts: number; error: string; nextAttemptAt: number }
  | { type: 'uploadFailed'; id: string; attempts: number; error: string }
  | { type: 'retry'; id: string }
  | { type: 'discard'; id: string }

/**
 * Pure state transition for the capture queue. Persistence (IndexedDB) and
 * network calls live in captureQueue.ts; this function only ever needs the
 * current records and an event, so it's exhaustively unit-testable.
 */
export function captureQueueReducer(records: CaptureRecord[], event: QueueEvent): CaptureRecord[] {
  switch (event.type) {
    case 'enqueue':
      return [...records, event.record]

    case 'uploadStart':
      return records.map((r) => (r.id === event.id ? { ...r, status: 'uploading' } : r))

    case 'uploadSuccess':
      return records.filter((r) => r.id !== event.id)

    case 'uploadRetryable':
      return records.map((r) =>
        r.id === event.id
          ? { ...r, status: 'queued', attempts: event.attempts, lastError: event.error, nextAttemptAt: event.nextAttemptAt }
          : r
      )

    case 'uploadFailed':
      return records.map((r) =>
        r.id === event.id
          ? { ...r, status: 'failed', attempts: event.attempts, lastError: event.error, nextAttemptAt: null }
          : r
      )

    case 'retry':
      return records.map((r) =>
        r.id === event.id ? { ...r, status: 'queued', nextAttemptAt: null } : r
      )

    case 'discard':
      return records.filter((r) => r.id !== event.id)

    default:
      return records
  }
}
