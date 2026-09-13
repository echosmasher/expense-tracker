import { useState, useEffect } from 'react'
import { categories } from '@expense-tracker/shared'
import type { CategoryInfo } from '@expense-tracker/shared'

// Shared between the manual "Add expense" form and the draft review screen —
// the plan calls for one line-item editor reused by both, not two copies.

export interface EditableLineItem {
  description: string
  quantity: number
  unitPriceOre: number
  isPersonal: boolean
  categoryId: string | null
  categoryName: string
}

function CategoryBadge({
  categoryName,
  householdId,
  onSelect,
}: {
  categoryName: string
  householdId: string
  onSelect: (name: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [cats, setCats] = useState<CategoryInfo[]>([])
  const [newCat, setNewCat] = useState('')
  const [showNew, setShowNew] = useState(false)

  useEffect(() => {
    if (open) {
      categories.list(householdId).then((res) => setCats(res.categories)).catch(() => {})
    }
  }, [open, householdId])

  const isUncat = categoryName === 'Uncategorized'

  function handleSelect(name: string) {
    onSelect(name)
    setOpen(false)
    setShowNew(false)
    setNewCat('')
  }

  function handleCreateNew() {
    const trimmed = newCat.trim()
    if (trimmed) handleSelect(trimmed)
  }

  return (
    <div className="li-cat-wrapper">
      <button
        className={`li-cat-badge ${isUncat ? 'li-cat-badge--uncat' : ''}`}
        onClick={() => setOpen(!open)}
        type="button"
      >
        {categoryName}
      </button>
      {open && (
        <div className="li-cat-dropdown">
          {cats
            .filter((c) => c.name !== categoryName)
            .map((c) => (
              <button key={c.id} className="li-cat-option" onClick={() => handleSelect(c.name)} type="button">
                {c.name}
              </button>
            ))}
          {!showNew ? (
            <button className="li-cat-option li-cat-option--new" onClick={() => setShowNew(true)} type="button">
              + New category…
            </button>
          ) : (
            <div className="li-cat-new-row">
              <input
                className="li-cat-new-input"
                type="text"
                placeholder="Category name"
                value={newCat}
                onChange={(e) => setNewCat(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreateNew() }}
                autoFocus
              />
              <button className="li-cat-new-btn" onClick={handleCreateNew} type="button">Add</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function LineItemEditor({
  items,
  householdId,
  onUpdate,
  onRemove,
  onAdd,
}: {
  items: EditableLineItem[]
  householdId: string
  onUpdate: (index: number, patch: Partial<EditableLineItem>) => void
  onRemove: (index: number) => void
  onAdd: () => void
}) {
  const total = items.reduce((sum, item) => (item.isPersonal ? sum : sum + item.unitPriceOre * item.quantity), 0)

  return (
    <div className="line-item-editor">
      <div className="li-header">
        <span className="li-header-label">Line items</span>
        <span className="li-header-total">kr {(total / 100).toFixed(2).replace('.', ',')}</span>
      </div>

      <div className="li-list">
        {items.map((item, i) => (
          <div key={i} className="li-row">
            <div className="li-main">
              <input
                className="li-desc"
                type="text"
                placeholder="Description"
                value={item.description}
                onChange={(e) => onUpdate(i, { description: e.target.value })}
              />
              <div className="li-numbers">
                <input
                  className="li-qty"
                  type="number"
                  min="1"
                  value={item.quantity}
                  onChange={(e) => onUpdate(i, { quantity: parseInt(e.target.value, 10) || 1 })}
                  title="Quantity"
                />
                <span className="li-sep">×</span>
                <input
                  className="li-price"
                  type="number"
                  min="0"
                  value={item.unitPriceOre}
                  onChange={(e) => onUpdate(i, { unitPriceOre: Math.round(parseFloat(e.target.value) || 0) })}
                  title="Unit price (øre)"
                />
                <span className="li-ore-label">øre</span>
              </div>
            </div>
            <div className="li-actions">
              <CategoryBadge
                categoryName={item.categoryName || 'Uncategorized'}
                householdId={householdId}
                onSelect={(name) => onUpdate(i, { categoryName: name })}
              />
              <label className="li-personal-label">
                <input
                  type="checkbox"
                  checked={item.isPersonal}
                  onChange={(e) => onUpdate(i, { isPersonal: e.target.checked })}
                  className="li-personal-cb"
                />
                Personal
              </label>
              <button className="li-remove" onClick={() => onRemove(i)} title="Remove" type="button">×</button>
            </div>
          </div>
        ))}
      </div>

      <button className="li-add-btn" onClick={onAdd} type="button">+ Add item</button>

      <style>{`
        .line-item-editor { display: flex; flex-direction: column; gap: 0.5rem; }
        .li-header { display: flex; align-items: center; justify-content: space-between; padding: 0 0.25rem; }
        .li-header-label { font-size: 0.75rem; font-weight: 500; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.06em; }
        .li-header-total { font-family: 'DM Mono', monospace; font-size: 0.9rem; color: var(--text-primary); font-weight: 500; }
        .li-list { display: flex; flex-direction: column; gap: 0.5rem; }
        .li-row { background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; padding: 0.75rem 0.875rem; }
        .li-main { display: flex; flex-direction: column; gap: 0.4rem; }
        .li-desc { background: none; border: none; color: var(--text-primary); font-size: 0.9rem; font-family: inherit; outline: none; width: 100%; padding: 0; }
        .li-desc::placeholder { color: var(--text-faint); }
        .li-numbers { display: flex; align-items: center; gap: 0.4rem; }
        .li-qty { width: 48px; background: var(--bg-base); border: 1px solid var(--border-input); border-radius: 6px; color: var(--text-secondary); font-size: 0.85rem; font-family: 'DM Mono', monospace; padding: 0.25rem 0.4rem; outline: none; text-align: center; }
        .li-sep { color: var(--text-faint); font-size: 0.85rem; }
        .li-price { width: 80px; background: var(--bg-base); border: 1px solid var(--border-input); border-radius: 6px; color: var(--text-secondary); font-size: 0.85rem; font-family: 'DM Mono', monospace; padding: 0.25rem 0.4rem; outline: none; text-align: right; }
        .li-ore-label { color: var(--text-faint); font-size: 0.75rem; }
        .li-actions { display: flex; align-items: center; gap: 0.75rem; margin-top: 0.5rem; }
        .li-personal-label { display: flex; align-items: center; gap: 0.35rem; font-size: 0.8rem; color: var(--text-muted); cursor: pointer; }
        .li-personal-cb { accent-color: #6366f1; cursor: pointer; }
        .li-remove { margin-left: auto; background: none; border: none; color: var(--text-faint); font-size: 1.1rem; cursor: pointer; padding: 0 0.25rem; transition: color 0.15s; font-family: inherit; }
        .li-remove:hover { color: var(--danger); }
        .li-add-btn { background: none; border: 1px dashed var(--border-input); border-radius: 10px; color: var(--accent); font-size: 0.875rem; font-family: inherit; padding: 0.6rem; cursor: pointer; width: 100%; transition: background 0.15s, border-color 0.15s; }
        .li-add-btn:hover { background: rgba(99,102,241,0.06); border-color: var(--accent); }

        .li-cat-wrapper { position: relative; }
        .li-cat-badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 9999px; font-size: 0.7rem; font-weight: 500; font-family: inherit; border: 1px solid var(--border-input); background: var(--badge-bg); color: var(--text-secondary); cursor: pointer; white-space: nowrap; transition: border-color 0.15s; }
        .li-cat-badge:hover { border-color: var(--accent); }
        .li-cat-badge--uncat { border-color: #92400e; background: rgba(146,64,14,0.15); color: var(--warning); }
        .li-cat-dropdown { position: absolute; top: calc(100% + 4px); left: 0; z-index: 50; min-width: 180px; max-height: 220px; overflow-y: auto; background: var(--bg-card); border: 1px solid var(--border-input); border-radius: 10px; padding: 0.25rem; display: flex; flex-direction: column; }
        .li-cat-option { background: none; border: none; color: #d4d4d8; font-size: 0.8rem; font-family: inherit; padding: 0.4rem 0.6rem; text-align: left; cursor: pointer; border-radius: 6px; transition: background 0.1s; }
        .li-cat-option:hover { background: var(--badge-bg); }
        .li-cat-option--new { color: var(--accent-light); }
        .li-cat-new-row { display: flex; gap: 0.35rem; padding: 0.3rem 0.4rem; }
        .li-cat-new-input { flex: 1; background: var(--bg-base); border: 1px solid var(--border-input); border-radius: 6px; color: var(--text-primary); font-size: 0.8rem; font-family: inherit; padding: 0.25rem 0.4rem; outline: none; }
        .li-cat-new-input:focus { border-color: var(--accent); }
        .li-cat-new-btn { background: var(--accent); border: none; border-radius: 6px; color: #fff; font-size: 0.75rem; font-family: inherit; padding: 0.25rem 0.5rem; cursor: pointer; }
      `}</style>
    </div>
  )
}
