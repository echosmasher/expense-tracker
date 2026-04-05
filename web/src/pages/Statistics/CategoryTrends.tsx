import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts'
import { statistics } from '@expense-tracker/shared'
import { useHouseholdStore } from '../../stores/householdStore'
import { useStatsStore } from '../../stores/statsStore'

const COLOURS = ['#6366f1', '#4ade80', '#f59e0b', '#f87171', '#818cf8', '#34d399', '#fb923c', '#a5b4fc']

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

  useEffect(() => {
    if (!household) return
    if (stats) { setLoading(false); return }
    statistics.get(household.id, { includePersonal })
      .then((data) => { setStats(data); setLoading(false) })
      .catch((err) => { setError(err?.message ?? 'Failed to load stats.'); setLoading(false) })
  }, [household?.id])

  // Build chart data from trends: array of { month, tag1: ore, tag2: ore, ... }
  const trends = stats?.trends ?? []
  const allTags = Array.from(new Set(trends.flatMap((t) => t.byTag.map((b) => b.tagName ?? 'Uncategorised'))))

  // Filter to selected tag or show all
  const activeTags = selectedTag ? [selectedTag] : allTags

  const chartData = trends.map((t) => {
    const row: Record<string, string | number> = {
      month: t.month.slice(0, 7),
    }
    for (const tag of activeTags) {
      const entry = t.byTag.find((b) => (b.tagName ?? 'Uncategorised') === tag)
      row[tag] = entry?.totalOre ?? 0
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
          {/* Tag filter */}
          {allTags.length > 1 && (
            <div className="tag-filter">
              <button
                className={`tag-chip ${!selectedTag ? 'tag-chip--active' : ''}`}
                onClick={() => setSelectedTag(null)}
              >
                All
              </button>
              {allTags.map((tag) => (
                <button
                  key={tag}
                  className={`tag-chip ${selectedTag === tag ? 'tag-chip--active' : ''}`}
                  onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                >
                  {tag}
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
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis
                    dataKey="month"
                    tick={{ fill: '#71717a', fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: '#27272a' }}
                  />
                  <YAxis
                    tick={{ fill: '#71717a', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `${Math.round(v / 100)}`}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend
                    iconType="circle" iconSize={7}
                    formatter={(value) => <span style={{ color: '#a1a1aa', fontSize: '0.78rem' }}>{value}</span>}
                  />
                  {activeTags.map((tag, idx) => (
                    <Line
                      key={tag}
                      type="monotone"
                      dataKey={tag}
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
                {[...trends].reverse().map((t) => (
                  <div key={t.month} className="trends-table-row">
                    <span className="tt-month">
                      {new Date(t.month + '-01').toLocaleDateString('nb-NO', { month: 'short', year: 'numeric' })}
                    </span>
                    <div className="tt-tags">
                      {t.byTag
                        .filter((b) => !selectedTag || (b.tagName ?? 'Uncategorised') === selectedTag)
                        .map((b, i) => (
                          <span key={i} className="tt-tag-row">
                            <span className="tt-tag-name">{b.tagName ?? 'Uncategorised'}</span>
                            <span className="tt-tag-amount">{formatNok(b.totalOre)}</span>
                          </span>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Geist:wght@300;400;500;600&display=swap');
        .trends-page { max-width: 720px; margin: 0 auto; padding: 1.25rem 1rem 2rem; font-family: 'Geist', sans-serif; color: #f4f4f5; }
        .trends-topbar { display: flex; align-items: center; gap: 1rem; margin-bottom: 1.5rem; }
        .back-btn { background: none; border: none; color: #818cf8; font-size: 0.9rem; cursor: pointer; padding: 0; font-family: inherit; white-space: nowrap; }
        .trends-title { font-size: 1.25rem; font-weight: 600; margin: 0; letter-spacing: -0.02em; }
        .trends-msg { color: #71717a; font-size: 0.9rem; text-align: center; padding: 2rem 0; margin: 0; }
        .trends-msg--error { color: #f87171; }
        .tag-filter { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1.25rem; }
        .tag-chip { background: #18181b; border: 1px solid #27272a; border-radius: 20px; color: #71717a; font-size: 0.8rem; padding: 0.3rem 0.75rem; cursor: pointer; font-family: inherit; transition: border-color 0.15s, color 0.15s, background 0.15s; }
        .tag-chip--active { background: rgba(99,102,241,0.12); border-color: #6366f1; color: #818cf8; }
        .trends-empty { color: #52525b; font-size: 0.875rem; text-align: center; padding: 2rem 0; line-height: 1.5; }
        .trends-chart { background: #18181b; border: 1px solid #27272a; border-radius: 12px; padding: 1rem 0.5rem; margin-bottom: 1.5rem; }
        .chart-tooltip { background: #27272a; border: 1px solid #3f3f46; border-radius: 8px; padding: 0.5rem 0.75rem; }
        .ct-month { font-size: 0.75rem; color: #71717a; margin: 0 0 4px; }
        .ct-line { font-family: 'DM Mono', monospace; font-size: 0.8rem; margin: 0; }
        .trends-table-section { }
        .trends-section-title { font-size: 0.75rem; font-weight: 500; text-transform: uppercase; letter-spacing: 0.06em; color: #71717a; margin: 0 0 0.625rem 0.25rem; }
        .trends-table { background: #18181b; border: 1px solid #27272a; border-radius: 12px; overflow: hidden; }
        .trends-table-row { padding: 0.75rem 1rem; border-bottom: 1px solid #1f1f22; }
        .trends-table-row:last-child { border-bottom: none; }
        .tt-month { font-size: 0.8rem; font-weight: 500; color: #a1a1aa; display: block; margin-bottom: 0.4rem; text-transform: capitalize; }
        .tt-tags { display: flex; flex-direction: column; gap: 3px; }
        .tt-tag-row { display: flex; justify-content: space-between; }
        .tt-tag-name { font-size: 0.8rem; color: #71717a; }
        .tt-tag-amount { font-family: 'DM Mono', monospace; font-size: 0.8rem; color: #f4f4f5; }
      `}</style>
    </div>
  )
}
