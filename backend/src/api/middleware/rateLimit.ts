import rateLimit from 'express-rate-limit'

// Auth endpoints: protect against credential stuffing and registration spam.
// 20 attempts / 15 min / IP. Successful auth doesn't burn budget.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'TOO_MANY_REQUESTS', message: 'Too many attempts. Try again in a few minutes.' },
})

// Receipt parse calls OpenAI on every hit. Cap per-IP to keep cost bounded
// if a credential is leaked or a buggy client retries unbounded.
export const receiptParseLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'TOO_MANY_REQUESTS', message: 'Receipt parse limit reached. Try again later.' },
})
