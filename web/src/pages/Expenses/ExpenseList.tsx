import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { expenses } from '@expense-tracker/shared'
import type { Expense } from '@expense-tracker/shared'
import { useHouseholdStore } from '../../stores/householdStore'
import { useExpenseStore } from '../../stores/expenseStore'

function formatNok(ore: number) {
  return `kr ${(ore / 100).toFixed(2).replace('.', ',')}`
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })
}

function StatusPill({ status }: { status: Expense['status'] }) {
  return <span className={`status-pill status-pill--${status}`}>{statusLabel(status)}</span>
}

function statusLabel(status: Expense['status']) {
  return status === 'pending_review' ? 'Review' : status === 'confirmed' ? 'Confirmed' : 'Settled'
}

function MonthGroup({ month, items }: { month: string; items: Expense[] }) {
  const navigate = useNavigate()
  const label = new Date(month + '-01').toLocaleDateString('nb-NO', { month: 'long', year: 'numeric' })
  const total = items.reduce((sum, e) => sum + e.totalAmountOre, 0)

  return (
    <div className="month-group">
      <div className="month-header">
        <span className="month-label">{label}</span>
        <span className="month-total">{formatNok(total)}</span>
      </div>
      <ul className="expense-list">
        {items.map((expense) => (
          <li
            key={expense.id}
            className="expense-item"
            onClick={() => navigate(`/expenses/${expense.id}`)}
          >
            <div className="expense-left">
              <span className="expense-store">{expense.store ?? 'Unknown store'}</span>
              <span className="expense-purchaser">{expense.purchaserName}</span>
            </div>
            <div className="expense-right">
              <span className="expense-amount">{formatNok(expense.totalAmountOre)}</span>
              <StatusPill status={expense.status} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ExpenseList() {
  const navigate = useNavigate()
  const household = useHouseholdStore((s) => s.household)
  const { expenses: stored, setExpenses } = useExpenseStore()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!household) return
    expenses.list(household.id)
      .then((data) => {
        setExpenses(data.expenses)
        setLoading(false)
      })
      .catch((err) => {
        setError(err?.message ?? 'Failed to load expenses.')
        setLoading(false)
      })
  }, [household?.id])

  // Group by month (YYYY-MM)
  const grouped = stored.reduce<Record<string, Expense[]>>((acc, expense) => {
    const month = expense.date ? expense.date.slice(0, 7) : 'unknown'
    if (!acc[month]) acc[month] = []
    acc[month]!.push(expense)
    return acc
  }, {})

  const months = Object.keys(grouped).sort((a, b) => b.localeCompare(a))

  return (
    <div className="expense-list-page">
      <div className="list-header">
        <h1 className="page-title">Expenses</h1>
        <button className="add-btn" onClick={() => navigate('/expenses/new')}>
          + Add
        </button>
      </div>

      {loading && <p className="list-loading">Loading…</p>}
      {error && <p className="list-error">{error}</p>}
      {!loading && !error && stored.length === 0 && (
        <div className="list-empty">
          <p className="list-empty-title">No expenses yet</p>
          <p className="list-empty-hint">Upload a receipt to get started.</p>
          <button className="list-empty-cta" onClick={() => navigate('/expenses/new')}>
            Add first expense
          </button>
        </div>
      )}

      {months.map((month) => (
        <MonthGroup key={month} month={month} items={grouped[month]!} />
      ))}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Geist:wght@300;400;500;600&display=swap');

        .expense-list-page {
          max-width: 480px;
          margin: 0 auto;
          padding: 1.5rem 1rem 5rem;
          font-family: 'Geist', sans-serif;
          color: #f4f4f5;
          min-height: 100dvh;
          background: #09090b;
        }
        .list-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 1.5rem;
        }
        .page-title {
          font-size: 1.375rem;
          font-weight: 600;
          margin: 0;
          letter-spacing: -0.025em;
        }
        .add-btn {
          background: #6366f1;
          border: none;
          border-radius: 10px;
          color: #fff;
          font-size: 0.875rem;
          font-weight: 500;
          padding: 0.5rem 1rem;
          cursor: pointer;
          font-family: inherit;
          transition: background 0.15s;
        }
        .add-btn:hover { background: #4f46e5; }
        .list-loading, .list-error {
          color: #71717a;
          font-size: 0.9rem;
          text-align: center;
          padding: 2rem 0;
          margin: 0;
        }
        .list-error { color: #f87171; }
        .list-empty {
          text-align: center;
          padding: 3rem 0;
        }
        .list-empty-title {
          font-size: 1rem;
          font-weight: 500;
          color: #a1a1aa;
          margin: 0 0 0.4rem;
        }
        .list-empty-hint { color: #52525b; font-size: 0.875rem; margin: 0 0 1.5rem; }
        .list-empty-cta {
          background: #6366f1;
          border: none;
          border-radius: 10px;
          color: #fff;
          font-size: 0.875rem;
          font-weight: 500;
          padding: 0.6rem 1.25rem;
          cursor: pointer;
          font-family: inherit;
        }
        .month-group { margin-bottom: 1.75rem; }
        .month-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 0.5rem;
          padding: 0 0.25rem;
        }
        .month-label {
          font-size: 0.75rem;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: #71717a;
        }
        .month-total {
          font-family: 'DM Mono', monospace;
          font-size: 0.8rem;
          color: #71717a;
        }
        .expense-list {
          list-style: none;
          margin: 0;
          padding: 0;
          background: #18181b;
          border: 1px solid #27272a;
          border-radius: 14px;
          overflow: hidden;
        }
        .expense-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.875rem 1rem;
          border-bottom: 1px solid #1f1f22;
          cursor: pointer;
          transition: background 0.1s;
        }
        .expense-item:last-child { border-bottom: none; }
        .expense-item:hover { background: #1f1f22; }
        .expense-item:active { background: #27272a; }
        .expense-left { display: flex; flex-direction: column; gap: 3px; }
        .expense-store { font-size: 0.9rem; font-weight: 500; color: #f4f4f5; }
        .expense-purchaser { font-size: 0.78rem; color: #71717a; }
        .expense-right { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
        .expense-amount {
          font-family: 'DM Mono', monospace;
          font-size: 0.9rem;
          color: #f4f4f5;
          font-weight: 500;
        }
        .status-pill {
          font-size: 0.7rem;
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          padding: 0.15rem 0.45rem;
          border-radius: 5px;
        }
        .status-pill--pending_review {
          background: rgba(234,179,8,0.12);
          color: #fbbf24;
          border: 1px solid rgba(234,179,8,0.2);
        }
        .status-pill--confirmed {
          background: rgba(34,197,94,0.1);
          color: #4ade80;
          border: 1px solid rgba(34,197,94,0.2);
        }
        .status-pill--settled {
          background: #27272a;
          color: #71717a;
          border: 1px solid #3f3f46;
        }
      `}</style>
    </div>
  )
}
