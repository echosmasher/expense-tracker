import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { expenses, projects } from '@expense-tracker/shared'
import { useAuthStore } from '../../stores/authStore'
import { useHouseholdStore } from '../../stores/householdStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { Button } from '../../components/Button'
import { FormField, Input } from '../../components/FormField'
import { LineItemEditor, type EditableLineItem } from '../../components/LineItemEditor'

function formatNok(ore: number) {
  return `kr ${(ore / 100).toFixed(2).replace('.', ',')}`
}

const EMPTY_ITEM: EditableLineItem = {
  description: '',
  quantity: 1,
  unitPriceOre: 0,
  isPersonal: false,
  categoryId: null,
  categoryName: 'Uncategorized',
}

// Manual, no-receipt path — a scan (spec 004 ticket 9) creates a draft via
// `expenses.createFromReceipt` / `projects.createExpenseFromReceipt` and lands
// on ReviewDraft instead of here.
export function AddExpense() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const projectId = searchParams.get('projectId')
  const userId = useAuthStore((s) => s.userId)!
  const household = useHouseholdStore((s) => s.household)!
  const addOrUpdateExpense = useExpenseStore((s) => s.addOrUpdateExpense)

  const [store, setStore] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [purchasedBy, setPurchasedBy] = useState(userId)
  const [items, setItems] = useState<EditableLineItem[]>([{ ...EMPTY_ITEM }])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const total = items.reduce((sum, item) => (item.isPersonal ? sum : sum + item.unitPriceOre * item.quantity), 0)

  function updateItem(index: number, patch: Partial<EditableLineItem>) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index))
  }

  function addItem() {
    setItems((prev) => [...prev, { ...EMPTY_ITEM }])
  }

  async function handleSave() {
    if (items.length === 0) { setError('Add at least one line item.'); return }
    for (const item of items) {
      if (!item.description.trim()) { setError('All items need a description.'); return }
      if (!Number.isInteger(item.unitPriceOre) || item.unitPriceOre < 0) {
        setError('All prices must be valid whole øre amounts.'); return
      }
    }

    setSaving(true)
    setError(null)
    try {
      const payload = {
        store: store.trim() || undefined,
        date: date || undefined,
        purchasedBy,
        lineItems: items.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unitPriceOre: item.unitPriceOre,
          isPersonal: item.isPersonal,
          categoryId: item.categoryId ?? undefined,
        })),
      }

      if (projectId) {
        // Project expenses are auto-confirmed on create — no review/confirm step.
        await projects.createExpense(projectId, payload)
        navigate(`/projects/${projectId}`)
      } else {
        const expense = await expenses.create(household.id, payload)
        const confirmed = await expenses.confirm(household.id, expense.id)
        addOrUpdateExpense(confirmed)
        navigate(`/expenses/${confirmed.id}`)
      }
    } catch (err: any) {
      setError(err?.message ?? 'Failed to save expense.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="add-expense-page">
      <h1 className="page-title">Add expense</h1>

      <div className="meta-row">
        <FormField label="Store">
          <Input type="text" placeholder="Store name" value={store} onChange={(e) => setStore(e.target.value)} />
        </FormField>
        <FormField label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </FormField>
      </div>

      <FormField label="Purchased by">
        <select
          className="field-input"
          value={purchasedBy}
          onChange={(e) => setPurchasedBy(e.target.value)}
        >
          {household.members.map((m) => (
            <option key={m.userId} value={m.userId}>{m.name}</option>
          ))}
        </select>
      </FormField>

      <LineItemEditor items={items} householdId={household.id} onUpdate={updateItem} onRemove={removeItem} onAdd={addItem} />

      {error && <p className="add-expense-error">{error}</p>}

      <div style={{ marginTop: '1.5rem' }}>
        <Button loading={saving} onClick={handleSave}>
          Save expense · {formatNok(total)}
        </Button>
      </div>

      <style>{`
        .add-expense-page {
          max-width: 720px;
          margin: 0 auto;
          padding: 1.5rem 1rem 2rem;
          font-family: 'Geist', sans-serif;
          color: var(--text-primary);
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .page-title {
          font-size: 1.25rem;
          font-weight: 600;
          margin: 0 0 0.5rem;
          letter-spacing: -0.02em;
        }
        .meta-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.75rem;
        }
        .add-expense-error { color: var(--danger); font-size: 0.85rem; margin: 0; }
      `}</style>
    </div>
  )
}
