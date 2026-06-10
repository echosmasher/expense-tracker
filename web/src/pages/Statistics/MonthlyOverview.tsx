import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Legend
} from 'recharts'
import { statistics } from '@expense-tracker/shared'
import type { Statistics, CategoryDetail } from '@expense-tracker/shared'
import { useHouseholdStore } from '../../stores/householdStore'
import { useStatsStore } from '../../stores/statsStore'

// ─── Colour palette for charts ────────────────────────────────────────────────
const COLOURS = ['#6366f1', 'var(--accent-light)', '#a5b4fc', '#4ade80', '#34d399', '#f59e0b', '#fb923c', 'var(--danger)']

function formatNok(ore: number) {
  return `kr ${(ore / 100).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`
}

function MonthPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  // Navigate months with arrows
  function shift(delta: number) {
    const [y, m] = value.split('-').map(Number)
    const d = new Date(y!, m! - 1 + delta, 1)
    onChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  const label = new Date(value + '-01').toLocaleDateString('nb-NO', { month: 'long', year: 'numeric' })
  const isCurrentMonth = value === new Date().toISOString().slice(0, 7)

  return (
    <div className="month-picker">
      <button className="mp-btn" onClick={() => shift(-1)}>‹</button>
      <span className="mp-label">{label}</span>
      <button className="mp-btn" onClick={() => shift(1)} disabled={isCurrentMonth}>›</button>
    </div>
  )
}

// ─── Custom tooltip ────────────────────────────────────────────────────────────
function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip">
      <p className="ct-name">{payload[0].name}</p>
      <p className="ct-value">{formatNok(payload[0].value)}</p>
    </div>
  )
}

