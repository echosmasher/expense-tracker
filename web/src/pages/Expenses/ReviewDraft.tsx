import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { expenses, projects, CURRENCIES } from '@expense-tracker/shared'
import type { Expense } from '@expense-tracker/shared'
import { useHouseholdStore } from '../../stores/householdStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useAuthenticatedImage } from '../../hooks/useAuthenticatedImage'
import { Button } from '../../components/Button'
import { FormField, Input } from '../../components/FormField'
import { LineItemEditor, type EditableLineItem } from '../../components/LineItemEditor'

function formatNok(ore: number) {
  return `kr ${(ore / 100).toFixed(2).replace('.', ',')}`
}

function formatRate(rateScaled: string, currency: string) {
  // rateScaled is NOK per one unit of currency, ×10^6.
  const rate = Number(BigInt(rateScaled)) / 1_000_000
  return `1 ${currency} = ${rate.toFixed(4)} NOK`
}

const RATE_SOURCE_LABEL: Record<string, string> = {
  norges_bank: 'Norges Bank',
  cached: 'cached',
  manual: 'manual',
  corrected: 'corrected',
  derived: 'derived',
  pending: 'pending',
}

const CURRENCY_OPTIONS = ['NOK', ...Object.keys(CURRENCIES).filter((c) => c !== 'NOK').sort()]

function toEditable(expense: Expense): EditableLineItem[] {
  return expense.lineItems.map((li) => ({
    description: li.description,
    quantity: li.quantity,
    unitPriceOre: li.unitPriceOre,
    originalUnitPriceMinor: li.originalUnitPriceMinor,
    isPersonal: li.isPersonal,
    categoryId: li.categoryId,
    categoryName: li.categoryName ?? 'Uncategorized',
  }))
}

