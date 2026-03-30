import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { expenses } from '@expense-tracker/shared'
import type { Expense } from '@expense-tracker/shared'
import { useHouseholdStore } from '../../stores/householdStore'
import { useExpenseStore } from '../../stores/expenseStore'

function formatNok(ore: number) {
  return `kr ${(ore / 100).toFixed(2).replace('.', ',')}`
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' })
}

export function ExpenseDetail() {
  const { expenseId } = useParams<{ expenseId: string }>()
  const navigate = useNavigate()
  const household = useHouseholdStore((s) => s.household)
  const addOrUpdateExpense = useExpenseStore((s) => s.addOrUpdateExpense)
  const storedExpenses = useExpenseStore((s) => s.expenses)

  const [expense, setExpense] = useState<Expense | null>(
    storedExpenses.find((e) => e.id === expenseId) ?? null
  )
  const [loading, setLoading] = useState(!expense)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!household || !expenseId || expense) return
    expenses.get(household.id, expenseId)
      .then((data) => {
        setExpense(data)
        setLoading(false)
      })
      .catch((err) => {
        setError(err?.message ?? 'Failed to load expense.')
        setLoading(false)
      })
  }, [expenseId, household?.id])

  async function handleConfirm() {
    if (!household || !expenseId) return
    setConfirming(true)
    try {
      const confirmed = await expenses.confirm(household.id, expenseId)
      setExpense(confirmed)
      addOrUpdateExpense(confirmed)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to confirm expense.')
    } finally {
      setConfirming(false)
    }
  }

  const householdTotal = expense?.lineItems
    .filter((li) => !li.isPersonal)
    .reduce((sum, li) => sum + li.unitPriceOre * li.quantity, 0) ?? 0

  const personalTotal = expense?.lineItems
    .filter((li) => li.isPersonal)
    .reduce((sum, li) => sum + li.unitPriceOre * li.quantity, 0) ?? 0

  return (
    <div className="detail-page">
      <div className="detail-topbar">
        <button className="back-btn" onClick={() => navigate('/expenses')}>← Back</button>
      </div>

      {loading && <p className="detail-loading">Loading…</p>}
      {error && <p className="detail-error">{error}</p>}

      {expense && (
        <>
          <div className="detail-head">
            <h1 className="detail-store">{expense.store ?? 'Unknown store'}</h1>
            <p className="detail-meta">
              {formatDate(expense.date)} · {expense.purchaserName}
              {expense.cardLastFour && <> · •••• {expense.cardLastFour}</>}
            </p>
            <div className="detail-total">{formatNok(expense.totalAmountOre)}</div>
          </div>

          {expense.receiptImageUrl && (
            <a href={expense.receiptImageUrl} target="_blank" rel="noopener noreferrer">
              <img src={expense.receiptImageUrl} alt="Receipt" className="detail-receipt-img" />
            </a>
          )}

          <section className="detail-section">
            <h2 className="section-title">Line items</h2>
            <ul className="line-items">
              {expense.lineItems.map((item) => (
                <li key={item.id} className={`line-item ${item.isPersonal ? 'line-item--personal' : ''}`}>
                  <div className="line-item-left">
                    <span className="line-item-desc">{item.description}</span>
                    {item.quantity !== 1 && (
                      <span className="line-item-qty">× {item.quantity}</span>
                    )}
                  </div>
                  <div className="line-item-right">
                    <span className="line-item-price">
                      {formatNok(item.unitPriceOre * item.quantity)}
                    </span>
                    {item.isPersonal && <span className="personal-tag">personal</span>}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {(householdTotal > 0 || personalTotal > 0) && (
            <section className="detail-section">
              <h2 className="section-title">Breakdown</h2>
              <div className="breakdown">
                <div className="breakdown-row">
                  <span>Household expenses</span>
                  <span className="breakdown-amount">{formatNok(householdTotal)}</span>
                </div>
                {personalTotal > 0 && (
                  <div className="breakdown-row breakdown-row--personal">
                    <span>Personal items</span>
                    <span className="breakdown-amount">{formatNok(personalTotal)}</span>
                  </div>
                )}
              </div>
            </section>
          )}

          {expense.status === 'pending_review' && (
            <div className="detail-action">
              <p className="detail-action-hint">
                Review the line items above, then confirm this expense to include it in settlement.
              </p>
              <button
                className="confirm-btn"
                disabled={confirming}
                onClick={handleConfirm}
              >
                {confirming ? 'Confirming…' : 'Confirm expense'}
              </button>
            </div>
          )}

          {expense.status === 'confirmed' && (
            <div className="detail-confirmed-banner">
              ✓ Confirmed — included in this month's settlement
            </div>
          )}

          {expense.status === 'settled' && (
            <div className="detail-settled-banner">
              ✓ Settled
            </div>
          )}
        </>
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Geist:wght@300;400;500;600&display=swap');

        .detail-page {
          max-width: 480px;
          margin: 0 auto;
          padding: 1.25rem 1rem 5rem;
          font-family: 'Geist', sans-serif;
          color: #f4f4f5;
          min-height: 100dvh;
          background: #09090b;
        }
        .detail-topbar { margin-bottom: 1.25rem; }
        .back-btn {
          background: none;
          border: none;
          color: #818cf8;
          font-size: 0.9rem;
          cursor: pointer;
          padding: 0;
          font-family: inherit;
        }
        .detail-loading, .detail-error {
          color: #71717a; font-size: 0.9rem; text-align: center; padding: 2rem 0; margin: 0;
        }
        .detail-error { color: #f87171; }
        .detail-head { margin-bottom: 1.25rem; }
        .detail-store {
          font-size: 1.375rem;
          font-weight: 600;
          margin: 0 0 0.3rem;
          letter-spacing: -0.025em;
        }
        .detail-meta { color: #71717a; font-size: 0.85rem; margin: 0 0 0.75rem; }
        .detail-total {
          font-family: 'DM Mono', monospace;
          font-size: 1.75rem;
          font-weight: 500;
          color: #f4f4f5;
          letter-spacing: -0.02em;
        }
        .detail-receipt-img {
          width: 100%;
          border-radius: 12px;
          border: 1px solid #27272a;
          margin-bottom: 1.5rem;
          max-height: 220px;
          object-fit: cover;
          display: block;
        }
        .detail-section { margin-bottom: 1.25rem; }
        .section-title {
          font-size: 0.75rem;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: #71717a;
          margin: 0 0 0.625rem 0.25rem;
        }
        .line-items {
          list-style: none;
          margin: 0;
          padding: 0;
          background: #18181b;
          border: 1px solid #27272a;
          border-radius: 12px;
          overflow: hidden;
        }
        .line-item {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          padding: 0.75rem 1rem;
          border-bottom: 1px solid #1f1f22;
          gap: 0.75rem;
        }
        .line-item:last-child { border-bottom: none; }
        .line-item--personal { opacity: 0.7; }
        .line-item-left { display: flex; flex-direction: column; gap: 2px; flex: 1; }
        .line-item-desc { font-size: 0.875rem; color: #e4e4e7; }
        .line-item-qty { font-size: 0.75rem; color: #71717a; }
        .line-item-right { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; flex-shrink: 0; }
        .line-item-price {
          font-family: 'DM Mono', monospace;
          font-size: 0.875rem;
          color: #f4f4f5;
        }
        .personal-tag {
          font-size: 0.68rem;
          color: #a78bfa;
          background: rgba(167,139,250,0.1);
          border: 1px solid rgba(167,139,250,0.2);
          border-radius: 4px;
          padding: 0.1rem 0.35rem;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          font-weight: 500;
        }
        .breakdown {
          background: #18181b;
          border: 1px solid #27272a;
          border-radius: 12px;
          overflow: hidden;
        }
        .breakdown-row {
          display: flex;
          justify-content: space-between;
          padding: 0.75rem 1rem;
          font-size: 0.875rem;
          color: #a1a1aa;
          border-bottom: 1px solid #1f1f22;
        }
        .breakdown-row:last-child { border-bottom: none; }
        .breakdown-row--personal { color: #71717a; }
        .breakdown-amount {
          font-family: 'DM Mono', monospace;
          color: #f4f4f5;
        }
        .detail-action {
          background: #18181b;
          border: 1px solid #27272a;
          border-radius: 14px;
          padding: 1.25rem;
          margin-top: 0.5rem;
        }
        .detail-action-hint {
          font-size: 0.85rem;
          color: #71717a;
          margin: 0 0 1rem;
          line-height: 1.5;
        }
        .confirm-btn {
          width: 100%;
          background: #6366f1;
          border: none;
          border-radius: 10px;
          color: #fff;
          font-size: 0.9375rem;
          font-weight: 500;
          padding: 0.7rem 1.25rem;
          cursor: pointer;
          font-family: inherit;
          transition: background 0.15s, opacity 0.15s;
        }
        .confirm-btn:hover { background: #4f46e5; }
        .confirm-btn:disabled { opacity: 0.45; cursor: not-allowed; }
        .detail-confirmed-banner, .detail-settled-banner {
          background: rgba(34,197,94,0.08);
          border: 1px solid rgba(34,197,94,0.2);
          border-radius: 10px;
          color: #4ade80;
          font-size: 0.875rem;
          font-weight: 500;
          padding: 0.75rem 1rem;
          text-align: center;
          margin-top: 0.5rem;
        }
        .detail-settled-banner {
          background: #27272a;
          border-color: #3f3f46;
          color: #71717a;
        }
      `}</style>
    </div>
  )
}
