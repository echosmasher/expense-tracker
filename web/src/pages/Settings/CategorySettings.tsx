import { useState, useEffect } from 'react'
import { categories } from '@expense-tracker/shared'
import type { CategoryInfo } from '@expense-tracker/shared'
import { useHouseholdStore } from '../../stores/householdStore'

export function CategorySettings() {
  const household = useHouseholdStore((s) => s.household)
  const isAdmin = household?.members.some(
    (m) => m.role === 'admin' && m.userId === household?.members[0]?.userId
  )

  const [cats, setCats] = useState<CategoryInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  async function loadCategories() {
    if (!household) return
    try {
      const res = await categories.list(household.id)
      setCats(res.categories)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load categories.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadCategories() }, [household?.id])

  async function handleRename(categoryId: string) {
    if (!household || !editName.trim()) return
    try {
      await categories.rename(household.id, categoryId, editName.trim())
      setEditingId(null)
      setEditName('')
      await loadCategories()
    } catch (err: any) {
      setError(err?.message ?? 'Failed to rename category.')
    }
  }

  async function handleDelete(categoryId: string) {
    if (!household) return
    try {
      await categories.remove(household.id, categoryId)
      setDeleteConfirm(null)
      await loadCategories()
    } catch (err: any) {
      setError(err?.message ?? 'Failed to delete category.')
    }
  }

  return (
    <div className="cat-settings-page">
      <h1 className="cs-title">Categories</h1>
      <p className="cs-desc">
        Product categories are learned from receipts. When you correct a category, the mapping is saved for future auto-categorization.
      </p>

      {loading && <p className="cs-msg">Loading…</p>}
      {error && <p className="cs-msg cs-msg--error">{error}</p>}

      {!loading && (
        <div className="cs-list">
          {cats.map((cat) => (
            <div key={cat.id} className="cs-row">
              {editingId === cat.id ? (
                <div className="cs-edit-row">
                  <input
                    className="cs-edit-input"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleRename(cat.id) }}
                    autoFocus
                  />
                  <button className="cs-btn cs-btn--save" onClick={() => handleRename(cat.id)}>Save</button>
                  <button className="cs-btn cs-btn--cancel" onClick={() => setEditingId(null)}>Cancel</button>
                </div>
              ) : deleteConfirm === cat.id ? (
                <div className="cs-edit-row">
                  <span className="cs-delete-msg">Delete "{cat.name}"? Items will become Uncategorized.</span>
                  <button className="cs-btn cs-btn--danger" onClick={() => handleDelete(cat.id)}>Delete</button>
                  <button className="cs-btn cs-btn--cancel" onClick={() => setDeleteConfirm(null)}>Cancel</button>
                </div>
              ) : (
                <>
                  <div className="cs-row-left">
                    <span className="cs-name">{cat.name}</span>
                    {cat.isSystem && <span className="cs-system-badge">system</span>}
                    <span className="cs-count">{cat.mappingCount} mapped</span>
                  </div>
                  {!cat.isSystem && (
                    <div className="cs-row-actions">
                      <button
                        className="cs-btn"
                        onClick={() => { setEditingId(cat.id); setEditName(cat.name) }}
                      >
                        Rename
                      </button>
                      <button
                        className="cs-btn cs-btn--danger-text"
                        onClick={() => setDeleteConfirm(cat.id)}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}

          {cats.length === 0 && (
            <p className="cs-empty">No categories yet. Categories are created automatically when receipts are parsed.</p>
          )}
        </div>
      )}

      <style>{`
        .cat-settings-page {
          max-width: 720px;
          margin: 0 auto;
          padding: 1.5rem 1rem 2rem;
          font-family: 'Geist', sans-serif;
          color: var(--text-primary);
        }
        .cs-title { font-size: 1.25rem; font-weight: 600; margin: 0 0 0.5rem; letter-spacing: -0.02em; }
        .cs-desc { font-size: 0.85rem; color: var(--text-muted); margin: 0 0 1.25rem; line-height: 1.5; }
        .cs-msg { color: var(--text-muted); font-size: 0.9rem; text-align: center; padding: 1rem 0; margin: 0; }
        .cs-msg--error { color: var(--danger); }
        .cs-list {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 12px;
          overflow: hidden;
        }
        .cs-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.75rem 1rem;
          border-bottom: 1px solid var(--border-subtle);
          gap: 0.75rem;
        }
        .cs-row:last-child { border-bottom: none; }
        .cs-row-left { display: flex; align-items: center; gap: 0.5rem; flex: 1; }
        .cs-name { font-size: 0.9rem; color: var(--text-primary); }
        .cs-system-badge {
          font-size: 0.65rem;
          color: var(--text-muted);
          border: 1px solid var(--border-input);
          border-radius: 4px;
          padding: 0.05rem 0.3rem;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .cs-count { font-size: 0.78rem; color: var(--text-faint); margin-left: auto; }
        .cs-row-actions { display: flex; gap: 0.5rem; }
        .cs-btn {
          background: none;
          border: 1px solid var(--border-input);
          border-radius: 6px;
          color: var(--text-secondary);
          font-size: 0.78rem;
          font-family: inherit;
          padding: 0.25rem 0.5rem;
          cursor: pointer;
          transition: border-color 0.15s, color 0.15s;
        }
        .cs-btn:hover { border-color: var(--accent); color: var(--accent-light); }
        .cs-btn--save { border-color: var(--accent); color: var(--accent-light); }
        .cs-btn--cancel { border-color: transparent; color: var(--text-faint); }
        .cs-btn--danger { border-color: #dc2626; color: var(--danger); }
        .cs-btn--danger:hover { background: rgba(220,38,38,0.1); }
        .cs-btn--danger-text { border: none; color: var(--text-muted); }
        .cs-btn--danger-text:hover { color: var(--danger); }
        .cs-edit-row { display: flex; align-items: center; gap: 0.5rem; flex: 1; }
        .cs-edit-input {
          flex: 1;
          background: var(--bg-base);
          border: 1px solid var(--border-input);
          border-radius: 6px;
          color: var(--text-primary);
          font-size: 0.85rem;
          font-family: inherit;
          padding: 0.3rem 0.5rem;
          outline: none;
        }
        .cs-edit-input:focus { border-color: var(--accent); }
        .cs-delete-msg { font-size: 0.8rem; color: var(--warning); flex: 1; }
        .cs-empty { font-size: 0.85rem; color: var(--text-faint); text-align: center; padding: 1.5rem; margin: 0; }
      `}</style>
    </div>
  )
}
