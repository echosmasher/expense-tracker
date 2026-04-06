import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { settlements } from '@expense-tracker/shared'
import type { Settlement } from '@expense-tracker/shared'
import { useAuthStore } from '../../stores/authStore'
import { useHouseholdStore } from '../../stores/householdStore'
import { useSettlementStore } from '../../stores/settlementStore'

function formatNok(ore: number) {
  return `kr ${(Math.abs(ore) / 100).toFixed(2).replace('.', ',')}`
}

function monthLabel(year: number | null, month: number | null) {
  if (!year || !month) return '—'
  return new Date(year, month - 1, 1).toLocaleDateString('nb-NO', { month: 'long', year: 'numeric' })
}

// ─── Transaction row ──────────────────────────────────────────────────────────

function TransactionRow({
  tx,
  settlementId,
  currentUserId,
  canMark,
}: {
  tx: Settlement['transactions'][number]
  settlementId: string
  currentUserId: string
  canMark: boolean
}) {
  const updateTransaction = useSettlementStore((s) => s.updateTransaction)
  const [marking, setMarking] = useState(false)

  const isOwed = tx.toUserId === currentUserId
  const owes = tx.fromUserId === currentUserId
  const isPaid = !!tx.paidAt

  async function handleMarkPaid() {
    setMarking(true)
    try {
      const result = await settlements.markPaid(settlementId, tx.id)
      updateTransaction(settlementId, tx.id, result.paidAt)
    } catch (err) {
      console.error('Failed to mark paid', err)
    } finally {
      setMarking(false)
    }
  }

  return (
    <div className={`tx-row ${isPaid ? 'tx-row--paid' : ''}`}>
      <div className="tx-info">
        <span className="tx-label">
          <strong className={owes ? 'tx-you' : ''}>{owes ? 'You' : tx.fromName}</strong>
          {' → '}
          <strong className={isOwed ? 'tx-you' : ''}>{isOwed ? 'you' : tx.toName}</strong>
        </span>
        <span className="tx-amount">{formatNok(tx.amountOre)}</span>
      </div>
      {isPaid ? (
        <span className="tx-paid-badge">✓ Paid</span>
      ) : canMark ? (
        <button className="tx-mark-btn" disabled={marking} onClick={handleMarkPaid}>
          {marking ? '…' : 'Mark paid'}
        </button>
      ) : null}
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function CurrentMonth() {
  const navigate = useNavigate()
  const userId = useAuthStore((s) => s.userId)!
  const household = useHouseholdStore((s) => s.household)
  const { currentSettlement, setCurrentSettlement } = useSettlementStore()
  const [loading, setLoading] = useState(true)
  const [triggering, setTriggering] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isAdmin = household?.members.find((m) => m.userId === userId)?.role === 'admin'

  useEffect(() => {
    if (!household) return
    // Load most recent open settlement
    settlements.list(household.id)
      .then((data) => {
        const open = (data as any).settlements?.find((s: any) => s.status === 'open')
        if (open) {
          return settlements.get(household.id, open.id).then((full) => {
            setCurrentSettlement(full)
          })
        }
      })
      .catch((err) => setError(err?.message ?? 'Failed to load settlement.'))
      .finally(() => setLoading(false))
  }, [household?.id])

  async function handleTrigger() {
    if (!household) return
    setTriggering(true)
    setError(null)
    try {
      const settlement = await settlements.trigger(household.id)
      setCurrentSettlement(settlement)
    } catch (err: any) {
      if (err?.status === 409) {
        const code = err?.code
        if (code === 'OPEN_SETTLEMENT_EXISTS') {
          setError('An open settlement already exists for this period. Complete it first.')
        } else if (code === 'NO_EXPENSES') {
          setError('No unsettled confirmed expenses for this period.')
        } else {
          setError('Settlement for this period already exists.')
        }
      } else {
        setError(err?.message ?? 'Failed to trigger settlement.')
      }
    } finally {
      setTriggering(false)
    }
  }

  const allPaid = currentSettlement?.transactions.every((t) => !!t.paidAt) ?? false

  return (
    <div className="settlement-page">
      <div className="settlement-header">
        <h1 className="settlement-title">Settlement</h1>
        <button className="history-link" onClick={() => navigate('/settlement/history')}>
          History →
        </button>
      </div>

      {loading && <p className="settlement-loading">Loading…</p>}
      {error && <p className="settlement-error">{error}</p>}

      {!loading && !currentSettlement && (
        <div className="no-settlement">
          <p className="no-settlement-text">
            No open settlement. Trigger one to calculate last month's balances.
          </p>
          {isAdmin && (
            <button className="trigger-btn" disabled={triggering} onClick={handleTrigger}>
              {triggering ? 'Calculating…' : 'Trigger settlement'}
            </button>
          )}
          {!isAdmin && (
            <p className="no-settlement-hint">Ask your household admin to trigger the settlement.</p>
          )}
        </div>
      )}

      {currentSettlement && (
        <>
          <div className="settlement-period">
            {monthLabel(currentSettlement.periodYear, currentSettlement.periodMonth)}
            {currentSettlement.status === 'completed' && (
              <span className="completed-badge">Completed</span>
            )}
          </div>

          {/* Balance overview */}
          <section className="settlement-section">
            <h2 className="section-title">Balances</h2>
            <div className="balances-list">
              {currentSettlement.balances.map((b) => (
                <div key={b.userId} className="balance-row">
                  <div className="balance-avatar">{b.name.charAt(0).toUpperCase()}</div>
                  <span className="balance-name">{b.name}{b.userId === userId ? ' (you)' : ''}</span>
                  <span className={`balance-amount ${b.amountOre > 0 ? 'balance-amount--credit' : b.amountOre < 0 ? 'balance-amount--debit' : ''}`}>
                    {b.amountOre >= 0 ? '+' : ''}{formatNok(b.amountOre)}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* Transactions */}
          <section className="settlement-section">
            <h2 className="section-title">Transactions</h2>
            {currentSettlement.transactions.length === 0 ? (
              <p className="no-tx">All even — no transfers needed.</p>
            ) : (
              <div className="tx-list">
                {currentSettlement.transactions.map((tx) => (
                  <TransactionRow
                    key={tx.id}
                    tx={tx}
                    settlementId={currentSettlement.id}
                    currentUserId={userId}
                    canMark={currentSettlement.status === 'open'}
                  />
                ))}
              </div>
            )}
          </section>

          {allPaid && currentSettlement.status === 'open' && (
            <div className="all-paid-banner">
              All transactions paid — settlement will close automatically.
            </div>
          )}
          {currentSettlement.status === 'completed' && (
            <div className="completed-banner">
              ✓ This settlement is complete.
            </div>
          )}
        </>
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Geist:wght@300;400;500;600&display=swap');

        .settlement-page {
          max-width: 720px;
          margin: 0 auto;
          padding: 1.5rem 1rem 2rem;
          font-family: 'Geist', sans-serif;
          color: #f4f4f5;
        }
        .settlement-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 1.5rem;
        }
        .settlement-title {
          font-size: 1.375rem;
          font-weight: 600;
          margin: 0;
          letter-spacing: -0.025em;
        }
        .history-link {
          background: none;
          border: none;
          color: #818cf8;
          font-size: 0.875rem;
          cursor: pointer;
          padding: 0;
          font-family: inherit;
        }
        .settlement-loading, .settlement-error {
          color: #71717a; font-size: 0.9rem; text-align: center; padding: 2rem 0; margin: 0;
        }
        .settlement-error { color: #f87171; }
        .no-settlement {
          background: #18181b;
          border: 1px solid #27272a;
          border-radius: 14px;
          padding: 2rem 1.5rem;
          text-align: center;
        }
        .no-settlement-text { color: #71717a; font-size: 0.9rem; margin: 0 0 1.25rem; line-height: 1.5; }
        .no-settlement-hint { color: #52525b; font-size: 0.8rem; margin: 0.75rem 0 0; }
        .trigger-btn {
          background: #6366f1;
          border: none;
          border-radius: 10px;
          color: #fff;
          font-size: 0.9rem;
          font-weight: 500;
          padding: 0.65rem 1.5rem;
          cursor: pointer;
          font-family: inherit;
          transition: background 0.15s, opacity 0.15s;
        }
        .trigger-btn:hover { background: #4f46e5; }
        .trigger-btn:disabled { opacity: 0.45; cursor: not-allowed; }
        .settlement-period {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          font-size: 0.95rem;
          font-weight: 500;
          color: #a1a1aa;
          margin-bottom: 1.5rem;
          text-transform: capitalize;
        }
        .completed-badge {
          font-size: 0.7rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 0.2rem 0.5rem;
          background: #27272a;
          border: 1px solid #3f3f46;
          color: #71717a;
          border-radius: 6px;
        }
        .settlement-section { margin-bottom: 1.5rem; }
        .section-title {
          font-size: 0.75rem;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: #71717a;
          margin: 0 0 0.625rem 0.25rem;
        }
        .balances-list {
          background: #18181b;
          border: 1px solid #27272a;
          border-radius: 12px;
          overflow: hidden;
        }
        .balance-row {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.875rem 1rem;
          border-bottom: 1px solid #1f1f22;
        }
        .balance-row:last-child { border-bottom: none; }
        .balance-avatar {
          width: 30px; height: 30px;
          background: #27272a;
          border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 0.8rem; font-weight: 600; color: #a1a1aa;
          flex-shrink: 0;
        }
        .balance-name { flex: 1; font-size: 0.875rem; color: #e4e4e7; }
        .balance-amount {
          font-family: 'DM Mono', monospace;
          font-size: 0.875rem;
          font-weight: 500;
          color: #a1a1aa;
        }
        .balance-amount--credit { color: #4ade80; }
        .balance-amount--debit { color: #f87171; }
        .tx-list {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .tx-row {
          background: #18181b;
          border: 1px solid #27272a;
          border-radius: 12px;
          padding: 0.875rem 1rem;
          display: flex;
          flex-direction: column;
          gap: 0.625rem;
          transition: opacity 0.2s;
        }
        .tx-row--paid { opacity: 0.5; }
        .tx-info {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.5rem;
        }
        .tx-label { font-size: 0.875rem; color: #a1a1aa; }
        .tx-you { color: #f4f4f5; }
        .tx-amount {
          font-family: 'DM Mono', monospace;
          font-size: 0.9rem;
          color: #f4f4f5;
          font-weight: 500;
        }
        .tx-mark-btn {
          width: 100%;
          background: rgba(99,102,241,0.1);
          border: 1px solid rgba(99,102,241,0.25);
          border-radius: 8px;
          color: #818cf8;
          font-size: 0.85rem;
          font-weight: 500;
          padding: 0.45rem;
          cursor: pointer;
          font-family: inherit;
          transition: background 0.15s;
        }
        .tx-mark-btn:hover { background: rgba(99,102,241,0.18); }
        .tx-mark-btn:disabled { opacity: 0.45; cursor: not-allowed; }
        .tx-paid-badge {
          font-size: 0.78rem;
          color: #4ade80;
          font-weight: 500;
        }
        .no-tx { color: #52525b; font-size: 0.875rem; margin: 0; text-align: center; padding: 1.5rem; }
        .all-paid-banner, .completed-banner {
          background: rgba(34,197,94,0.08);
          border: 1px solid rgba(34,197,94,0.2);
          border-radius: 10px;
          color: #4ade80;
          font-size: 0.875rem;
          font-weight: 500;
          padding: 0.75rem 1rem;
          text-align: center;
        }
        .completed-banner {
          background: #18181b;
          border-color: #27272a;
          color: #71717a;
        }
      `}</style>
    </div>
  )
}
