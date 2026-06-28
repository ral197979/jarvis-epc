/**
 * Live wiring for Finance / EVM — summary metrics + S-curve trend.
 *
 * Project-scoped endpoints. The API returns raw dollar amounts; the UI chart is
 * labelled "($M)", so trend values are converted to millions here.
 *
 * NOTE — `wbs` stays on mock: the per-line breakdown needs the active baseline
 * resolved first (`GET /evm/baselines` → `GET /evm/baselines/:id/wbs`), and the
 * raw WBS entry doesn't carry per-line EV/AC/CPI/SPI. See docs/ADAPTER_STRATEGY.md.
 */
import { api } from '../http'
import type { EvmSummary, EvmTrendPoint } from '../types'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const millions = (v: number): number => Math.round((v / 1_000_000) * 100) / 100

function formatMoney(amount: number | null | undefined): string {
  if (!amount) return '—'
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      notation: 'compact',
      maximumFractionDigits: 1,
      trailingZeroDisplay: 'stripIfInteger',
    }).format(amount)
  } catch {
    return `$${Math.round(amount).toLocaleString()}`
  }
}

/** Shape of `EvmMetrics` from api/services/evm/evmService.ts (BCWS=PV, BCWP=EV, ACWP=AC). */
export interface RawEvmMetrics {
  bac: number
  bcws: number
  bcwp: number
  acwp: number
  cpi: number | null
  spi: number | null
  eac: number | null
  etc: number | null
  vac: number | null
}

export function mapEvmSummary(m: RawEvmMetrics): EvmSummary {
  return {
    pv: formatMoney(m.bcws),
    ev: formatMoney(m.bcwp),
    ac: formatMoney(m.acwp),
    cpi: m.cpi ?? 0,
    spi: m.spi ?? 0,
    eac: formatMoney(m.eac),
    etc: formatMoney(m.etc),
    vac: formatMoney(m.vac),
  }
}

export interface RawScurvePoint {
  snapshotDate: string // YYYY-MM-DD
  bcws: number
  bcwp: number
  acwp: number
}

export function mapScurvePoint(p: RawScurvePoint): EvmTrendPoint {
  const monthIdx = parseInt(p.snapshotDate.slice(5, 7), 10) - 1
  return {
    month: MONTHS[monthIdx] ?? p.snapshotDate.slice(0, 7),
    pv: millions(p.bcws),
    ev: millions(p.bcwp),
    ac: millions(p.acwp),
  }
}

export async function fetchEvmSummaryLive(projectId: string): Promise<EvmSummary> {
  const res = await api<{ metrics: RawEvmMetrics }>(`/projects/${projectId}/evm/metrics`)
  return mapEvmSummary(res.metrics)
}

export async function fetchEvmTrendLive(projectId: string): Promise<EvmTrendPoint[]> {
  if (!projectId) return []
  const res = await api<{ scurve: RawScurvePoint[] }>(`/projects/${projectId}/evm/scurve`)
  return (res.scurve ?? []).map(mapScurvePoint)
}
