/**
 * Live wiring for CRM — maps the "Proposals & Bid Pipeline" module onto the UI's
 * Lead/funnel shapes. Tenant-wide endpoints (`{ proposals }`, `{ summary }`);
 * the service already returns camelCase.
 */
import { api } from '../http'
import type { Lead } from '../types'

function formatMoney(amount: number | null | undefined): string {
  if (!amount) return '$0'
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(amount)
  } catch {
    return `$${Math.round(amount).toLocaleString()}`
  }
}

/** Proposal lifecycle status → CRM pipeline stage label. */
const STAGE_LABEL: Record<string, string> = {
  draft: 'Qualification',
  submitted: 'Tendering',
  won: 'Awarded',
  lost: 'Lost',
  no_bid: 'No Bid',
}

export interface RawProposal {
  id: string
  proposalNumber?: string
  title: string
  clientName: string
  status: string
  estimatedValue: number
  probabilityPct: number
}

export function mapLead(p: RawProposal): Lead {
  return {
    id: p.proposalNumber ?? p.id,
    name: p.title,
    client: p.clientName,
    estValue: formatMoney(p.estimatedValue),
    probability: Math.round(p.probabilityPct ?? 0),
    owner: '—', // proposals don't carry an owner field
    stage: STAGE_LABEL[p.status] ?? p.status,
  }
}

export interface RawPipelineSummary {
  byStatus: Record<string, { count: number; value: number }>
  weightedPipeline: number
}

export interface FunnelStage {
  stage: string
  count: number
  value: string
}

/** Collapse proposal statuses into the funnel stages the CRM screen renders. */
export function mapFunnel(s: RawPipelineSummary): FunnelStage[] {
  const by = s.byStatus ?? {}
  const at = (k: string) => by[k] ?? { count: 0, value: 0 }
  return [
    { stage: 'Qualification', ...at('draft') },
    { stage: 'Tendering', ...at('submitted') },
    { stage: 'Awarded', ...at('won') },
  ].map((x) => ({ stage: x.stage, count: x.count, value: formatMoney(x.value) }))
}

export async function fetchLeadsLive(): Promise<Lead[]> {
  const res = await api<{ proposals: RawProposal[] }>('/proposals')
  return (res.proposals ?? []).map(mapLead)
}

export async function fetchFunnelLive(): Promise<FunnelStage[]> {
  const res = await api<{ summary: RawPipelineSummary }>('/proposals/summary')
  return mapFunnel(res.summary)
}
