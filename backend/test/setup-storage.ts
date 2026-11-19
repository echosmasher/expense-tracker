// Vitest setupFile: replaces the MinIO client with an in-memory object store
// for every test file, so the suite needs only Postgres (as CLAUDE.md says) —
// the receipt-upload paths store an image on every scan, and CI has no
// object store. A test that needs to observe storage calls can still declare
// its own vi.mock of this module, which takes precedence for that file.
import { vi } from 'vitest'
import { Readable } from 'node:stream'

vi.mock('../src/storage/minio.js', () => {
  const objects = new Map<string, { buffer: Buffer; contentType: string }>()

  return {
    ensureBucket: async () => {},
    uploadFile: async (key: string, buffer: Buffer, mimetype: string) => {
      objects.set(key, { buffer, contentType: mimetype })
      return key
    },
    getObject: async (key: string) => {
      const stored = objects.get(key)
      if (!stored) {
        throw Object.assign(new Error('The specified key does not exist.'), { name: 'NoSuchKey' })
      }
      return { body: Readable.from(stored.buffer), contentType: stored.contentType }
    },
    deleteObject: async (key: string) => {
      objects.delete(key)
    },
  }
})
