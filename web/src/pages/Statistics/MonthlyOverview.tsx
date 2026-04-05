import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Legend
} from 'recharts'
import { statistics } from '@expense-tracker/shared'
import type { Statistics } from '@expense-tracker/shared'
import { useHouseholdStore } from '../../stores/householdStore'
import { useStatsStore } from '../../stores/statsStore'

// ─── Colour palette for charts ────────────────────────────────────────────────
const COLOURS = ['#6366f1', '#818cf8', '#a5b4fc', '#4ade80', '#34d399', '#f59e0b', '#fb923c', '#f87171']

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

  const donutData = stats?.byTag.map((t) => ({ name: t.tagName, value: t.totalOre })) ?? []
  const memberData = stats?.byMember.map((m) => ({ name: m.name, value: m.totalOre })) ?? []

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
              <h2 className="stats-section-title">By category</h2>
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
                      formatter={(value) => <span style={{ color: '#a1a1aa', fontSize: '0.78rem' }}>{value}</span>}
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

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Geist:wght@300;400;500;600&display=swap');
        .stats-page { max-width: 720px; margin: 0 auto; padding: 1.5rem 1rem 2rem; font-family: 'Geist', sans-serif; color: #f4f4f5; }
        .stats-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.25rem; }
        .stats-title { font-size: 1.375rem; font-weight: 600; margin: 0; letter-spacing: -0.025em; }
        .trends-link { background: none; border: none; color: #818cf8; font-size: 0.875rem; cursor: pointer; padding: 0; font-family: inherit; }
        .month-picker { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem; }
        .mp-btn { background: #18181b; border: 1px solid #27272a; border-radius: 8px; color: #a1a1aa; font-size: 1rem; width: 32px; height: 32px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-family: inherit; }
        .mp-btn:disabled { opacity: 0.35; cursor: not-allowed; }
        .mp-label { flex: 1; text-align: center; font-size: 0.9rem; font-weight: 500; color: #f4f4f5; text-transform: capitalize; }
        .personal-toggle { display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; color: #71717a; margin-bottom: 1.25rem; cursor: pointer; }
        .personal-toggle-cb { accent-color: #6366f1; }
        .stats-msg { color: #71717a; font-size: 0.9rem; text-align: center; padding: 2rem 0; margin: 0; }
        .stats-msg--error { color: #f87171; }
        .stats-total { display: flex; align-items: baseline; justify-content: space-between; background: #18181b; border: 1px solid #27272a; border-radius: 12px; padding: 1rem 1.25rem; margin-bottom: 1.25rem; }
        .stats-total-label { font-size: 0.75rem; font-weight: 500; text-transform: uppercase; letter-spacing: 0.06em; color: #71717a; }
        .stats-total-value { font-family: 'DM Mono', monospace; font-size: 1.25rem; font-weight: 500; color: #f4f4f5; }
        .stats-section { margin-bottom: 1.5rem; }
        .stats-section-title { font-size: 0.75rem; font-weight: 500; text-transform: uppercase; letter-spacing: 0.06em; color: #71717a; margin: 0 0 0.75rem 0.25rem; }
        .chart-wrap { background: #18181b; border: 1px solid #27272a; border-radius: 12px; padding: 0.5rem 0.25rem; }
        .chart-tooltip { background: #27272a; border: 1px solid #3f3f46; border-radius: 8px; padding: 0.5rem 0.75rem; }
        .ct-name { font-size: 0.78rem; color: #a1a1aa; margin: 0; }
        .ct-value { font-family: 'DM Mono', monospace; font-size: 0.875rem; color: #f4f4f5; margin: 0; font-weight: 500; }
        .member-bars { display: flex; flex-direction: column; gap: 0.625rem; background: #18181b; border: 1px solid #27272a; border-radius: 12px; padding: 1rem 1.125rem; }
        .member-bar-row { display: flex; align-items: center; gap: 0.75rem; }
        .mb-name { font-size: 0.85rem; color: #a1a1aa; width: 72px; flex-shrink: 0; }
        .mb-track { flex: 1; height: 6px; background: #27272a; border-radius: 3px; overflow: hidden; }
        .mb-fill { height: 100%; border-radius: 3px; transition: width 0.4s ease; }
        .mb-amount { font-family: 'DM Mono', monospace; font-size: 0.8rem; color: #f4f4f5; flex-shrink: 0; }
        .top-items-list { list-style: none; margin: 0; padding: 0; background: #18181b; border: 1px solid #27272a; border-radius: 12px; overflow: hidden; }
        .top-item { display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; border-bottom: 1px solid #1f1f22; }
        .top-item:last-child { border-bottom: none; }
        .top-item-rank { width: 20px; text-align: center; font-size: 0.78rem; color: #52525b; flex-shrink: 0; }
        .top-item-desc { flex: 1; font-size: 0.875rem; color: #f4f4f5; }
        .top-item-right { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
        .top-item-amount { font-family: 'DM Mono', monospace; font-size: 0.875rem; color: #f4f4f5; }
        .top-item-count { font-size: 0.72rem; color: #71717a; }
        .export-btn { display: flex; justify-content: center; align-items: center; background: #18181b; border: 1px solid #27272a; border-radius: 10px; color: #818cf8; font-size: 0.875rem; font-weight: 500; padding: 0.65rem; text-decoration: none; transition: background 0.15s; }
        .export-btn:hover { background: #1f1f22; }
      `}</style>
    </div>
  )
}
