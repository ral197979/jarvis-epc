/**
 * Denver Engineering — Predict Dashboard (v10.15.0)
 *
 * Statistical prediction: portfolio health, risk matrix (SVG scatter),
 * EAC forecast trend lines, anomaly flags.
 */
import React, { useEffect, useState, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type RiskLevel   = 'green' | 'amber' | 'red' | 'unknown'
type CpiTrend    = 'improving' | 'worsening' | 'stable' | 'insufficient_data'

interface ForecastPoint { date: string; eac: number }

interface EacForecast {
  slope:          number
  r2:             number
  projectedEac:   number
  trend:          CpiTrend
  forecastPoints: ForecastPoint[]
}

interface ProjectHealth {
  projectId:      string
  projectName:    string
  status:         string
  healthScore:    number
  riskLevel:      RiskLevel
  cpi:            number | null
  spi:            number | null
  cpiTrend:       CpiTrend
  acwp:           number
  revisedBudget:  number
  burnPct:        number
  pendingCoValue: number
  overdueActions: number
  snapshotCount:  number
  lastSnapshot:   string | null
  forecast:       EacForecast | null
  anomalies:      string[]
}

interface PredictSummary {
  projects:       ProjectHealth[]
  portfolioScore: number
  atRisk:         number
  watchlist:      number
  healthy:        number
  avgCpi:         number
  avgSpi:         number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const RISK_COLOR: Record<RiskLevel, string> = {
  green:   '#22c55e',
  amber:   '#f59e0b',
  red:     '#ef4444',
  unknown: '#6b7280',
}

const TREND_ICON: Record<CpiTrend, string> = {
  improving:         '↑',
  worsening:         '↓',
  stable:            '→',
  insufficient_data: '?',
}

const fmt = (n: number) => {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toLocaleString()}`
}

// ─── Health gauge (SVG arc) ───────────────────────────────────────────────────

function HealthGauge({ score, size = 56 }: { score: number; size?: number }) {
  const r   = size / 2 - 5
  const cx  = size / 2
  const cy  = size / 2
  const pct = score / 100
  const color = score >= 70 ? '#22c55e' : score >= 45 ? '#f59e0b' : '#ef4444'

  // Arc from 135° to 405° (270° sweep)
  const startAngle = 135 * (Math.PI / 180)
  const endAngle   = startAngle + pct * 270 * (Math.PI / 180)
  const x1 = cx + r * Math.cos(startAngle)
  const y1 = cy + r * Math.sin(startAngle)
  const x2 = cx + r * Math.cos(endAngle)
  const y2 = cy + r * Math.sin(endAngle)
  const largeArc = pct > 0.5 ? 1 : 0

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Track */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--jarvis-b)" strokeWidth={5} />
      {/* Arc */}
      {score > 0 && (
        <path
          d={`M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`}
          fill="none" stroke={color} strokeWidth={5} strokeLinecap="round"
        />
      )}
      {/* Score text */}
      <text x={cx} y={cy + 5} textAnchor="middle" fontSize={size / 4} fontWeight={700} fill={color}>
        {score}
      </text>
    </svg>
  )
}

// ─── Risk matrix scatter (SVG) ────────────────────────────────────────────────

function RiskMatrix({ projects }: { projects: ProjectHealth[] }) {
  const [hovered, setHovered] = useState<string | null>(null)
  const W = 340, H = 240, PAD = { t: 16, r: 16, b: 32, l: 40 }
  const chartW = W - PAD.l - PAD.r
  const chartH = H - PAD.t - PAD.b

  // X = cost risk (1 - CPI, clamped 0-0.5), Y = schedule risk (1 - SPI, clamped 0-0.5)
  const withData = projects.filter(p => p.cpi !== null && p.spi !== null)

  const xOf = (p: ProjectHealth) => PAD.l + Math.min(Math.max(0, 1 - p.cpi!), 0.5) / 0.5 * chartW
  const yOf = (p: ProjectHealth) => PAD.t + chartH - Math.min(Math.max(0, 1 - p.spi!), 0.5) / 0.5 * chartH

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W, overflow: 'visible' }}>
      {/* Quadrant fills */}
      <rect x={PAD.l} y={PAD.t} width={chartW/2} height={chartH/2} fill="#22c55e11" />
      <rect x={PAD.l + chartW/2} y={PAD.t} width={chartW/2} height={chartH/2} fill="#f59e0b11" />
      <rect x={PAD.l} y={PAD.t + chartH/2} width={chartW/2} height={chartH/2} fill="#f59e0b11" />
      <rect x={PAD.l + chartW/2} y={PAD.t + chartH/2} width={chartW/2} height={chartH/2} fill="#ef444422" />

      {/* Axes */}
      <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={H - PAD.b} stroke="var(--jarvis-b)" />
      <line x1={PAD.l} y1={H - PAD.b} x2={W - PAD.r} y2={H - PAD.b} stroke="var(--jarvis-b)" />

      {/* Axis labels */}
      <text x={W / 2} y={H - 4} textAnchor="middle" fontSize={9} fill="var(--jarvis-ts)">Cost Risk →</text>
      <text x={12} y={H / 2} textAnchor="middle" fontSize={9} fill="var(--jarvis-ts)" transform={`rotate(-90, 12, ${H/2})`}>Sched Risk →</text>
      <text x={PAD.l + 4} y={PAD.t + 12} fontSize={8} fill="#22c55e99">Low risk</text>
      <text x={W - PAD.r - 4} y={H - PAD.b - 4} fontSize={8} fill="#ef444499" textAnchor="end">High risk</text>

      {/* Points */}
      {withData.map(p => {
        const x = xOf(p), y = yOf(p)
        const isHov = hovered === p.projectId
        return (
          <g key={p.projectId}
            onMouseEnter={() => setHovered(p.projectId)}
            onMouseLeave={() => setHovered(null)}
            style={{ cursor: 'pointer' }}>
            <circle cx={x} cy={y} r={isHov ? 9 : 7} fill={RISK_COLOR[p.riskLevel]} opacity={0.85} />
            {isHov && (
              <text x={x} y={y - 12} textAnchor="middle" fontSize={9} fill="var(--jarvis-t)" fontWeight={600}>
                {p.projectName.slice(0, 18)}
              </text>
            )}
            {!isHov && (
              <text x={x} y={y + 3} textAnchor="middle" fontSize={7} fill="#fff" fontWeight={700}>
                {p.healthScore}
              </text>
            )}
          </g>
        )
      })}

      {withData.length === 0 && (
        <text x={W/2} y={H/2} textAnchor="middle" fontSize={11} fill="var(--jarvis-ts)">
          No EVM data yet
        </text>
      )}
    </svg>
  )
}

// ─── EAC forecast chart (SVG) ─────────────────────────────────────────────────

function ForecastChart({ forecast, budget }: { forecast: EacForecast; budget: number }) {
  const pts   = forecast.forecastPoints
  const W = 320, H = 140, PAD = { t: 12, r: 8, b: 32, l: 52 }
  const chartW = W - PAD.l - PAD.r
  const chartH = H - PAD.t - PAD.b

  if (pts.length < 2) return null

  // Split actual vs projected (last 4 are future)
  const actualPts   = pts.slice(0, pts.length - 4)
  const projectedPts = pts.slice(pts.length - 4 - 1)  // overlap by 1 for continuity

  const allEac  = pts.map(p => p.eac)
  const maxVal  = Math.max(...allEac, budget) * 1.1 || 1
  const t0      = new Date(pts[0].date).getTime()
  const tLast   = new Date(pts[pts.length - 1].date).getTime()
  const tRange  = tLast - t0 || 1

  const xOf = (date: string) => PAD.l + ((new Date(date).getTime() - t0) / tRange) * chartW
  const yOf = (v: number)    => PAD.t + chartH - (v / maxVal) * chartH

  const pathOf = (ps: ForecastPoint[]) =>
    ps.map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(p.date)},${yOf(p.eac)}`).join(' ')

  const trendColor = forecast.trend === 'improving' ? '#22c55e' : forecast.trend === 'worsening' ? '#ef4444' : '#f59e0b'

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W }}>
      {/* Budget line */}
      {budget > 0 && (
        <>
          <line x1={PAD.l} y1={yOf(budget)} x2={W - PAD.r} y2={yOf(budget)} stroke="#6366f1" strokeWidth={1} strokeDasharray="4 3" />
          <text x={PAD.l + 2} y={yOf(budget) - 3} fontSize={8} fill="#6366f1">Budget</text>
        </>
      )}
      {/* Actual EAC */}
      <path d={pathOf(actualPts)} fill="none" stroke={trendColor} strokeWidth={2} strokeLinejoin="round" />
      {/* Projected */}
      <path d={pathOf(projectedPts)} fill="none" stroke={trendColor} strokeWidth={2} strokeLinejoin="round" strokeDasharray="5 3" opacity={0.6} />
      {/* Last actual point */}
      {actualPts.length > 0 && (
        <circle cx={xOf(actualPts[actualPts.length-1].date)} cy={yOf(actualPts[actualPts.length-1].eac)} r={3} fill={trendColor} />
      )}
      {/* X labels (first, mid, last) */}
      {[pts[0], pts[Math.floor(pts.length/2)], pts[pts.length-1]].map((p, i) => (
        <text key={i} x={xOf(p.date)} y={H - PAD.b + 12} textAnchor="middle" fontSize={8} fill="var(--jarvis-ts)">
          {p.date.slice(5)}
        </text>
      ))}
      {/* Y labels */}
      {[0, 0.5, 1].map(f => {
        const v = f * maxVal
        return (
          <text key={f} x={PAD.l - 4} y={yOf(v) + 3} textAnchor="end" fontSize={8} fill="var(--jarvis-ts)">
            {fmt(v)}
          </text>
        )
      })}
      {/* Axes */}
      <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={H - PAD.b} stroke="var(--jarvis-b)" />
      <line x1={PAD.l} y1={H - PAD.b} x2={W - PAD.r} y2={H - PAD.b} stroke="var(--jarvis-b)" />
    </svg>
  )
}

