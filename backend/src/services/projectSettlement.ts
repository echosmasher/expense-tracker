/**
 * Confirmed-expense settlement input for a project's current allocation key.
 * Shared by the finish-project route (POST /projects/:id/finish, which
 * persists the result as a settlement snapshot) and the project summary
 * route (GET /projects/:id/summary, which shows it live and unpersisted) —
 * spec 005 SC-007 requires both to be built from the same function so a
 * settlement triggered right after reading the summary can never diverge
 * from the figures just shown.
 */
import { db } from '../db/client.js'
import { calculateSettlement } from '@expense-tracker/shared'
import type { AllocationShare, ExpenseForSettlement, SettlementResult } from '@expense-tracker/shared'

interface ShareRow {
  user_id: string
  name: string
  share_bp: number
  role: string
}

export async function getProjectSettlementInput(
  projectId: string,
  allocationKeyId: string
): Promise<{ expenses: ExpenseForSettlement[]; shares: AllocationShare[]; memberNames: Map<string, string> }> {
  const [expensesResult, sharesResult] = await Promise.all([
    db.query<{ id: string; total_amount_ore: number; purchased_by: string }>(
      "SELECT id, total_amount_ore, purchased_by FROM expenses WHERE project_id = $1 AND status = 'confirmed'",
      [projectId]
    ),
    db.query<ShareRow>(
      `SELECT aks.user_id, u.name, aks.share_bp, pm.role
       FROM allocation_key_shares aks
       JOIN users u ON u.id = aks.user_id
       JOIN project_members pm ON pm.user_id = aks.user_id AND pm.project_id = $2
       WHERE aks.allocation_key_id = $1`,
      [allocationKeyId, projectId]
    ),
  ])

  return {
    expenses: expensesResult.rows.map((e) => ({
      purchasedByUserId: e.purchased_by,
      householdAmountOre: Number(e.total_amount_ore),
    })),
    shares: sharesResult.rows.map((s) => ({ userId: s.user_id, shareBp: s.share_bp, isAdmin: s.role === 'admin' })),
    memberNames: new Map(sharesResult.rows.map((s) => [s.user_id, s.name])),
  }
}

/** Null when there are no confirmed expenses (spec 005 US3 scenario 5: an
 * empty state, not a zeroed balance sheet). */
export async function calculateProvisionalBalance(
  projectId: string,
  allocationKeyId: string
): Promise<{ result: SettlementResult; memberNames: Map<string, string> } | null> {
  const { expenses, shares, memberNames } = await getProjectSettlementInput(projectId, allocationKeyId)
  if (expenses.length === 0) return null
  return { result: calculateSettlement(expenses, shares), memberNames }
}
