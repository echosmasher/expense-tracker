import { openDB, type IDBPDatabase } from 'idb'
import type { CaptureRecord } from './reducer'

export const DB_NAME = 'expense-tracker-capture-queue'
const STORE_NAME = 'captures'
const DB_VERSION = 1

let dbPromise: Promise<IDBPDatabase> | null = null

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      },
    })
  }
  return dbPromise
}

export async function loadAllCaptures(): Promise<CaptureRecord[]> {
  const db = await getDb()
  return db.getAll(STORE_NAME)
}

export async function putCapture(record: CaptureRecord): Promise<void> {
  const db = await getDb()
  await db.put(STORE_NAME, record)
}

export async function deleteCapture(id: string): Promise<void> {
  const db = await getDb()
  await db.delete(STORE_NAME, id)
}

/** Test-only: close and drop the cached connection so a fresh one is opened next time,
 * and so `indexedDB.deleteDatabase` isn't left blocked behind an open connection. */
export async function _resetDbForTests(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise
    db.close()
  }
  dbPromise = null
}