// ─── Project card ─────────────────────────────────────────────────────────────

function ProjectCard({ p, expanded, onToggle }: {
  p:        ProjectHealth
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <div style={{ background: 'var(--jarvis-s2)', border: `1px solid ${expanded ? RISK_COLOR[p.riskLevel] + '66' : 'var(--jarvis-b)'}`, borderRadius: 10, overflow: 'hidden' }}>
      <div onClick={onToggle} style={{ padding: '12px 16px', cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'center' }}>
        <HealthGauge score={p.healthScore} size={52} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--jarvis-t)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {p.projectName}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 99, background: `${RISK_COLOR[p.riskLevel]}22`, color: RISK_COLOR[p.riskLevel], fontWeight: 600 }}>
              {p.riskLevel.toUpperCase()}
            </span>
            {p.cpi !== null && (
              <span style={{ fontSize: 11, color: p.cpi >= 1 ? '#22c55e' : '#ef4444' }}>
                CPI {p.cpi.toFixed(2)} {TREND_ICON[p.cpiTrend]}
              </span>
            )}
            {p.spi !== null && (
              <span style={{ fontSize: 11, color: p.spi >= 1 ? '#22c55e' : '#f59e0b' }}>
                SPI {p.spi.toFixed(2)}
              </span>
            )}
            <span style={{ fontSize: 11, color: 'var(--jarvis-ts)' }}>
              Burn {p.burnPct}%
            </span>
          </div>
        </div>
        <span style={{ fontSize: 14, color: 'var(--jarvis-ts)', flexShrink: 0 }}>{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div style={{ borderTop: '1px solid var(--jarvis-b)', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Anomalies */}
          {p.anomalies.length > 0 && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 7, padding: '10px 12px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', marginBottom: 4 }}>⚠ Anomalies Detected</div>
              {p.anomalies.map((a, i) => (
                <div key={i} style={{ fontSize: 11, color: '#991b1b', marginTop: 2 }}>• {a}</div>
              ))}
            </div>
          )}

          {/* Metrics grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {[
              ['Revised Budget',   fmt(p.revisedBudget),                  'var(--jarvis-t)'],
              ['ACWP',             fmt(p.acwp),                            '#ef4444'],
              ['Burn Rate',        `${p.burnPct}%`,                        p.burnPct > 100 ? '#ef4444' : p.burnPct > 85 ? '#f59e0b' : '#22c55e'],
              ['Pending COs',      fmt(p.pendingCoValue),                  '#f59e0b'],
              ['Overdue Actions',  String(p.overdueActions),               p.overdueActions > 3 ? '#ef4444' : 'var(--jarvis-ts)'],
              ['Snapshots',        `${p.snapshotCount} data pts`,          'var(--jarvis-ts)'],
            ].map(([label, val, color]) => (
              <div key={label} style={{ background: 'var(--jarvis-s)', borderRadius: 6, padding: '8px 10px' }}>
                <div style={{ fontSize: 10, color: 'var(--jarvis-ts)' }}>{label}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color, marginTop: 2 }}>{val}</div>
              </div>
            ))}
          </div>

          {/* Forecast chart */}
          {p.forecast && p.forecast.forecastPoints.length >= 4 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--jarvis-t)', marginBottom: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
                EAC Forecast
                <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--jarvis-ts)' }}>
                  30d projection: {fmt(p.forecast.projectedEac)} · R²={p.forecast.r2.toFixed(2)}
                </span>
                <span style={{ fontSize: 11, fontWeight: 600, color: p.forecast.trend === 'improving' ? '#22c55e' : p.forecast.trend === 'worsening' ? '#ef4444' : '#f59e0b' }}>
                  {TREND_ICON[p.forecast.trend]} {p.forecast.trend}
                </span>
              </div>
              <ForecastChart forecast={p.forecast} budget={p.revisedBudget} />
            </div>
          )}

          {p.snapshotCount < 2 && (
            <div style={{ fontSize: 12, color: 'var(--jarvis-ts)', fontStyle: 'italic' }}>
              Forecasting requires at least 2 EVM snapshots. Add snapshots in the EVM module.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

interface Props {
  policy?:     Record<string, unknown>
  biz?:        Record<string, unknown>
  onNavigate?: (tab: string) => void
}

export default function PredictView({ onNavigate }: Props) {
  const [summary,   setSummary]   = useState<PredictSummary | null>(null)
  const [loading,   setLoading]   = useState(false)
  const [expanded,  setExpanded]  = useState<string | null>(null)
  const [filterRisk, setFilterRisk] = useState<RiskLevel | 'all'>('all')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch('/api/v1/predict/portfolio')
      const data = await res.json() as { summary: PredictSummary }
      setSummary(data.summary)
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const projects = summary?.projects.filter(p =>
    filterRisk === 'all' || p.riskLevel === filterRisk
  ) ?? []

  const chipS = (active: boolean, color?: string): React.CSSProperties => ({
    padding: '4px 12px', borderRadius: 99, fontSize: 12, cursor: 'pointer',
    border: `1px solid ${color ?? 'var(--jarvis-b)'}`,
    background: active ? (color ?? 'var(--jarvis-a)') : 'transparent',
    color:      active ? '#fff' : (color ?? 'var(--jarvis-t)'),
    fontWeight: active ? 600 : 400,
  })

  const portfolioColor = !summary ? '#6b7280'
    : summary.portfolioScore >= 70 ? '#22c55e'
    : summary.portfolioScore >= 45 ? '#f59e0b'
    : '#ef4444'

  return (
    <div style={{ padding: 24, maxWidth: 1060, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 22 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--jarvis-t)' }}>🔮 Predict</h2>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--jarvis-ts)' }}>
            Statistical health scoring · EAC forecast (linear regression) · Anomaly detection
          </p>
        </div>
        <button onClick={load} disabled={loading}
          style={{ padding: '7px 14px', borderRadius: 7, border: '1px solid var(--jarvis-b)', background: 'var(--jarvis-s2)', color: 'var(--jarvis-t)', cursor: 'pointer', fontSize: 13, opacity: loading ? .6 : 1 }}>
          {loading ? '⟳ Analyzing…' : '⟳ Refresh'}
        </button>
      </div>

      {summary && (
        <>
          {/* Portfolio strip */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '0 0 auto', background: 'var(--jarvis-s2)', border: '1px solid var(--jarvis-b)', borderRadius: 10, padding: '14px 20px', display: 'flex', gap: 14, alignItems: 'center' }}>
              <HealthGauge score={summary.portfolioScore} size={64} />
              <div>
                <div style={{ fontSize: 11, color: 'var(--jarvis-ts)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Portfolio Health</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: portfolioColor }}>{summary.portfolioScore}/100</div>
                <div style={{ fontSize: 11, color: 'var(--jarvis-ts)', marginTop: 2 }}>{summary.projects.length} projects analyzed</div>
              </div>
            </div>
            {[
              ['🔴 At Risk',   String(summary.atRisk),    '#ef4444'],
              ['🟡 Watchlist', String(summary.watchlist), '#f59e0b'],
              ['🟢 Healthy',   String(summary.healthy),   '#22c55e'],
              ['Avg CPI',     summary.avgCpi.toFixed(2),  summary.avgCpi >= 1 ? '#22c55e' : '#ef4444'],
              ['Avg SPI',     summary.avgSpi.toFixed(2),  summary.avgSpi >= 1 ? '#22c55e' : '#f59e0b'],
            ].map(([label, val, color]) => (
              <div key={label} style={{ flex: '1 1 90px', background: 'var(--jarvis-s2)', border: '1px solid var(--jarvis-b)', borderRadius: 10, padding: '14px 16px' }}>
                <div style={{ fontSize: 11, color: 'var(--jarvis-ts)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
                <div style={{ fontSize: 24, fontWeight: 700, color, marginTop: 2 }}>{val}</div>
              </div>
            ))}
          </div>

          {/* Risk matrix + filters */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ flex: '0 0 auto', background: 'var(--jarvis-s2)', border: '1px solid var(--jarvis-b)', borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--jarvis-t)', marginBottom: 8 }}>
                Risk Matrix <span style={{ fontWeight: 400, color: 'var(--jarvis-ts)', fontSize: 11 }}>Cost risk vs Schedule risk</span>
              </div>
              <RiskMatrix projects={summary.projects} />
            </div>

            <div style={{ flex: '1 1 200px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--jarvis-t)' }}>Health Score Guide</div>
              {[
                ['70–100', 'Healthy', '#22c55e', 'CPI ≥ 1.0, SPI ≥ 1.0, burn on track'],
                ['45–69',  'Watchlist', '#f59e0b', 'Minor cost or schedule variance'],
                ['0–44',   'At Risk', '#ef4444', 'CPI < 0.85 or SPI < 0.85 or budget exceeded'],
              ].map(([range, label, color, desc]) => (
                <div key={range} style={{ background: 'var(--jarvis-s2)', border: `1px solid ${color}33`, borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color }}>{range}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color }}>{label}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--jarvis-ts)', marginTop: 3 }}>{desc}</div>
                </div>
              ))}
              <div style={{ fontSize: 11, color: 'var(--jarvis-ts)', lineHeight: 1.5, marginTop: 4 }}>
                Score = 40% CPI + 30% SPI + 20% burn rate + 10% CO risk − action item penalty.
                Forecast uses linear regression on EVM snapshots (R² shown per project).
              </div>
            </div>
          </div>

          {/* Filter chips */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--jarvis-ts)' }}>Filter:</span>
            <button style={chipS(filterRisk === 'all')}    onClick={() => setFilterRisk('all')}>All ({summary.projects.length})</button>
            <button style={chipS(filterRisk === 'red',   '#ef4444')} onClick={() => setFilterRisk('red')}>At Risk ({summary.atRisk})</button>
            <button style={chipS(filterRisk === 'amber', '#f59e0b')} onClick={() => setFilterRisk('amber')}>Watchlist ({summary.watchlist})</button>
            <button style={chipS(filterRisk === 'green', '#22c55e')} onClick={() => setFilterRisk('green')}>Healthy ({summary.healthy})</button>
          </div>

          {/* Project cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {projects.length === 0 && (
              <div style={{ textAlign: 'center', padding: '32px', color: 'var(--jarvis-ts)', fontSize: 13 }}>
                No projects match. {summary.projects.length === 0 && (
                  <span>Add projects and EVM data to see predictions. <button onClick={() => onNavigate?.('evm')} style={{ background: 'none', border: 'none', color: 'var(--jarvis-a)', cursor: 'pointer', textDecoration: 'underline', fontSize: 13 }}>Go to EVM →</button></span>
                )}
              </div>
            )}
            {projects
              .sort((a, b) => a.healthScore - b.healthScore)  // worst first
              .map(p => (
                <ProjectCard
                  key={p.projectId}
                  p={p}
                  expanded={expanded === p.projectId}
                  onToggle={() => setExpanded(expanded === p.projectId ? null : p.projectId)}
                />
              ))
            }
          </div>
        </>
      )}

      {!summary && !loading && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--jarvis-ts)', fontSize: 13 }}>
          Click Refresh to analyze portfolio health.
        </div>
      )}
    </div>
  )
}
