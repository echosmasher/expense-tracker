/**
 * Settlement calculation — pure function, no side effects.
 *
 * All monetary values are integers in øre (100 øre = 1 NOK).
 * All allocation shares are integers in basis points (10 000 bp = 100%).
 * No floating-point arithmetic. Rounding remainder assigned to admin member.
 */

export interface ExpenseForSettlement {
  purchasedByUserId: string
  /** Total of all NON-personal line items in øre */
  householdAmountOre: number
}

export interface AllocationShare {
  userId: string
  shareBp: number
  isAdmin: boolean
}

export interface SettlementBalance {
  userId: string
  /** Positive = is owed money; negative = owes money */
  amountOre: number
}

export interface SettlementTransaction {
  fromUserId: string
  toUserId: string
  amountOre: number
}

export interface SettlementResult {
  balances: SettlementBalance[]
  transactions: SettlementTransaction[]
}

/**
 * Calculate settlement balances and minimum payment transactions.
 *
 * @param expenses - Confirmed household-tagged expenses for the period
 * @param shares - Allocation key shares (must sum to 10 000 bp)
 */
export function calculateSettlement(
  expenses: ExpenseForSettlement[],
  shares: AllocationShare[]
): SettlementResult {
  // Validate allocation key sums to 10 000 bp
  const totalBp = shares.reduce((sum, s) => sum + s.shareBp, 0)
  if (totalBp !== 10_000) {
    throw new Error(`Allocation key shares must sum to 10000 bp, got ${totalBp}`)
  }

  const totalOre = expenses.reduce((sum, e) => sum + e.householdAmountOre, 0)

  // Calculate how much each member paid
  const paid = new Map<string, number>()
  for (const e of expenses) {
    paid.set(e.purchasedByUserId, (paid.get(e.purchasedByUserId) ?? 0) + e.householdAmountOre)
  }

  // Calculate each member's share using integer arithmetic
  // balance = amountPaid - share
  // Remainder from rounding goes to admin
  const shares_ = [...shares]
  const adminShare = shares_.find((s) => s.isAdmin)
  if (!adminShare) throw new Error('No admin member found in allocation shares')

  let allocatedTotal = 0
  const shareAmounts = new Map<string, number>()

  for (const s of shares_) {
    if (s.isAdmin) continue
    const shareOre = Math.floor((totalOre * s.shareBp) / 10_000)
    shareAmounts.set(s.userId, shareOre)
    allocatedTotal += shareOre
  }
  // Admin gets the remainder to avoid rounding drift
  shareAmounts.set(adminShare.userId, totalOre - allocatedTotal)

  // Compute net balances
  const balances: SettlementBalance[] = shares.map((s) => ({
    userId: s.userId,
    amountOre: (paid.get(s.userId) ?? 0) - (shareAmounts.get(s.userId) ?? 0),
  }))

  // Generate minimum transactions using greedy creditor/debtor pairing
  const transactions = minimiseTransactions(balances)

  return { balances, transactions }
}

function minimiseTransactions(balances: SettlementBalance[]): SettlementTransaction[] {
  const creditors = balances
    .filter((b) => b.amountOre > 0)
    .map((b) => ({ userId: b.userId, amount: b.amountOre }))
    .sort((a, b) => b.amount - a.amount)

  const debtors = balances
    .filter((b) => b.amountOre < 0)
    .map((b) => ({ userId: b.userId, amount: -b.amountOre }))
    .sort((a, b) => b.amount - a.amount)

  const transactions: SettlementTransaction[] = []
  let ci = 0
  let di = 0

  while (ci < creditors.length && di < debtors.length) {
    const creditor = creditors[ci]!
    const debtor = debtors[di]!
    const amount = Math.min(creditor.amount, debtor.amount)

    if (amount > 0) {
      transactions.push({
        fromUserId: debtor.userId,
        toUserId: creditor.userId,
        amountOre: amount,
      })
    }

    creditor.amount -= amount
    debtor.amount -= amount

    if (creditor.amount === 0) ci++
    if (debtor.amount === 0) di++
  }

  return transactions
}
