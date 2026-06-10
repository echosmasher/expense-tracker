import { config as loadEnv } from 'dotenv'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export const TEST_DB_NAME = 'expense_tracker_test'

/**
 * Configure process.env for the test suite. Must run before any module that
 * reads config (src/config.ts validates env at import time).
 *
 * The database name is ALWAYS forced to the dedicated test database so the
 * suite can never touch development data, regardless of where DATABASE_URL
 * came from (root .env locally, job env in CI).
 */
export function applyTestEnv(): void {
  if (!process.env.DATABASE_URL) {
    loadEnv({ path: join(__dirname, '../../.env') })
  }

  const base =
    process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/expense_tracker'
  const url = new URL(base)
  url.pathname = `/${TEST_DB_NAME}`
  process.env.DATABASE_URL = url.toString()

  process.env.NODE_ENV = 'test'
  process.env.LOG_LEVEL ??= 'silent'
  process.env.JWT_ACCESS_SECRET ??=
    'test-only-access-secret-0123456789abcdef0123456789abcdef'
  process.env.MINIO_ACCESS_KEY ??= 'test-minio-access'
  process.env.MINIO_SECRET_KEY ??= 'test-minio-secret'
  process.env.OPENAI_API_KEY ??= 'sk-test-not-a-real-key'
  process.env.RESEND_API_KEY ??= 're_test_not_a_real_key'
}
