// Vitest setupFile: runs in each worker before test files (and therefore
// before src/config.ts is imported and validates the environment).
import { applyTestEnv } from './test-env.js'

applyTestEnv()
