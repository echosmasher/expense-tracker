import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { settlements } from '@expense-tracker/shared'
import type { Settlement, SettlementHistoryRow } from '@expense-tracker/shared'
import { useHouseholdStore } from '../../stores/householdStore'

function formatNok(ore: number) {
  return `kr ${(Math.abs(ore) / 100).toFixed(2).replace('.', ',')}`
}

function formatDate(value: string | null) {
  if (!value) return null
  return new Date(value).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' })
}

function legacyMonthLabel(year: number | null, month: number | null) {
  if (!year || !month) return null
  return new Date(year, month - 1, 1).toLocaleDateString('nb-NO', { month: 'long', year: 'numeric' })
}

function primaryLabel(summary: SettlementHistoryRow): string {
  const triggered = formatDate(summary.triggeredAt)
  if (triggered) return `Triggered ${triggered}`
  const legacy = legacyMonthLabel(summary.periodYear, summary.periodMonth)
  return legacy ?? '—'
}

function coveredLabel(summary: SettlementHistoryRow): string | null {
  if (summary.coveredFrom && summary.coveredTo) {
    const from = formatDate(summary.coveredFrom)
    const to = formatDate(summary.coveredTo)
    if (from && to) return from === to ? `Covers ${from}` : `Covers ${from} – ${to}`
  }
  // Legacy fallback for pre-spec-003 rows with no snapshot range.
  const legacy = legacyMonthLabel(summary.periodYear, summary.periodMonth)
  return legacy ? `Period ${legacy}` : null
}

