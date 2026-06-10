// Property-based tests for the settlement calculator. The example-based tests
// in settlement.test.ts pin specific known cases; these assert the invariants
// hold across thousands of randomly generated households, expense sets, and
// allocation keys — the kind of edge (huge sums, lopsided keys, everyone-paid,
// nobody-paid) that hand-written cases miss.
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { calculateSettlement, type AllocationShare } from './settlement.js'

// Generate N member ids plus an allocation key over them that sums to exactly
// 10 000 bp, with the first member flagged admin. The largest remainder is
// folded into the admin's share so the total is always exact.
const householdArb = fc
  .integer({ min: 1, max: 6 })
  .chain((n) =>
    fc.record({
      ids: fc.constant(Array.from({ length: n }, (_, i) => `u${i}`)),
      weights: fc.array(fc.integer({ min: 1, max: 100 }), { minLength: n, maxLength: n }),
    })
  )
  .map(({ ids, weights }): AllocationShare[] => {
    const totalWeight = weights.reduce((a, b) => a + b, 0)
    let allocated = 0
    const shares = ids.map((id, i) => {
      // Admin (index 0) is filled in last with the remainder.
      if (i === 0) return { userId: id, shareBp: 0, isAdmin: true }
      const bp = Math.floor((10_000 * weights[i]!) / totalWeight)
      allocated += bp
      return { userId: id, shareBp: bp, isAdmin: false }
    })
    shares[0]!.shareBp = 10_000 - allocated
    return shares
  })

// Given a set of member ids, generate a list of expenses each purchased by one
// of them, amounts up to ~1,000,000 øre (10 000 NOK).
const expensesArbFor = (ids: string[]) =>
  fc.array(
    fc.record({
      purchasedByUserId: fc.constantFrom(...ids),
      householdAmountOre: fc.integer({ min: 0, max: 1_000_000 }),
    }),
    { maxLength: 30 }
  )

const scenarioArb = householdArb.chain((shares) =>
  fc.record({
    shares: fc.constant(shares),
    expenses: expensesArbFor(shares.map((s) => s.userId)),
  })
)

describe('calculateSettlement — properties', () => {
  it('balances always sum to zero (no money created or destroyed)', () => {
    fc.assert(
      fc.property(scenarioArb, ({ expenses, shares }) => {
        const { balances } = calculateSettlement(expenses, shares)
        const sum = balances.reduce((s, b) => s + b.amountOre, 0)
        expect(sum).toBe(0)
      })
    )
  })

  it('every balance and transaction amount is an integer', () => {
    fc.assert(
      fc.property(scenarioArb, ({ expenses, shares }) => {
        const { balances, transactions } = calculateSettlement(expenses, shares)
        for (const b of balances) expect(Number.isInteger(b.amountOre)).toBe(true)
        for (const t of transactions) expect(Number.isInteger(t.amountOre)).toBe(true)
      })
    )
  })

  it('transactions are strictly positive and at most N-1 for N members', () => {
    fc.assert(
      fc.property(scenarioArb, ({ expenses, shares }) => {
        const { transactions } = calculateSettlement(expenses, shares)
        expect(transactions.length).toBeLessThanOrEqual(shares.length - 1)
        for (const t of transactions) {
          expect(t.amountOre).toBeGreaterThan(0)
          expect(t.fromUserId).not.toBe(t.toUserId)
        }
      })
    )
  })

  it('applying the transactions settles every balance to zero', () => {
    fc.assert(
      fc.property(scenarioArb, ({ expenses, shares }) => {
        const { balances, transactions } = calculateSettlement(expenses, shares)
        const net = new Map(balances.map((b) => [b.userId, b.amountOre]))
        for (const t of transactions) {
          // Debtor pays (their negative balance moves toward 0), creditor receives.
          net.set(t.fromUserId, (net.get(t.fromUserId) ?? 0) + t.amountOre)
          net.set(t.toUserId, (net.get(t.toUserId) ?? 0) - t.amountOre)
        }
        for (const v of net.values()) expect(v).toBe(0)
      })
    )
  })

  it('total transferred equals the total each debtor owes', () => {
    fc.assert(
      fc.property(scenarioArb, ({ expenses, shares }) => {
        const { balances, transactions } = calculateSettlement(expenses, shares)
        const totalOwed = balances
          .filter((b) => b.amountOre < 0)
          .reduce((s, b) => s - b.amountOre, 0)
        const totalTransferred = transactions.reduce((s, t) => s + t.amountOre, 0)
        expect(totalTransferred).toBe(totalOwed)
      })
    )
  })

  it('the rounding remainder lands on the admin: sum of non-admin shares never exceeds total', () => {
    fc.assert(
      fc.property(scenarioArb, ({ expenses, shares }) => {
        const total = expenses.reduce((s, e) => s + e.householdAmountOre, 0)
        const { balances } = calculateSettlement(expenses, shares)
        // Reconstruct each member's share: share = paid - balance.
        const paid = new Map<string, number>()
        for (const e of expenses) {
          paid.set(
            e.purchasedByUserId,
            (paid.get(e.purchasedByUserId) ?? 0) + e.householdAmountOre
          )
        }
        const adminId = shares.find((s) => s.isAdmin)!.userId
        let nonAdminShareSum = 0
        for (const b of balances) {
          const share = (paid.get(b.userId) ?? 0) - b.amountOre
          expect(share).toBeGreaterThanOrEqual(0)
          if (b.userId !== adminId) nonAdminShareSum += share
        }
        // All shares sum to the total, so non-admin shares never exceed it;
        // the admin absorbs the rounding remainder.
        expect(nonAdminShareSum).toBeLessThanOrEqual(total)
      })
    )
  })
})
