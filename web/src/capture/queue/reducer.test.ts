import { describe, expect, it } from 'vitest'
import { captureQueueReducer, type CaptureRecord } from './reducer'

function makeRecord(overrides: Partial<CaptureRecord> = {}): CaptureRecord {
  return {
    id: 'capture-1',
    blob: new Blob(['x']),
    target: { householdId: 'household-1' },
    capturedAt: 1_000,
    status: 'queued',
    attempts: 0,
    lastError: null,
    nextAttemptAt: null,
    ...overrides,
  }
}

describe('captureQueueReducer', () => {
  it('enqueue appends a new record', () => {
    const record = makeRecord()
    const result = captureQueueReducer([], { type: 'enqueue', record })
    expect(result).toEqual([record])
  })

  it('uploadStart marks the matching record as uploading and leaves others untouched', () => {
    const target = makeRecord({ id: 'a' })
    const other = makeRecord({ id: 'b' })
    const result = captureQueueReducer([target, other], { type: 'uploadStart', id: 'a' })
    expect(result.find((r) => r.id === 'a')?.status).toBe('uploading')
    expect(result.find((r) => r.id === 'b')?.status).toBe('queued')
  })

  it('uploadSuccess removes the record', () => {
    const record = makeRecord({ status: 'uploading' })
    const result = captureQueueReducer([record], { type: 'uploadSuccess', id: record.id })
    expect(result).toEqual([])
  })

  it('uploadRetryable returns the record to queued with backoff and an error', () => {
    const record = makeRecord({ status: 'uploading' })
    const result = captureQueueReducer([record], {
      type: 'uploadRetryable',
      id: record.id,
      attempts: 1,
      error: 'Network error',
      nextAttemptAt: 5_000,
    })
    expect(result[0]).toMatchObject({ status: 'queued', attempts: 1, lastError: 'Network error', nextAttemptAt: 5_000 })
  })

  it('uploadFailed marks the record failed with the server reason and no further backoff', () => {
    const record = makeRecord({ status: 'uploading' })
    const result = captureQueueReducer([record], {
      type: 'uploadFailed',
      id: record.id,
      attempts: 2,
      error: 'Project no longer exists',
    })
    expect(result[0]).toMatchObject({ status: 'failed', attempts: 2, lastError: 'Project no longer exists', nextAttemptAt: null })
  })

  it('retry moves a failed record back to queued, eligible immediately', () => {
    const record = makeRecord({ status: 'failed', lastError: 'boom', nextAttemptAt: 99_999 })
    const result = captureQueueReducer([record], { type: 'retry', id: record.id })
    expect(result[0]).toMatchObject({ status: 'queued', nextAttemptAt: null })
  })

  it('discard removes the record entirely', () => {
    const record = makeRecord({ status: 'failed' })
    const result = captureQueueReducer([record], { type: 'discard', id: record.id })
    expect(result).toEqual([])
  })
})