function IncludedExpensesByMonth({ expenses }: { expenses: Settlement['includedExpenses'] }) {
  const groups = new Map<string, { label: string; rows: Settlement['includedExpenses']; total: number }>()
  for (const e of expenses) {
    const d = e.expenseDate ? new Date(e.expenseDate) : null
    const key = d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : 'unknown'
    const label = d
      ? d.toLocaleDateString('nb-NO', { month: 'long', year: 'numeric' })
      : 'Undated'
    if (!groups.has(key)) groups.set(key, { label, rows: [], total: 0 })
    const g = groups.get(key)!
    g.rows.push(e)
    g.total += e.totalAmountOre
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => (a < b ? 1 : -1))
  return (
    <div className="history-included">
      <div className="history-included-label">Receipts in this settlement</div>
      {ordered.map(([key, g]) => (
        <div key={key} className="history-included-group">
          <div className="history-included-month">
            <span>{g.label}</span>
            <span className="history-included-month-total">{formatNok(g.total)}</span>
          </div>
          {g.rows.map((row) => (
            <div key={row.id} className="history-included-row">
              <span className="history-included-store">
                {row.storeName ?? 'Receipt'}
                {row.expenseDate && (
                  <span className="history-included-date">
                    {' · '}{new Date(row.expenseDate).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })}
                  </span>
                )}
              </span>
              <span className="history-included-amount">{formatNok(row.totalAmountOre)}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function SettlementCard({
  summary,
  householdId,
}: {
  summary: SettlementHistoryRow
  householdId: string
}) {
  const [expanded, setExpanded] = useState(false)
  const [detail, setDetail] = useState<Settlement | null>(null)
  const [loading, setLoading] = useState(false)

  async function toggleExpand() {
    if (!expanded && !detail) {
      setLoading(true)
      try {
        const data = await settlements.get(householdId, summary.id)
        setDetail(data)
      } catch {
        // silently fail
      } finally {
        setLoading(false)
      }
    }
    setExpanded((prev) => !prev)
  }

  const totalTransferred = detail?.transactions.reduce((sum, t) => sum + t.amountOre, 0) ?? null
  const covered = coveredLabel(summary)

  return (
    <div className="history-card">
      <button className="history-card-header" onClick={toggleExpand}>
        <div className="history-card-left">
          <span className="history-period">
            {primaryLabel(summary)}
          </span>
          {covered && <span className="history-created">{covered}</span>}
          <span className="history-total">
            {formatNok(summary.totalAmountOre)} settled
            {totalTransferred !== null && totalTransferred !== summary.totalAmountOre && (
              <> · {formatNok(totalTransferred)} transferred</>
            )}
          </span>
        </div>
        <div className="history-card-right">
          <span className={`history-status history-status--${summary.status}`}>
            {summary.status === 'completed' ? 'Settled' : 'Open'}
          </span>
          <span className="history-chevron">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {expanded && (
        <div className="history-detail">
          {loading && <p className="history-loading">Loading…</p>}
          {detail && detail.transactions.length === 0 && (
            <p className="history-no-tx">No transfers — everyone was even.</p>
          )}
          {detail && detail.transactions.map((tx) => (
            <div key={tx.id} className="history-tx">
              <span className="history-tx-names">
                {tx.fromName} → {tx.toName}
              </span>
              <span className={`history-tx-amount ${tx.paidAt ? 'history-tx-amount--paid' : ''}`}>
                {formatNok(tx.amountOre)}
                {tx.paidAt && ' ✓'}
              </span>
            </div>
          ))}
          {detail && detail.balances.length > 0 && (
            <div className="history-balances">
              {detail.balances.map((b) => (
                <div key={b.userId} className="history-balance">
                  <span>{b.name}</span>
                  <span className={`hb-amount ${b.amountOre > 0 ? 'hb-amount--credit' : b.amountOre < 0 ? 'hb-amount--debit' : ''}`}>
                    {b.amountOre >= 0 ? '+' : ''}{formatNok(b.amountOre)}
                  </span>
                </div>
              ))}
            </div>
          )}
          {detail && detail.includedExpenses.length > 0 && (
            <IncludedExpensesByMonth expenses={detail.includedExpenses} />
          )}
        </div>
      )}
    </div>
  )
}

export function History() {
  const navigate = useNavigate()
  const household = useHouseholdStore((s) => s.household)
  const [summaries, setSummaries] = useState<SettlementHistoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!household) return
    settlements.list(household.id)
      .then((data) => {
        setSummaries(data.settlements)
        setLoading(false)
      })
      .catch((err) => {
        setError(err?.message ?? 'Failed to load history.')
        setLoading(false)
      })
  }, [household?.id])

  const completed = summaries.filter((s) => s.status === 'completed')
  const open = summaries.filter((s) => s.status === 'open')

  return (
    <div className="history-page">
      <div className="history-topbar">
        <button className="back-btn" onClick={() => navigate('/settlement')}>← Active</button>
        <h1 className="history-title">Settlement history</h1>
      </div>

      {loading && <p className="history-msg">Loading…</p>}
      {error && <p className="history-msg history-msg--error">{error}</p>}

      {!loading && summaries.length === 0 && (
        <p className="history-msg">No past settlements yet.</p>
      )}

      {open.length > 0 && (
        <section className="history-section">
          <h2 className="section-label">Open</h2>
          {open.map((s) => (
            <SettlementCard key={s.id} summary={s} householdId={household!.id} />
          ))}
        </section>
      )}

      {completed.length > 0 && (
        <section className="history-section">
          <h2 className="section-label">Completed</h2>
          {completed.map((s) => (
            <SettlementCard key={s.id} summary={s} householdId={household!.id} />
          ))}
        </section>
      )}

      <style>{`

        .history-page {
          max-width: 720px;
          margin: 0 auto;
          padding: 1.25rem 1rem 2rem;
          font-family: 'Geist', sans-serif;
          color: #f4f4f5;
        }
        .history-topbar {
          display: flex;
          align-items: center;
          gap: 1rem;
          margin-bottom: 1.5rem;
        }
        .back-btn {
          background: none; border: none;
          color: #818cf8; font-size: 0.9rem;
          cursor: pointer; padding: 0;
          font-family: inherit;
          white-space: nowrap;
        }
        .history-title {
          font-size: 1.25rem;
          font-weight: 600;
          margin: 0;
          letter-spacing: -0.02em;
        }
        .history-msg {
          color: #71717a; font-size: 0.9rem;
          text-align: center; padding: 2rem 0; margin: 0;
        }
        .history-msg--error { color: #f87171; }
        .history-section { margin-bottom: 1.75rem; }
        .section-label {
          font-size: 0.75rem;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: #71717a;
          margin: 0 0 0.625rem 0.25rem;
        }
        .history-card {
          background: #18181b;
          border: 1px solid #27272a;
          border-radius: 12px;
          overflow: hidden;
          margin-bottom: 0.5rem;
        }
        .history-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          background: none;
          border: none;
          padding: 0.875rem 1rem;
          cursor: pointer;
          font-family: inherit;
          text-align: left;
          gap: 0.5rem;
        }
        .history-card-header:hover { background: #1f1f22; }
        .history-card-left {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .history-period {
          font-size: 0.9rem;
          font-weight: 500;
          color: #f4f4f5;
          text-transform: capitalize;
          display: flex;
          align-items: baseline;
          gap: 0.5rem;
        }
        .history-created {
          font-size: 0.72rem;
          font-weight: 400;
          color: #52525b;
          text-transform: none;
        }
        .history-total {
          font-family: 'DM Mono', monospace;
          font-size: 0.78rem;
          color: #71717a;
        }
        .history-card-right {
          display: flex;
          align-items: center;
          gap: 0.625rem;
          flex-shrink: 0;
        }
        .history-status {
          font-size: 0.7rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 0.2rem 0.5rem;
          border-radius: 5px;
        }
        .history-status--completed {
          background: #27272a;
          color: #71717a;
          border: 1px solid #3f3f46;
        }
        .history-status--open {
          background: rgba(251,191,36,0.12);
          color: #fbbf24;
          border: 1px solid rgba(251,191,36,0.2);
        }
        .history-chevron { color: #52525b; font-size: 0.65rem; }
        .history-detail {
          border-top: 1px solid #27272a;
          padding: 0.75rem 1rem;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .history-loading, .history-no-tx {
          color: #52525b; font-size: 0.85rem; margin: 0; padding: 0.25rem 0;
        }
        .history-tx {
          display: flex;
          justify-content: space-between;
          font-size: 0.85rem;
          color: #a1a1aa;
        }
        .history-tx-amount {
          font-family: 'DM Mono', monospace;
          color: #f4f4f5;
        }
        .history-tx-amount--paid { color: #4ade80; }
        .history-balances {
          border-top: 1px solid #27272a;
          padding-top: 0.5rem;
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
        }
        .history-balance {
          display: flex;
          justify-content: space-between;
          font-size: 0.8rem;
          color: #71717a;
        }
        .hb-amount { font-family: 'DM Mono', monospace; }
        .hb-amount--credit { color: #4ade80; }
        .hb-amount--debit { color: #f87171; }
        .history-included {
          border-top: 1px solid #27272a;
          padding-top: 0.6rem;
          display: flex;
          flex-direction: column;
          gap: 0.6rem;
        }
        .history-included-label {
          font-size: 0.7rem;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #52525b;
        }
        .history-included-group {
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
        }
        .history-included-month {
          display: flex;
          justify-content: space-between;
          font-size: 0.78rem;
          color: #a1a1aa;
          text-transform: capitalize;
        }
        .history-included-month-total {
          font-family: 'DM Mono', monospace;
        }
        .history-included-row {
          display: flex;
          justify-content: space-between;
          font-size: 0.78rem;
          color: #71717a;
          padding-left: 0.75rem;
        }
        .history-included-store { color: #a1a1aa; }
        .history-included-date { color: #52525b; }
        .history-included-amount { font-family: 'DM Mono', monospace; }
      `}</style>
    </div>
  )
}