export function MonthlyOverview() {
  const navigate = useNavigate()
  const household = useHouseholdStore((s) => s.household)
  const { stats, setStats, includePersonal, setIncludePersonal } = useStatsStore()

  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [drillCategory, setDrillCategory] = useState<{ id: string | null; name: string } | null>(null)
  const [drillData, setDrillData] = useState<CategoryDetail | null>(null)
  const [drillLoading, setDrillLoading] = useState(false)

  useEffect(() => {
    if (!household) return
    setLoading(true)
    statistics.get(household.id, { month, includePersonal })
      .then((data) => {
        setStats(data)
        setLoading(false)
      })
      .catch((err) => {
        setError(err?.message ?? 'Failed to load statistics.')
        setLoading(false)
      })
  }, [household?.id, month, includePersonal])

  useEffect(() => {
    if (!drillCategory || !household) return
    setDrillLoading(true)
    setDrillData(null)
    const catParam = drillCategory.id ?? 'uncategorized'
    statistics.categoryDetail(household.id, catParam, { month, includePersonal })
      .then(setDrillData)
      .catch(() => setDrillData(null))
      .finally(() => setDrillLoading(false))
  }, [drillCategory, household?.id, month, includePersonal])

  const donutData = stats?.byTag.map((t) => ({ name: t.tagName, value: t.totalOre })) ?? []
  const memberData = stats?.byMember.map((m) => ({ name: m.name, value: m.totalOre })) ?? []
  const categoryData = stats?.byCategory?.map((c) => ({ name: c.categoryName, value: c.totalOre })) ?? []

  return (
    <div className="stats-page">
      <div className="stats-header">
        <h1 className="stats-title">Statistics</h1>
        <button className="trends-link" onClick={() => navigate('/statistics/trends')}>Trends →</button>
      </div>

      <MonthPicker value={month} onChange={setMonth} />

      <label className="personal-toggle">
        <input
          type="checkbox"
          checked={includePersonal}
          onChange={(e) => setIncludePersonal(e.target.checked)}
          className="personal-toggle-cb"
        />
        Include personal items
      </label>

      {loading && <p className="stats-msg">Loading…</p>}
      {error && <p className="stats-msg stats-msg--error">{error}</p>}

      {stats && !loading && (
        <>
          <div className="stats-total">
            <span className="stats-total-label">Total</span>
            <span className="stats-total-value">{formatNok(stats.totalOre)}</span>
          </div>

          {/* Donut: by tag */}
          {donutData.length > 0 && (
            <section className="stats-section">
              <h2 className="stats-section-title">By tag</h2>
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={donutData}
                      cx="50%" cy="50%"
                      innerRadius={55} outerRadius={90}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {donutData.map((_, idx) => (
                        <Cell key={idx} fill={COLOURS[idx % COLOURS.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                    <Legend
                      iconType="circle"
                      iconSize={8}
                      formatter={(value) => <span style={{ color: 'var(--text-secondary)', fontSize: '0.78rem' }}>{value}</span>}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          {/* Donut: by product category */}
          {categoryData.length > 0 && (
            <section className="stats-section">
              <h2 className="stats-section-title">By product category</h2>
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={categoryData}
                      cx="50%" cy="50%"
                      innerRadius={55} outerRadius={90}
                      paddingAngle={2}
                      dataKey="value"
                      style={{ cursor: 'pointer' }}
                      onClick={(_, idx) => {
                        const cat = stats!.byCategory[idx]
                        if (cat) setDrillCategory({ id: cat.categoryId, name: cat.categoryName })
                      }}
                    >
                      {categoryData.map((_, idx) => (
                        <Cell key={idx} fill={COLOURS[idx % COLOURS.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                    <Legend
                      iconType="circle"
                      iconSize={8}
                      formatter={(value) => <span style={{ color: 'var(--text-secondary)', fontSize: '0.78rem' }}>{value}</span>}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          {/* Bar: by member */}
          {memberData.length > 0 && (
            <section className="stats-section">
              <h2 className="stats-section-title">By member</h2>
              <div className="member-bars">
                {memberData.map((m, idx) => (
                  <div key={m.name} className="member-bar-row">
                    <span className="mb-name">{m.name}</span>
                    <div className="mb-track">
                      <div
                        className="mb-fill"
                        style={{
                          width: `${Math.max(4, (m.value / (stats.totalOre || 1)) * 100)}%`,
                          background: COLOURS[idx % COLOURS.length],
                        }}
                      />
                    </div>
                    <span className="mb-amount">{formatNok(m.value)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Top items */}
          {stats.topItems.length > 0 && (
            <section className="stats-section">
              <h2 className="stats-section-title">Top items</h2>
              <ul className="top-items-list">
                {stats.topItems.map((item, idx) => (
                  <li key={idx} className="top-item">
                    <span className="top-item-rank">{idx + 1}</span>
                    <span className="top-item-desc">{item.description}</span>
                    <div className="top-item-right">
                      <span className="top-item-amount">{formatNok(item.totalOre)}</span>
                      <span className="top-item-count">×{item.count}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* CSV export */}
          <a
            className="export-btn"
            href={`/api/v1/households/${household!.id}/statistics/export?month=${month}`}
            download={`expenses-${month}.csv`}
          >
            ↓ Export CSV
          </a>
        </>
      )}

      {drillCategory && (
        <div className="drill-backdrop" onClick={() => { setDrillCategory(null); setDrillData(null) }}>
          <div className="drill-modal" onClick={(e) => e.stopPropagation()}>
            <div className="drill-header">
              <h2 className="drill-title">{drillCategory.name}</h2>
              <button className="drill-close" onClick={() => { setDrillCategory(null); setDrillData(null) }}>×</button>
            </div>
            {drillLoading && <p className="drill-msg">Loading…</p>}
            {!drillLoading && drillData && drillData.items.length === 0 && (
              <p className="drill-msg">No items found.</p>
            )}
            {!drillLoading && drillData && drillData.items.length > 0 && (
              <ul className="drill-list">
                {(() => {
                  const groups: Record<string, typeof drillData.items> = {}
                  for (const item of drillData.items) {
                    if (!groups[item.expenseId]) groups[item.expenseId] = []
                    groups[item.expenseId]!.push(item)
                  }
                  return Object.entries(groups).map(([expenseId, items]) => (
                    <li key={expenseId} className="drill-group">
                      <button
                        className="drill-group-header"
                        onClick={() => navigate(`/expenses/${expenseId}`)}
                      >
                        <span>{items[0]!.store ?? 'Unknown store'}</span>
                        <span className="drill-group-date">
                          {items[0]!.expenseDate
                            ? new Date(items[0]!.expenseDate).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })
                            : '—'}
                        </span>
                      </button>
                      <ul className="drill-items">
                        {items.map((item) => (
                          <li key={item.lineItemId} className="drill-item">
                            <span className="drill-item-desc">{item.description}</span>
                            <span className="drill-item-price">
                              {item.quantity > 1 && `${item.quantity} × `}
                              {formatNok(item.unitPriceOre * item.quantity)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))
                })()}
              </ul>
            )}
          </div>
        </div>
      )}

      <style>{`
        .stats-page { max-width: 720px; margin: 0 auto; padding: 1.5rem 1rem 2rem; font-family: 'Geist', sans-serif; color: var(--text-primary); }
        .stats-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.25rem; }
        .stats-title { font-size: 1.375rem; font-weight: 600; margin: 0; letter-spacing: -0.025em; }
        .trends-link { background: none; border: none; color: var(--accent-light); font-size: 0.875rem; cursor: pointer; padding: 0; font-family: inherit; }
        .month-picker { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem; }
        .mp-btn { background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; color: var(--text-secondary); font-size: 1rem; width: 32px; height: 32px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-family: inherit; }
        .mp-btn:disabled { opacity: 0.35; cursor: not-allowed; }
        .mp-label { flex: 1; text-align: center; font-size: 0.9rem; font-weight: 500; color: var(--text-primary); text-transform: capitalize; }
        .personal-toggle { display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1.25rem; cursor: pointer; }
        .personal-toggle-cb { accent-color: #6366f1; }
        .stats-msg { color: var(--text-muted); font-size: 0.9rem; text-align: center; padding: 2rem 0; margin: 0; }
        .stats-msg--error { color: var(--danger); }
        .stats-total { display: flex; align-items: baseline; justify-content: space-between; background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; padding: 1rem 1.25rem; margin-bottom: 1.25rem; }
        .stats-total-label { font-size: 0.75rem; font-weight: 500; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
        .stats-total-value { font-family: 'DM Mono', monospace; font-size: 1.25rem; font-weight: 500; color: var(--text-primary); }
        .stats-section { margin-bottom: 1.5rem; }
        .stats-section-title { font-size: 0.75rem; font-weight: 500; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); margin: 0 0 0.75rem 0.25rem; }
        .chart-wrap { background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; padding: 0.5rem 0.25rem; }
        .chart-tooltip { background: var(--badge-bg); border: 1px solid var(--border-input); border-radius: 8px; padding: 0.5rem 0.75rem; }
        .ct-name { font-size: 0.78rem; color: var(--text-secondary); margin: 0; }
        .ct-value { font-family: 'DM Mono', monospace; font-size: 0.875rem; color: var(--text-primary); margin: 0; font-weight: 500; }
        .member-bars { display: flex; flex-direction: column; gap: 0.625rem; background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; padding: 1rem 1.125rem; }
        .member-bar-row { display: flex; align-items: center; gap: 0.75rem; }
        .mb-name { font-size: 0.85rem; color: var(--text-secondary); width: 72px; flex-shrink: 0; }
        .mb-track { flex: 1; height: 6px; background: var(--badge-bg); border-radius: 3px; overflow: hidden; }
        .mb-fill { height: 100%; border-radius: 3px; transition: width 0.4s ease; }
        .mb-amount { font-family: 'DM Mono', monospace; font-size: 0.8rem; color: var(--text-primary); flex-shrink: 0; }
        .top-items-list { list-style: none; margin: 0; padding: 0; background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
        .top-item { display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; border-bottom: 1px solid var(--border-subtle); }
        .top-item:last-child { border-bottom: none; }
        .top-item-rank { width: 20px; text-align: center; font-size: 0.78rem; color: var(--text-faint); flex-shrink: 0; }
        .top-item-desc { flex: 1; font-size: 0.875rem; color: var(--text-primary); }
        .top-item-right { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
        .top-item-amount { font-family: 'DM Mono', monospace; font-size: 0.875rem; color: var(--text-primary); }
        .top-item-count { font-size: 0.72rem; color: var(--text-muted); }
        .export-btn { display: flex; justify-content: center; align-items: center; background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px; color: var(--accent-light); font-size: 0.875rem; font-weight: 500; padding: 0.65rem; text-decoration: none; transition: background 0.15s; }
        .export-btn:hover { background: var(--bg-card-hover); }
        .drill-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 100; display: flex; align-items: flex-end; justify-content: center; }
        .drill-modal { background: var(--bg-card); border: 1px solid var(--border); border-radius: 16px 16px 0 0; width: 100%; max-width: 720px; max-height: 75vh; display: flex; flex-direction: column; overflow: hidden; }
        .drill-header { display: flex; align-items: center; justify-content: space-between; padding: 1rem 1.25rem; border-bottom: 1px solid var(--border); flex-shrink: 0; }
        .drill-title { font-size: 1rem; font-weight: 600; margin: 0; color: var(--text-primary); }
        .drill-close { background: none; border: none; color: var(--text-muted); font-size: 1.5rem; cursor: pointer; padding: 0; line-height: 1; font-family: inherit; }
        .drill-close:hover { color: var(--text-primary); }
        .drill-msg { color: var(--text-muted); font-size: 0.85rem; text-align: center; padding: 2rem 0; margin: 0; }
        .drill-list { list-style: none; margin: 0; padding: 0; overflow-y: auto; }
        .drill-group { border-bottom: 1px solid var(--border); }
        .drill-group:last-child { border-bottom: none; }
        .drill-group-header { display: flex; align-items: center; justify-content: space-between; width: 100%; background: var(--bg-card-hover); border: none; color: var(--text-secondary); font-size: 0.78rem; font-weight: 500; padding: 0.5rem 1.25rem; cursor: pointer; font-family: inherit; transition: background 0.1s; }
        .drill-group-header:hover { background: var(--badge-bg); color: var(--accent-light); }
        .drill-group-date { color: var(--text-faint); }
        .drill-items { list-style: none; margin: 0; padding: 0; }
        .drill-item { display: flex; align-items: center; justify-content: space-between; padding: 0.5rem 1.25rem 0.5rem 1.75rem; gap: 0.75rem; }
        .drill-item-desc { font-size: 0.85rem; color: #d4d4d8; flex: 1; }
        .drill-item-price { font-family: 'DM Mono', monospace; font-size: 0.8rem; color: var(--text-secondary); flex-shrink: 0; }
      `}</style>
    </div>
  )
}
