import { describe, it, expect } from 'vitest'
import {
  calculateSettlement,
  type AllocationShare,
  type ExpenseForSettlement,
} from './settlement.js'

const alice = 'alice'
const bob = 'bob'
const carol = 'carol'

const fiftyFifty: AllocationShare[] = [
  { userId: alice, shareBp: 5000, isAdmin: true },
  { userId: bob, shareBp: 5000, isAdmin: false },
]

describe('calculateSettlement', () => {
  it('returns zero balances and no transactions when there are no expenses', () => {
    const result = calculateSettlement([], fiftyFifty)

    expect(result.transactions).toEqual([])
    expect(result.balances).toEqual([
      { userId: alice, amountOre: 0 },
      { userId: bob, amountOre: 0 },
    ])
  })

  it('settles a single expense between two equal members', () => {
    const expenses: ExpenseForSettlement[] = [{ purchasedByUserId: alice, householdAmountOre: 1000 }]

    const { balances, transactions } = calculateSettlement(expenses, fiftyFifty)

    expect(balances).toEqual([
      { userId: alice, amountOre: 500 },
      { userId: bob, amountOre: -500 },
    ])
    expect(transactions).toEqual([{ fromUserId: bob, toUserId: alice, amountOre: 500 }])
  })

  it('produces no transactions when both members paid their own share', () => {
    const expenses: ExpenseForSettlement[] = [
      { purchasedByUserId: alice, householdAmountOre: 500 },
      { purchasedByUserId: bob, householdAmountOre: 500 },
    ]

    const { balances, transactions } = calculateSettlement(expenses, fiftyFifty)

    expect(balances).toEqual([
      { userId: alice, amountOre: 0 },
      { userId: bob, amountOre: 0 },
    ])
    expect(transactions).toEqual([])
  })

  it('routes rounding remainder to the admin', () => {
    // totalOre = 1003, 50/50 shares.
    // Non-admin (bob) gets floor(1003 * 5000 / 10000) = floor(501.5) = 501.
    // Admin (alice) gets 1003 - 501 = 502 (gets the extra øre).
    const expenses: ExpenseForSettlement[] = [{ purchasedByUserId: alice, householdAmountOre: 1003 }]

    const { balances } = calculateSettlement(expenses, fiftyFifty)

    // Alice paid 1003 - share 502 = 501 owed back. Bob paid 0 - share 501 = -501 owed.
    expect(balances).toEqual([
      { userId: alice, amountOre: 501 },
      { userId: bob, amountOre: -501 },
    ])
  })

  it('preserves the sum invariant: balances always sum to zero', () => {
    const expenses: ExpenseForSettlement[] = [
      { purchasedByUserId: alice, householdAmountOre: 12345 },
      { purchasedByUserId: bob, householdAmountOre: 6789 },
      { purchasedByUserId: carol, householdAmountOre: 111 },
    ]
    const shares: AllocationShare[] = [
      { userId: alice, shareBp: 4000, isAdmin: true },
      { userId: bob, shareBp: 3500, isAdmin: false },
      { userId: carol, shareBp: 2500, isAdmin: false },
    ]

    const { balances, transactions } = calculateSettlement(expenses, shares)

    const balanceSum = balances.reduce((sum, b) => sum + b.amountOre, 0)
    expect(balanceSum).toBe(0)

    // Transactions must also net to zero per member when applied to balances.
    const netByUser = new Map(balances.map((b) => [b.userId, b.amountOre]))
    for (const tx of transactions) {
      netByUser.set(tx.fromUserId, (netByUser.get(tx.fromUserId) ?? 0) + tx.amountOre)
      netByUser.set(tx.toUserId, (netByUser.get(tx.toUserId) ?? 0) - tx.amountOre)
    }
    for (const v of netByUser.values()) expect(v).toBe(0)
  })

  it('emits at most N-1 transactions for N members', () => {
    const expenses: ExpenseForSettlement[] = [
      { purchasedByUserId: alice, householdAmountOre: 1000 },
      { purchasedByUserId: bob, householdAmountOre: 2500 },
      { purchasedByUserId: carol, householdAmountOre: 0 },
    ]
    const shares: AllocationShare[] = [
      { userId: alice, shareBp: 3333, isAdmin: true },
      { userId: bob, shareBp: 3333, isAdmin: false },
      { userId: carol, shareBp: 3334, isAdmin: false },
    ]

    const { transactions } = calculateSettlement(expenses, shares)
    expect(transactions.length).toBeLessThanOrEqual(shares.length - 1)
  })

  it('honours uneven allocation keys', () => {
    // Alice (admin) 70%, Bob 30%. Bob paid 1000 øre solo.
    const expenses: ExpenseForSettlement[] = [{ purchasedByUserId: bob, householdAmountOre: 1000 }]
    const shares: AllocationShare[] = [
      { userId: alice, shareBp: 7000, isAdmin: true },
      { userId: bob, shareBp: 3000, isAdmin: false },
    ]

    const { balances } = calculateSettlement(expenses, shares)

    // Bob's share: floor(1000 * 3000 / 10000) = 300. Alice's share: 1000 - 300 = 700 (admin).
    // Bob paid 1000 - share 300 = 700 owed. Alice paid 0 - share 700 = -700 owed.
    expect(balances).toEqual([
      { userId: alice, amountOre: -700 },
      { userId: bob, amountOre: 700 },
    ])
  })

  it('throws when shares do not sum to 10000 bp', () => {
    const bad: AllocationShare[] = [
      { userId: alice, shareBp: 6000, isAdmin: true },
      { userId: bob, shareBp: 3000, isAdmin: false },
    ]
    expect(() => calculateSettlement([], bad)).toThrow(/sum to 10000/)
  })

  it('throws when no admin member is provided', () => {
    const bad: AllocationShare[] = [
      { userId: alice, shareBp: 5000, isAdmin: false },
      { userId: bob, shareBp: 5000, isAdmin: false },
    ]
    expect(() => calculateSettlement([], bad)).toThrow(/admin/i)
  })

  it('never returns fractional amounts (integer øre throughout)', () => {
    const expenses: ExpenseForSettlement[] = [
      { purchasedByUserId: alice, householdAmountOre: 9999 },
      { purchasedByUserId: bob, householdAmountOre: 7777 },
    ]
    const shares: AllocationShare[] = [
      { userId: alice, shareBp: 3333, isAdmin: true },
      { userId: bob, shareBp: 3333, isAdmin: false },
      { userId: carol, shareBp: 3334, isAdmin: false },
    ]

    const { balances, transactions } = calculateSettlement(expenses, shares)

    for (const b of balances) expect(Number.isInteger(b.amountOre)).toBe(true)
    for (const tx of transactions) expect(Number.isInteger(tx.amountOre)).toBe(true)
  })
})