// Route /expenses/:expenseId/review and /projects/:projectId/expenses/:expenseId/review —
// loads a pending_review draft (created by from-receipt, spec 004 ticket 8, or
// by a scan, ticket 9) and edits it through the draft routes until confirmed.
export function ReviewDraft() {
  const { expenseId, projectId } = useParams<{ expenseId: string; projectId?: string }>()
  const navigate = useNavigate()
  const household = useHouseholdStore((s) => s.household)
  const addOrUpdateExpense = useExpenseStore((s) => s.addOrUpdateExpense)

  const [expense, setExpense] = useState<Expense | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [manualRateInput, setManualRateInput] = useState('')
  const [showManualRate, setShowManualRate] = useState(false)
  const receiptObjectUrl = useAuthenticatedImage(expense?.receiptImageUrl)

  const householdId = household?.id

  useEffect(() => {
    if (!expenseId) return
    if (projectId) {
      projects.getExpense(projectId, expenseId).then(setExpense).catch((err) => setError(err?.message ?? 'Failed to load draft.')).finally(() => setLoading(false))
    } else if (householdId) {
      expenses.get(householdId, expenseId).then(setExpense).catch((err) => setError(err?.message ?? 'Failed to load draft.')).finally(() => setLoading(false))
    }
  }, [expenseId, projectId, householdId])

  async function patchExpense(patch: { store?: string; date?: string; purchasedBy?: string; cardLastFour?: string; currency?: string; rateScaled?: number }) {
    if (!expense || !expenseId) return
    try {
      const updated = projectId
        ? await projects.updateExpense(projectId, expenseId, patch)
        : await expenses.update(householdId!, expenseId, patch)
      setExpense(updated)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to save changes.')
    }
  }

  async function handleCurrencyChange(newCurrency: string) {
    setShowManualRate(false)
    setManualRateInput('')
    await patchExpense({ currency: newCurrency })
  }

  async function handleManualRateSubmit() {
    if (!expense) return
    // 1 unit of the currency = manualRateInput NOK; rateScaled is ×10^6.
    const nok = parseFloat(manualRateInput.replace(',', '.'))
    if (!Number.isFinite(nok) || nok <= 0) {
      setError('Enter a valid rate, e.g. 11.6543')
      return
    }
    const rateScaled = Math.round(nok * 1_000_000)
    setError(null)
    await patchExpense({ currency: expense.currency, rateScaled })
    setShowManualRate(false)
    setManualRateInput('')
  }

  async function updateItem(index: number, patch: Partial<EditableLineItem>) {
    if (!expense || !expenseId) return
    const lineItemId = expense.lineItems[index]?.id
    if (!lineItemId) return
    // LineItemEditor patches one field per call; only forward what changed —
    // exactOptionalPropertyTypes rejects `{ field: undefined }`.
    const body = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
    try {
      if (projectId) {
        // Project draft line-item edits return the full updated expense.
        setExpense(await projects.updateLineItem(projectId, expenseId, lineItemId, body))
      } else {
        // The household line-item route is shared with the confirmed-expense
        // price editor and only returns the changed item, so re-fetch.
        await expenses.updateLineItem(householdId!, expenseId, lineItemId, body)
        setExpense(await expenses.get(householdId!, expenseId))
      }
    } catch (err: any) {
      setError(err?.message ?? 'Failed to update line item.')
    }
  }

  async function addItem() {
    if (!expense || !expenseId) return
    const body = expense.currency !== 'NOK'
      ? { description: '', quantity: 1, originalUnitPriceMinor: 0, isPersonal: false }
      : { description: '', quantity: 1, unitPriceOre: 0, isPersonal: false }
    try {
      const updated = projectId
        ? await projects.addLineItem(projectId, expenseId, body)
        : await expenses.addLineItem(householdId!, expenseId, body)
      setExpense(updated)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to add line item.')
    }
  }

  async function removeItem(index: number) {
    if (!expense || !expenseId) return
    const lineItemId = expense.lineItems[index]?.id
    if (!lineItemId) return
    try {
      const updated = projectId
        ? await projects.deleteLineItem(projectId, expenseId, lineItemId)
        : await expenses.deleteLineItem(householdId!, expenseId, lineItemId)
      setExpense(updated)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to remove line item.')
    }
  }

  async function handleConfirm() {
    if (!expenseId) return
    setConfirming(true)
    setError(null)
    try {
      const confirmed = projectId
        ? await projects.confirmExpense(projectId, expenseId)
        : await expenses.confirm(householdId!, expenseId)
      if (!projectId) addOrUpdateExpense(confirmed)
      navigate(projectId ? `/projects/${projectId}` : `/expenses/${confirmed.id}`)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to confirm expense.')
    } finally {
      setConfirming(false)
    }
  }

  if (loading) return <div className="review-draft-page"><p className="review-draft-msg">Loading…</p></div>
  if (!expense) return <div className="review-draft-page"><p className="review-draft-msg review-draft-msg--error">{error ?? 'Draft not found.'}</p></div>

  const total = expense.totalAmountOre
  const items = toEditable(expense)
  const members = projectId ? null : household?.members
  const isForeign = expense.currency !== 'NOK'
  const isPending = expense.rateSource === 'pending'
  const manualRateVisible = showManualRate || isPending
  const currencyOptions = CURRENCY_OPTIONS.includes(expense.currency) ? CURRENCY_OPTIONS : [expense.currency, ...CURRENCY_OPTIONS]

  return (
    <div className="review-draft-page">
      <h1 className="page-title">Review draft</h1>

      <div className="meta-row">
        <FormField label="Store">
          <Input type="text" placeholder="Store name" defaultValue={expense.store ?? ''} onBlur={(e) => patchExpense({ store: e.target.value })} />
        </FormField>
        <FormField label="Date">
          <Input type="date" defaultValue={expense.date ?? ''} onBlur={(e) => patchExpense({ date: e.target.value })} />
        </FormField>
      </div>

      <FormField label="Currency">
        <select
          className="field-input"
          value={expense.currency}
          onChange={(e) => handleCurrencyChange(e.target.value)}
        >
          {currencyOptions.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </FormField>

      {isForeign && (
        <div className="rate-info">
          {expense.originalTotalMinor !== null && (
            <span className="rate-info-original">{(expense.originalTotalMinor / 100).toFixed(2)} {expense.currency}</span>
          )}
          {isPending ? (
            <span className="rate-info-pending">rate pending — enter one to confirm</span>
          ) : expense.rateScaled ? (
            <span className="rate-info-rate">
              {formatRate(expense.rateScaled, expense.currency)}
              {expense.rateSource && <span className="rate-info-source"> · {RATE_SOURCE_LABEL[expense.rateSource] ?? expense.rateSource}</span>}
            </span>
          ) : null}
          {!manualRateVisible && (
            <button type="button" className="rate-manual-toggle" onClick={() => setShowManualRate(true)}>
              Enter rate manually
            </button>
          )}
          {manualRateVisible && (
            <div className="rate-manual-row">
              <Input
                type="text"
                placeholder={`1 ${expense.currency} = ? NOK`}
                value={manualRateInput}
                onChange={(e) => setManualRateInput(e.target.value)}
              />
              <Button onClick={handleManualRateSubmit}>Save rate</Button>
            </div>
          )}
        </div>
      )}

      {members && (
        <FormField label="Purchased by">
          <select
            className="field-input"
            defaultValue={expense.purchasedBy}
            onChange={(e) => patchExpense({ purchasedBy: e.target.value })}
          >
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>{m.name}</option>
            ))}
          </select>
        </FormField>
      )}

      {receiptObjectUrl && (
        <a href={receiptObjectUrl} target="_blank" rel="noopener noreferrer" className="receipt-preview-link">
          <img src={receiptObjectUrl} alt="Receipt" className="receipt-preview" />
        </a>
      )}

      <LineItemEditor
        items={items}
        householdId={householdId ?? ''}
        currency={expense.currency}
        totalOverride={isForeign ? expense.totalAmountOre : undefined}
        onUpdate={updateItem}
        onRemove={removeItem}
        onAdd={addItem}
      />

      {error && <p className="review-draft-error">{error}</p>}

      <div style={{ marginTop: '1.5rem' }}>
        <Button loading={confirming} disabled={isPending} onClick={handleConfirm}>
          {isPending ? 'Enter a rate to confirm' : `Confirm expense · ${formatNok(total)}`}
        </Button>
      </div>

      <style>{`
        .review-draft-page {
          max-width: 720px;
          margin: 0 auto;
          padding: 1.5rem 1rem 2rem;
          font-family: 'Geist', sans-serif;
          color: var(--text-primary);
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .page-title { font-size: 1.25rem; font-weight: 600; margin: 0 0 0.5rem; letter-spacing: -0.02em; }
        .meta-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
        .receipt-preview-link { display: block; }
        .receipt-preview { width: 100%; border-radius: 12px; border: 1px solid var(--border); max-height: 200px; object-fit: cover; }
        .review-draft-msg { text-align: center; color: var(--text-muted); padding: 2rem 0; }
        .review-draft-msg--error { color: var(--danger); }
        .review-draft-error { color: var(--danger); font-size: 0.85rem; margin: 0; }
        .rate-info {
          display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 0.75rem;
          background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px;
          padding: 0.6rem 0.875rem; font-size: 0.82rem;
        }
        .rate-info-original { font-family: 'DM Mono', monospace; color: var(--text-primary); }
        .rate-info-rate { color: var(--text-secondary); }
        .rate-info-source { color: var(--text-faint); }
        .rate-info-pending { color: var(--warning); }
        .rate-manual-toggle { background: none; border: none; color: var(--accent-light); font-size: 0.8rem; font-family: inherit; cursor: pointer; padding: 0; margin-left: auto; }
        .rate-manual-row { display: flex; gap: 0.5rem; align-items: center; width: 100%; }
        .rate-manual-row input { flex: 1; }
        .rate-manual-row button { width: auto; }
      `}</style>
    </div>
  )
}
