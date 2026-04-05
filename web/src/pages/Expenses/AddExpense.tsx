import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { receipts, expenses } from '@expense-tracker/shared'
import type { ParsedReceipt } from '@expense-tracker/shared'
import { useAuthStore } from '../../stores/authStore'
import { useHouseholdStore } from '../../stores/householdStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { Button } from '../../components/Button'
import { FormField, Input } from '../../components/FormField'

// ─── Format helpers ────────────────────────────────────────────────────────────

function formatNok(ore: number) {
  return `kr ${(ore / 100).toFixed(2).replace('.', ',')}`
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface EditableItem {
  description: string
  quantity: number
  unitPriceOre: number
  isPersonal: boolean
  confidenceLow: boolean
}

// ─── Step 1: Upload ────────────────────────────────────────────────────────────

function UploadStep({ onParsed }: { onParsed: (result: ParsedReceipt, items: EditableItem[]) => void }) {
  const household = useHouseholdStore((s) => s.household)
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function processFile(file: File) {
    if (!household) { setError('No household found.'); return }
    if (!file.type.startsWith('image/')) { setError('Please select an image file.'); return }
    if (file.size > 10 * 1024 * 1024) { setError('File is too large (max 10 MB).'); return }

    setLoading(true)
    setError(null)
    try {
      const parsed = await receipts.parse(household.id, file)
      const items: EditableItem[] = parsed.items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitPriceOre: item.unitPriceOre,
        isPersonal: false,
        confidenceLow: item.confidenceLow,
      }))
      onParsed(parsed, items)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to parse receipt. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }

  return (
    <div className="add-expense-page">
      <h1 className="page-title">Add expense</h1>

      <div
        className={`upload-zone ${dragging ? 'upload-zone--active' : ''} ${loading ? 'upload-zone--loading' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => !loading && fileRef.current?.click()}
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f) }}
        />
        {loading ? (
          <>
            <div className="upload-spinner" />
            <p className="upload-hint">Parsing receipt…</p>
          </>
        ) : (
          <>
            <div className="upload-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
            </div>
            <p className="upload-primary">Drop receipt here or tap to choose</p>
            <p className="upload-hint">JPEG, PNG or WebP · max 10 MB</p>
          </>
        )}
      </div>

      {error && <p className="upload-error">{error}</p>}

      <style>{`
        .add-expense-page {
          max-width: 720px;
          margin: 0 auto;
          padding: 1.5rem 1rem 2rem;
          font-family: 'Geist', sans-serif;
          color: #f4f4f5;
        }
        .page-title {
          font-size: 1.25rem;
          font-weight: 600;
          margin: 0 0 1.5rem;
          letter-spacing: -0.02em;
        }
        .upload-zone {
          border: 1.5px dashed #3f3f46;
          border-radius: 16px;
          background: #18181b;
          padding: 3rem 1.5rem;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.75rem;
          cursor: pointer;
          transition: border-color 0.15s, background 0.15s;
        }
        .upload-zone:hover, .upload-zone--active {
          border-color: #6366f1;
          background: rgba(99,102,241,0.05);
        }
        .upload-zone--loading { cursor: default; }
        .upload-icon { color: #52525b; }
        .upload-primary { color: #a1a1aa; font-size: 0.9rem; margin: 0; }
        .upload-hint { color: #52525b; font-size: 0.8rem; margin: 0; }
        .upload-error { color: #f87171; font-size: 0.85rem; margin-top: 0.75rem; }
        .upload-spinner {
          width: 28px; height: 28px;
          border: 2px solid #3f3f46;
          border-top-color: #6366f1;
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}

// ─── Step 2: Review ────────────────────────────────────────────────────────────

function ReviewStep({
  parsed,
  items,
  onItemsChange,
  onBack,
}: {
  parsed: ParsedReceipt
  items: EditableItem[]
  onItemsChange: (items: EditableItem[]) => void
  onBack: () => void
}) {
  const navigate = useNavigate()
  const userId = useAuthStore((s) => s.userId)!
  const household = useHouseholdStore((s) => s.household)!
  const addOrUpdateExpense = useExpenseStore((s) => s.addOrUpdateExpense)

  const [store, setStore] = useState(parsed.store ?? '')
  const [date, setDate] = useState(parsed.date ?? new Date().toISOString().slice(0, 10))
  const [purchasedBy, setPurchasedBy] = useState(userId)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const total = items.reduce((sum, item) => sum + item.unitPriceOre * item.quantity, 0)

  function updateItem(index: number, patch: Partial<EditableItem>) {
    const updated = items.map((item, i) => (i === index ? { ...item, ...patch } : item))
    onItemsChange(updated)
  }

  function removeItem(index: number) {
    onItemsChange(items.filter((_, i) => i !== index))
  }

  function addItem() {
    onItemsChange([...items, { description: '', quantity: 1, unitPriceOre: 0, isPersonal: false, confidenceLow: false }])
  }

  async function handleConfirm() {
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
      const expense = await expenses.create(household.id, {
        receiptImageKey: parsed.receiptImageKey,
        store: store.trim() || undefined,
        date: date || undefined,
        purchasedBy,
        cardLastFour: parsed.detectedCardLastFour ?? undefined,
        lineItems: items.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unitPriceOre: item.unitPriceOre,
          isPersonal: item.isPersonal,
        })),
      })

      // Auto-confirm after review (user has already reviewed the items)
      const confirmed = await expenses.confirm(household.id, expense.id)
      addOrUpdateExpense(confirmed)
      navigate(`/expenses/${confirmed.id}`)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to save expense.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="add-expense-page">
      <div className="review-header">
        <button className="back-btn" onClick={onBack}>← Back</button>
        <h1 className="page-title" style={{ margin: 0 }}>Review items</h1>
      </div>

      {/* Receipt meta */}
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

      {parsed.receiptImageUrl && (
        <a href={parsed.receiptImageUrl} target="_blank" rel="noopener noreferrer" className="receipt-preview-link">
          <img src={parsed.receiptImageUrl} alt="Receipt" className="receipt-preview" />
        </a>
      )}

      {/* Line items */}
      <div className="items-header">
        <span className="items-label">Line items</span>
        <span className="items-total">{formatNok(total)}</span>
      </div>

      <div className="items-list">
        {items.map((item, i) => (
          <div key={i} className={`item-row ${item.confidenceLow ? 'item-row--low-conf' : ''}`}>
            <div className="item-main">
              <input
                className="item-desc"
                type="text"
                placeholder="Description"
                value={item.description}
                onChange={(e) => updateItem(i, { description: e.target.value })}
              />
              <div className="item-numbers">
                <input
                  className="item-qty"
                  type="number"
                  min="1"
                  value={item.quantity}
                  onChange={(e) => updateItem(i, { quantity: parseFloat(e.target.value) || 1 })}
                  title="Quantity"
                />
                <span className="item-sep">×</span>
                <input
                  className="item-price"
                  type="number"
                  min="0"
                  value={item.unitPriceOre}
                  onChange={(e) => updateItem(i, { unitPriceOre: Math.round(parseFloat(e.target.value) || 0) })}
                  title="Unit price (øre)"
                />
                <span className="item-ore-label">øre</span>
              </div>
            </div>
            <div className="item-actions">
              <label className="item-personal-label">
                <input
                  type="checkbox"
                  checked={item.isPersonal}
                  onChange={(e) => updateItem(i, { isPersonal: e.target.checked })}
                  className="item-personal-cb"
                />
                Personal
              </label>
              {item.confidenceLow && <span className="conf-warn" title="Low confidence">⚠</span>}
              <button className="item-remove" onClick={() => removeItem(i)} title="Remove">×</button>
            </div>
          </div>
        ))}
      </div>

      <button className="add-item-btn" onClick={addItem}>+ Add item</button>

      {error && <p style={{ color: '#f87171', fontSize: '0.85rem', margin: '0.75rem 0 0' }}>{error}</p>}

      <div style={{ marginTop: '1.5rem' }}>
        <Button loading={saving} onClick={handleConfirm}>
          Confirm expense · {formatNok(total)}
        </Button>
      </div>

      <style>{`
        .add-expense-page {
          max-width: 720px;
          margin: 0 auto;
          padding: 1.5rem 1rem 2rem;
          font-family: 'Geist', sans-serif;
          color: #f4f4f5;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .review-header {
          display: flex;
          align-items: center;
          gap: 1rem;
          margin-bottom: 0.5rem;
        }
        .back-btn {
          background: none;
          border: none;
          color: #818cf8;
          font-size: 0.9rem;
          cursor: pointer;
          padding: 0;
          font-family: inherit;
          white-space: nowrap;
        }
        .page-title {
          font-size: 1.25rem;
          font-weight: 600;
          margin: 0 0 1.5rem;
          letter-spacing: -0.02em;
        }
        .meta-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.75rem;
        }
        .receipt-preview-link { display: block; }
        .receipt-preview {
          width: 100%;
          border-radius: 12px;
          border: 1px solid #27272a;
          max-height: 200px;
          object-fit: cover;
        }
        .items-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 0.25rem;
        }
        .items-label {
          font-size: 0.75rem;
          font-weight: 500;
          color: #a1a1aa;
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .items-total {
          font-family: 'DM Mono', monospace;
          font-size: 0.9rem;
          color: #f4f4f5;
          font-weight: 500;
        }
        .items-list {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .item-row {
          background: #18181b;
          border: 1px solid #27272a;
          border-radius: 12px;
          padding: 0.75rem 0.875rem;
        }
        .item-row--low-conf { border-color: #92400e; }
        .item-main {
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
        }
        .item-desc {
          background: none;
          border: none;
          color: #f4f4f5;
          font-size: 0.9rem;
          font-family: inherit;
          outline: none;
          width: 100%;
          padding: 0;
        }
        .item-desc::placeholder { color: #52525b; }
        .item-numbers {
          display: flex;
          align-items: center;
          gap: 0.4rem;
        }
        .item-qty {
          width: 48px;
          background: #09090b;
          border: 1px solid #3f3f46;
          border-radius: 6px;
          color: #a1a1aa;
          font-size: 0.85rem;
          font-family: 'DM Mono', monospace;
          padding: 0.25rem 0.4rem;
          outline: none;
          text-align: center;
        }
        .item-sep { color: #52525b; font-size: 0.85rem; }
        .item-price {
          width: 80px;
          background: #09090b;
          border: 1px solid #3f3f46;
          border-radius: 6px;
          color: #a1a1aa;
          font-size: 0.85rem;
          font-family: 'DM Mono', monospace;
          padding: 0.25rem 0.4rem;
          outline: none;
          text-align: right;
        }
        .item-ore-label { color: #52525b; font-size: 0.75rem; }
        .item-actions {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin-top: 0.5rem;
        }
        .item-personal-label {
          display: flex;
          align-items: center;
          gap: 0.35rem;
          font-size: 0.8rem;
          color: #71717a;
          cursor: pointer;
        }
        .item-personal-cb { accent-color: #6366f1; cursor: pointer; }
        .conf-warn { color: #f59e0b; font-size: 0.85rem; }
        .item-remove {
          margin-left: auto;
          background: none;
          border: none;
          color: #52525b;
          font-size: 1.1rem;
          cursor: pointer;
          padding: 0 0.25rem;
          transition: color 0.15s;
          font-family: inherit;
        }
        .item-remove:hover { color: #f87171; }
        .add-item-btn {
          background: none;
          border: 1px dashed #3f3f46;
          border-radius: 10px;
          color: #6366f1;
          font-size: 0.875rem;
          font-family: inherit;
          padding: 0.6rem;
          cursor: pointer;
          width: 100%;
          transition: background 0.15s, border-color 0.15s;
        }
        .add-item-btn:hover { background: rgba(99,102,241,0.06); border-color: #6366f1; }
      `}</style>
    </div>
  )
}

// ─── Main: two-step flow ───────────────────────────────────────────────────────

export function AddExpense() {
  const [parsed, setParsed] = useState<ParsedReceipt | null>(null)
  const [items, setItems] = useState<EditableItem[]>([])

  if (!parsed) {
    return (
      <UploadStep
        onParsed={(result, editableItems) => {
          setParsed(result)
          setItems(editableItems)
        }}
      />
    )
  }

  return (
    <ReviewStep
      parsed={parsed}
      items={items}
      onItemsChange={setItems}
      onBack={() => setParsed(null)}
    />
  )
}
