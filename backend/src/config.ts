import 'dotenv/config'
import { z } from 'zod'

const PLACEHOLDER = 'change_me_in_production'

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),

  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .refine(
      (v) => !v.includes(PLACEHOLDER),
      'DATABASE_URL still contains the placeholder password — set a real POSTGRES_PASSWORD',
    ),

  JWT_ACCESS_SECRET: z
    .string()
    .min(32, 'JWT_ACCESS_SECRET must be at least 32 chars (generate with: openssl rand -hex 64)')
    .refine(
      (v) => v !== PLACEHOLDER,
      'JWT_ACCESS_SECRET is still the placeholder — generate one with: openssl rand -hex 64',
    ),

  MINIO_ENDPOINT: z.string().url().default('http://localhost:9000'),
  MINIO_PUBLIC_ENDPOINT: z.string().url().optional(),
  MINIO_ACCESS_KEY: z.string().min(1, 'MINIO_ACCESS_KEY is required'),
  MINIO_SECRET_KEY: z
    .string()
    .min(1, 'MINIO_SECRET_KEY is required')
    .refine((v) => v !== PLACEHOLDER, 'MINIO_SECRET_KEY is still the placeholder'),
  MINIO_BUCKET: z.string().default('receipts'),

  OPENAI_API_KEY: z
    .string()
    .min(1, 'OPENAI_API_KEY is required')
    .refine(
      (v) => v !== 'sk-...' && v.length > 10,
      'OPENAI_API_KEY is still the placeholder — set a real key from https://platform.openai.com/api-keys',
    ),

  RESEND_API_KEY: z
    .string()
    .min(1, 'RESEND_API_KEY is required')
    .refine(
      (v) => v !== 're_...' && v.length > 5,
      'RESEND_API_KEY is still the placeholder — set a real key from https://resend.com/api-keys',
    ),

  EMAIL_FROM: z.string().email().default('noreply@expensetracker.app'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
})

export type Config = z.infer<typeof ConfigSchema>

function loadConfig(): Config {
  const result = ConfigSchema.safeParse(process.env)
  if (!result.success) {
    console.error('\n❌ Invalid environment configuration:\n')
    for (const issue of result.error.issues) {
      const path = issue.path.join('.') || '(root)'
      console.error(`  ${path}: ${issue.message}`)
    }
    console.error('\n  → Check your .env file against .env.example\n')
    process.exit(1)
  }
  return result.data
}

export const config = loadConfig()
