import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { createFromReceipt, createExpenseFromReceipt, MockApiError } = vi.hoisted(() => {
  class MockApiError extends Error {
    constructor(public readonly status: number, public readonly code: string, message: string) {
      super(message)
      this.name = 'ApiError'
    }
  }
  return {
    createFromReceipt: vi.fn(),
    createExpenseFromReceipt: vi.fn(),
    MockApiError,
  }
})

vi.mock('@expense-tracker/shared', () => ({
  ApiError: MockApiError,
  expenses: { createFromReceipt: (...args: unknown[]) => createFromReceipt(...args) },
  projects: { createExpenseFromReceipt: (...args: unknown[]) => createExpenseFromReceipt(...args) },
}))

import { DB_NAME, loadAllCaptures, _resetDbForTests } from './db'
import {
  enqueueCapture,
  QueueStorageFullError,
  useCaptureQueueStore,
} from './captureQueue'

const target = { householdId: 'household-1' }

async function resetDb() {
  await _resetDbForTests()
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => resolve()
  })
}

beforeEach(async () => {
  createFromReceipt.mockReset()
  createExpenseFromReceipt.mockReset()
  await resetDb()
  useCaptureQueueStore.setState({ records: [], initialized: false })
})

afterEach(async () => {
  await resetDb()
})

describe('captureQueue', () => {
  it('a network failure followed by a successful retry leaves exactly one draft', async () => {
    createFromReceipt
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ id: 'expense-1' })

    const result = await enqueueCapture(target, new Blob(['receipt']))
    expect(result).toEqual({ status: 'queued' })
    expect(useCaptureQueueStore.getState().records).toHaveLength(1)

    // The first failure scheduled a real backoff retry; wait for it to land
    // rather than reaching into internals to force it.
    await vi.waitFor(() => {
      expect(createFromReceipt).toHaveBeenCalledTimes(2)
    }, { timeout: 4000, interval: 50 })

    const [, , firstCaptureId] = createFromReceipt.mock.calls[0]!
    const [, , retryCaptureId] = createFromReceipt.mock.calls[1]!
    expect(retryCaptureId).toBe(firstCaptureId) // same capture identity — no duplicate draft
    expect(useCaptureQueueStore.getState().records).toHaveLength(0)
    expect(await loadAllCaptures()).toHaveLength(0)
  }, 8000)

  it('a permanent client error marks the capture failed with the server reason, not silently dropped', async () => {
    createFromReceipt.mockRejectedValueOnce(new MockApiError(404, 'PROJECT_NOT_FOUND', 'Project no longer exists'))

    const result = await enqueueCapture(target, new Blob(['receipt']))
    expect(result).toEqual({ status: 'failed', error: 'Project no longer exists' })

    const records = useCaptureQueueStore.getState().records
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ status: 'failed', lastError: 'Project no longer exists' })
  })

  it('a successful upload removes the capture and reports the new expense id', async () => {
    createFromReceipt.mockResolvedValueOnce({ id: 'expense-42' })

    const result = await enqueueCapture(target, new Blob(['receipt']))
    expect(result).toEqual({ status: 'uploaded', expenseId: 'expense-42' })
    expect(useCaptureQueueStore.getState().records).toHaveLength(0)
  })

  it('QuotaExceededError on enqueue leaves existing queued items intact', async () => {
    createFromReceipt.mockRejectedValue(new TypeError('offline'))
    await enqueueCapture(target, new Blob(['first']))
    expect(useCaptureQueueStore.getState().records).toHaveLength(1)
    expect(await loadAllCaptures()).toHaveLength(1)

    // Simulate the browser refusing the write because device storage is full —
    // IDBObjectStore.put rejects with QuotaExceededError, not db.open().
    const putSpy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    })

    await expect(enqueueCapture(target, new Blob(['second']))).rejects.toBeInstanceOf(QueueStorageFullError)
    putSpy.mockRestore()

    expect(useCaptureQueueStore.getState().records).toHaveLength(1)
    expect(await loadAllCaptures()).toHaveLength(1)
  })
})
