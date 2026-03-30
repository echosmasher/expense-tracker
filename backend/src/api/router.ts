import { Router } from 'express'
import { authRouter } from './routes/auth.js'
import { usersRouter } from './routes/users.js'
import { householdsRouter } from './routes/households.js'
import { receiptsRouter } from './routes/receipts.js'
import { expensesRouter } from './routes/expenses.js'
import { settlementsRouter, settlementTransactionRouter } from './routes/settlements.js'
import { projectsRouter, projectDetailRouter } from './routes/projects.js'
import { statisticsRouter } from './routes/statistics.js'

export const router = Router()

router.use('/auth', authRouter)
router.use('/users', usersRouter)
router.use('/households', householdsRouter)
router.use('/receipts', receiptsRouter)
router.use('/households/:householdId/expenses', expensesRouter)
router.use('/households/:householdId/settlements', settlementsRouter)
router.use('/settlements/:settlementId/transactions', settlementTransactionRouter)
router.use('/households/:householdId/projects', projectsRouter)
router.use('/projects/:projectId', projectDetailRouter)
router.use('/households/:householdId/statistics', statisticsRouter)
