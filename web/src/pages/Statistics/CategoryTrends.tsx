import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts'
import { statistics } from '@expense-tracker/shared'
import { useHouseholdStore } from '../../stores/householdStore'
import { useStatsStore } from '../../stores/statsStore'

const COLOURS = ['#6366f1', '#4ade80', '#f59e0b', 'var(--danger)', 'var(--accent-light)', '#34d399', '#fb923c', '#a5b4fc']

function formatNok(ore: number) {
  return `kr ${(ore / 100).toFixed(0)}`
}

// ─── Custom tooltip ────────────────────────────────────────────────────────────
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip">
      <p className="ct-month">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="ct-line" style={{ color: p.color }}>
          {p.name}: {formatNok(p.value)}
        </p>
      ))}
    </div>
  )
}

export function CategoryTrends() {
  const navigate = useNavigate()
  const household = useHouseholdStore((s) => s.household)
  const { stats, setStats, includePersonal } = useStatsStore()
  const [loading, setLoading] = useState(!stats)
  const [error, setError] = useState<string | null>(null)
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [view, setView] = useState<'tag' | 'category'>('category')

  useEffect(() => {
    if (!household) return
    if (stats) { setLoading(false); return }
    statistics.get(household.id, { includePersonal })
      .then((data) => { setStats(data); setLoading(false) })
      .catch((err) => { setError(err?.message ?? 'Failed to load stats.'); setLoading(false) })
  }, [household?.id])

  // Build chart data from trends
  const tagTrends = stats?.trends ?? []
  const catTrends = stats?.categoryTrends ?? []

  const allTags = Array.from(new Set(tagTrends.flatMap((t) => t.byTag.map((b) => b.tagName ?? 'Uncategorised'))))
  const allCats = Array.from(new Set(catTrends.flatMap((t) => t.byCategory.map((b) => b.categoryName ?? 'Uncategorized'))))

  const trends = view === 'tag' ? tagTrends : catTrends
  const allLabels = view === 'tag' ? allTags : allCats
  const activeLabels = selectedTag ? [selectedTag] : allLabels

  const chartData = trends.map((t) => {
    const entries = view === 'tag' ? (t as any).byTag : (t as any).byCategory
    const row: Record<string, string | number> = {
      month: t.month.slice(0, 7),
    }
    for (const label of activeLabels) {
      const entry = entries?.find((b: any) =>
        view === 'tag'
          ? (b.tagName ?? 'Uncategorised') === label
          : (b.categoryName ?? 'Uncategorized') === label
      )
      row[label] = entry?.totalOre ?? 0
    }
    return row
  })

  return (
    <div className="trends-page">
      <div className="trends-topbar">
        <button className="back-btn" onClick={() => navigate('/statistics')}>← Overview</button>
        <h1 className="trends-title">Category trends</h1>
      </div>

      {loading && <p className="trends-msg">Loading…</p>}
      {error && <p className="trends-msg trends-msg--error">{error}</p>}

      {!loading && !error && stats && (
        <>
          {/* View toggle: tag vs category */}
          <div className="tag-filter">
            <button
              className={`tag-chip ${view === 'category' ? 'tag-chip--active' : ''}`}
              onClick={() => { setView('category'); setSelectedTag(null) }}
            >
              By category
            </button>
            <button
              className={`tag-chip ${view === 'tag' ? 'tag-chip--active' : ''}`}
              onClick={() => { setView('tag'); setSelectedTag(null) }}
            >
              By tag
            </button>
          </div>

          {/* Label filter */}
          {allLabels.length > 1 && (
            <div className="tag-filter">
              <button
                className={`tag-chip ${!selectedTag ? 'tag-chip--active' : ''}`}
                onClick={() => setSelectedTag(null)}
              >
                All
              </button>
              {allLabels.map((label) => (
                <button
                  key={label}
                  className={`tag-chip ${selectedTag === label ? 'tag-chip--active' : ''}`}
                  onClick={() => setSelectedTag(selectedTag === label ? null : label)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {chartData.length === 0 ? (
            <p className="trends-empty">No trend data yet. Add expenses across multiple months to see trends.</p>
          ) : (
            <div className="trends-chart">
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis
                    dataKey="month"
                    tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: 'var(--border)' }}
                  />
                  <YAxis
                    tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `${Math.round(v / 100)}`}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend
                    iconType="circle" iconSize={7}
                    formatter={(value) => <span style={{ color: 'var(--text-secondary)', fontSize: '0.78rem' }}>{value}</span>}
                  />
                  {activeLabels.map((label, idx) => (
                    <Line
                      key={label}
                      type="monotone"
                      dataKey={label}
                      stroke={COLOURS[idx % COLOURS.length]}
                      strokeWidth={2}
                      dot={{ fill: COLOURS[idx % COLOURS.length], r: 3 }}
                      activeDot={{ r: 5 }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Monthly breakdown table */}
          {trends.length > 0 && (
            <section className="trends-table-section">
              <h2 className="trends-section-title">Monthly totals</h2>
              <div className="trends-table">
                {[...trends].reverse().map((t) => {
                  const entries = view === 'tag' ? (t as any).byTag : (t as any).byCategory
                  return (
                    <div key={t.month} className="trends-table-row">
                      <span className="tt-month">
                        {new Date(t.month + '-01').toLocaleDateString('nb-NO', { month: 'short', year: 'numeric' })}
                      </span>
                      <div className="tt-tags">
                        {(entries ?? [])
                          .filter((b: any) => {
                            if (!selectedTag) return true
                            const name = view === 'tag' ? (b.tagName ?? 'Uncategorised') : (b.categoryName ?? 'Uncategorized')
                            return name === selectedTag
                          })
                          .map((b: any, i: number) => (
                            <span key={i} className="tt-tag-row">
                              <span className="tt-tag-name">
                                {view === 'tag' ? (b.tagName ?? 'Uncategorised') : (b.categoryName ?? 'Uncategorized')}
                              </span>
                              <span className="tt-tag-amount">{formatNok(b.totalOre)}</span>
                            </span>
                          ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          )}
        </>
      )}

      <style>{`
        .trends-page { max-width: 720px; margin: 0 auto; padding: 1.25rem 1rem 2rem; font-family: 'Geist', sans-serif; color: var(--text-primary); }
        .trends-topbar { display: flex; align-items: center; gap: 1rem; margin-bottom: 1.5rem; }
        .back-btn { background: none; border: none; color: var(--accent-light); font-size: 0.9rem; cursor: pointer; padding: 0; font-family: inherit; white-space: nowrap; }
        .trends-title { font-size: 1.25rem; font-weight: 600; margin: 0; letter-spacing: -0.02em; }
        .trends-msg { color: var(--text-muted); font-size: 0.9rem; text-align: center; padding: 2rem 0; margin: 0; }
        .trends-msg--error { color: var(--danger); }
        .tag-filter { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1.25rem; }
        .tag-chip { background: var(--bg-card); border: 1px solid var(--border); border-radius: 20px; color: var(--text-muted); font-size: 0.8rem; padding: 0.3rem 0.75rem; cursor: pointer; font-family: inherit; transition: border-color 0.15s, color 0.15s, background 0.15s; }
        .tag-chip--active { background: rgba(99,102,241,0.12); border-color: var(--accent); color: var(--accent-light); }
        .trends-empty { color: var(--text-faint); font-size: 0.875rem; text-align: center; padding: 2rem 0; line-height: 1.5; }
        .trends-chart { background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; padding: 1rem 0.5rem; margin-bottom: 1.5rem; }
        .chart-tooltip { background: var(--badge-bg); border: 1px solid var(--border-input); border-radius: 8px; padding: 0.5rem 0.75rem; }
        .ct-month { font-size: 0.75rem; color: var(--text-muted); margin: 0 0 4px; }
        .ct-line { font-family: 'DM Mono', monospace; font-size: 0.8rem; margin: 0; }
        .trends-table-section { }
        .trends-section-title { font-size: 0.75rem; font-weight: 500; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); margin: 0 0 0.625rem 0.25rem; }
        .trends-table { background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
        .trends-table-row { padding: 0.75rem 1rem; border-bottom: 1px solid var(--border-subtle); }
        .trends-table-row:last-child { border-bottom: none; }
        .tt-month { font-size: 0.8rem; font-weight: 500; color: var(--text-secondary); display: block; margin-bottom: 0.4rem; text-transform: capitalize; }
        .tt-tags { display: flex; flex-direction: column; gap: 3px; }
        .tt-tag-row { display: flex; justify-content: space-between; }
        .tt-tag-name { font-size: 0.8rem; color: var(--text-muted); }
        .tt-tag-amount { font-family: 'DM Mono', monospace; font-size: 0.8rem; color: var(--text-primary); }
      `}</style>
    </div>
  )
}
