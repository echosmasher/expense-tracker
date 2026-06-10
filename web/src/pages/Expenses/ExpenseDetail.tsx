import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { expenses, categories } from '@expense-tracker/shared'
import type { Expense, CategoryInfo } from '@expense-tracker/shared'
import { useHouseholdStore } from '../../stores/householdStore'
import { useExpenseStore } from '../../stores/expenseStore'

function formatNok(ore: number) {
  return `kr ${(ore / 100).toFixed(2).replace('.', ',')}`
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' })
}

function EditablePrice({
  lineItemId,
  expenseId,
  householdId,
  unitPriceOre,
  quantity,
  onUpdated,
}: {
  lineItemId: string
  expenseId: string
  householdId: string
  unitPriceOre: number
  quantity: number
  onUpdated: (lineItemId: string, unitPriceOre: number, newTotalAmountOre: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)

  function startEdit() {
    setValue((unitPriceOre / 100).toFixed(2).replace('.', ','))
    setEditing(true)
  }

  async function save() {
    const parsed = Math.round(parseFloat(value.replace(',', '.')) * 100)
    if (isNaN(parsed) || parsed < 0) { setEditing(false); return }
    if (parsed === unitPriceOre) { setEditing(false); return }
    setSaving(true)
    try {
      const result = await expenses.updateLineItem(householdId, expenseId, lineItemId, { unitPriceOre: parsed })
      onUpdated(lineItemId, result.unitPriceOre, result.newTotalAmountOre)
      setEditing(false)
    } catch { /* ignore */ }
    finally { setSaving(false) }
  }

  if (editing) {
    return (
      <span className="editable-price-row">
        <span className="editable-price-prefix">kr</span>
        <input
          className="editable-price-input"
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
          onBlur={save}
          autoFocus
          disabled={saving}
        />
        {quantity > 1 && <span className="editable-price-qty">× {quantity}</span>}
      </span>
    )
  }

  return (
    <button type="button" className="line-item-price line-item-price--editable" onClick={startEdit}>
      {formatNok(unitPriceOre * quantity)}
    </button>
  )
}

function DetailCategoryBadge({
  lineItemId,
  expenseId,
  categoryName,
  householdId,
  onUpdated,
}: {
  lineItemId: string
  expenseId: string
  categoryName: string | null
  householdId: string
  onUpdated: (lineItemId: string, categoryId: string, categoryName: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [cats, setCats] = useState<CategoryInfo[]>([])
  const [newCat, setNewCat] = useState('')
  const [showNew, setShowNew] = useState(false)

  const display = categoryName ?? 'Uncategorized'
  const isUncat = display === 'Uncategorized'

  useEffect(() => {
    if (open) {
      categories.list(householdId).then((res) => setCats(res.categories)).catch(() => {})
    }
  }, [open, householdId])

  async function handleSelect(name: string) {
    setOpen(false)
    setShowNew(false)
    setNewCat('')
    try {
      const result = await categories.updateLineItemCategory(householdId, expenseId, lineItemId, name)
      onUpdated(lineItemId, result.categoryId, result.categoryName)
    } catch { /* ignore */ }
  }

  function handleCreateNew() {
    const trimmed = newCat.trim()
    if (trimmed) handleSelect(trimmed)
  }

  return (
    <span className="dcat-wrapper" style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        className={`dcat-badge ${isUncat ? 'dcat-badge--uncat' : ''}`}
        onClick={() => setOpen(!open)}
      >
        {display}
      </button>
      {open && (
        <div className="dcat-dropdown">
          {cats
            .filter((c) => c.name !== display)
            .map((c) => (
              <button key={c.id} type="button" className="dcat-option" onClick={() => handleSelect(c.name)}>
                {c.name}
              </button>
            ))}
          {!showNew ? (
            <button type="button" className="dcat-option dcat-option--new" onClick={() => setShowNew(true)}>
              + New category…
            </button>
          ) : (
            <span className="dcat-new-row">
              <input
                className="dcat-new-input"
                type="text"
                placeholder="Category name"
                value={newCat}
                onChange={(e) => setNewCat(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreateNew() }}
                autoFocus
              />
              <button type="button" className="dcat-new-btn" onClick={handleCreateNew}>Add</button>
            </span>
          )}
        </div>
      )}
    </span>
  )
}

export function ExpenseDetail() {
  const { expenseId } = useParams<{ expenseId: string }>()
  const navigate = useNavigate()
  const household = useHouseholdStore((s) => s.household)
  const addOrUpdateExpense = useExpenseStore((s) => s.addOrUpdateExpense)
  const storedExpenses = useExpenseStore((s) => s.expenses)

  const [expense, setExpense] = useState<Expense | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!household || !expenseId) return
    setLoading(true)
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
                    <span className="line-item-meta-row">
                      {item.quantity !== 1 && (
                        <span className="line-item-qty">× {item.quantity}</span>
                      )}
                      <DetailCategoryBadge
                        lineItemId={item.id}
                        expenseId={expense.id}
                        categoryName={item.categoryName}
                        householdId={expense.householdId}
                        onUpdated={(liId, catId, catName) => {
                          setExpense((prev) => {
                            if (!prev) return prev
                            return {
                              ...prev,
                              lineItems: prev.lineItems.map((li) =>
                                li.id === liId ? { ...li, categoryId: catId, categoryName: catName } : li
                              ),
                            }
                          })
                        }}
                      />
                    </span>
                  </div>
                  <div className="line-item-right">
                    <EditablePrice
                      lineItemId={item.id}
                      expenseId={expense.id}
                      householdId={expense.householdId}
                      unitPriceOre={item.unitPriceOre}
                      quantity={item.quantity}
                      onUpdated={(liId, newPrice, newTotal) => {
                        setExpense((prev) => {
                          if (!prev) return prev
                          return {
                            ...prev,
                            totalAmountOre: newTotal,
                            lineItems: prev.lineItems.map((li) =>
                              li.id === liId ? { ...li, unitPriceOre: newPrice } : li
                            ),
                          }
                        })
                      }}
                    />
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

        .detail-page {
          max-width: 720px;
          margin: 0 auto;
          padding: 1.25rem 1rem 2rem;
          font-family: 'Geist', sans-serif;
          color: #f4f4f5;
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
        .line-item-left { display: flex; flex-direction: column; gap: 3px; flex: 1; }
        .line-item-meta-row { display: flex; align-items: center; gap: 0.5rem; }
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

        .line-item-price--editable {
          background: none;
          border: none;
          border-bottom: 1px dashed #3f3f46;
          cursor: pointer;
          padding: 0 0 1px;
          transition: border-color 0.15s;
        }
        .line-item-price--editable:hover { border-color: #6366f1; }
        .editable-price-row {
          display: flex;
          align-items: center;
          gap: 0.25rem;
        }
        .editable-price-prefix {
          font-size: 0.75rem;
          color: #71717a;
        }
        .editable-price-input {
          width: 72px;
          background: #09090b;
          border: 1px solid #6366f1;
          border-radius: 6px;
          color: #f4f4f5;
          font-family: 'DM Mono', monospace;
          font-size: 0.85rem;
          padding: 0.15rem 0.35rem;
          outline: none;
          text-align: right;
        }
        .editable-price-qty {
          font-size: 0.72rem;
          color: #71717a;
        }
        .dcat-badge {
          display: inline-block;
          padding: 0.1rem 0.4rem;
          border-radius: 9999px;
          font-size: 0.68rem;
          font-weight: 500;
          font-family: inherit;
          border: 1px solid #3f3f46;
          background: #27272a;
          color: #a1a1aa;
          cursor: pointer;
          white-space: nowrap;
          transition: border-color 0.15s;
        }
        .dcat-badge:hover { border-color: #6366f1; }
        .dcat-badge--uncat {
          border-color: #92400e;
          background: rgba(146,64,14,0.15);
          color: #fbbf24;
        }
        .dcat-dropdown {
          position: absolute;
          top: calc(100% + 4px);
          left: 0;
          z-index: 50;
          min-width: 170px;
          max-height: 200px;
          overflow-y: auto;
          background: #18181b;
          border: 1px solid #3f3f46;
          border-radius: 10px;
          padding: 0.25rem;
          display: flex;
          flex-direction: column;
        }
        .dcat-option {
          background: none;
          border: none;
          color: #d4d4d8;
          font-size: 0.78rem;
          font-family: inherit;
          padding: 0.35rem 0.5rem;
          text-align: left;
          cursor: pointer;
          border-radius: 6px;
          transition: background 0.1s;
        }
        .dcat-option:hover { background: #27272a; }
        .dcat-option--new { color: #818cf8; }
        .dcat-new-row { display: flex; gap: 0.3rem; padding: 0.25rem 0.35rem; }
        .dcat-new-input {
          flex: 1;
          background: #09090b;
          border: 1px solid #3f3f46;
          border-radius: 6px;
          color: #f4f4f5;
          font-size: 0.78rem;
          font-family: inherit;
          padding: 0.2rem 0.35rem;
          outline: none;
        }
        .dcat-new-input:focus { border-color: #6366f1; }
        .dcat-new-btn {
          background: #6366f1;
          border: none;
          border-radius: 6px;
          color: #fff;
          font-size: 0.72rem;
          font-family: inherit;
          padding: 0.2rem 0.4rem;
          cursor: pointer;
        }
      `}</style>
    </div>
  )
}
