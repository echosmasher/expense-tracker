// Vitest globalSetup: creates the dedicated test database (if missing) and
// brings it to the latest schema by applying the SQL migrations, mirroring
// the loop in src/db/migrate.ts (which can't be imported — it runs on import).
import { readdir, readFile } from 'fs/promises'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'
import { applyTestEnv, TEST_DB_NAME } from './test-env.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations')

export default async function setup(): Promise<void> {
  applyTestEnv()
  const testUrl = new URL(process.env.DATABASE_URL!)

  // Create the test database if it doesn't exist (connect via the default
  // maintenance database with the same credentials).
  const adminUrl = new URL(testUrl.toString())
  adminUrl.pathname = '/postgres'
  const admin = new pg.Client({ connectionString: adminUrl.toString() })
  await admin.connect()
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [TEST_DB_NAME])
    if (exists.rows.length === 0) {
      await admin.query(`CREATE DATABASE "${TEST_DB_NAME}"`)
    }
  } finally {
    await admin.end()
  }

  const client = new pg.Client({ connectionString: testUrl.toString() })
  await client.connect()
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        filename TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)
    const applied = await client.query<{ filename: string }>('SELECT filename FROM _migrations')
    const appliedSet = new Set(applied.rows.map((r) => r.filename))

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort()
    for (const file of files) {
      if (appliedSet.has(file)) continue
      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf-8')
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file])
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      }
    }
  } finally {
    await client.end()
  }
}
