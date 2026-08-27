/**
 * Denver Engineering — HubView  ·  Project Hub (unified cross-domain summary)
 */
import React, { useState, useEffect } from 'react'
import { useBizStore, selectContracts, selectLeads, selectDocuments, selectIncidents, selectActionItems, selectPunchItems } from '../modules/biz/store'
import { StatusBadge } from './StatusBadge'
import type { PolicyConfig } from '../modules/biz/dispatch'

export interface HubViewProps { policy?: Partial<PolicyConfig>; onNavigate?: (tab: string) => void }
function fmt(n: number) { if (n >= 1_000_000) return `$${(n/1_000_000).toFixed(1)}M`; if (n >= 1_000) return `$${(n/1_000).toFixed(0)}K`; return `$${n.toFixed(0)}` }

// ─── Eight tiles, three different kinds of truth ─────────────────────────────
//
// This hub read ten store collections and rendered every tile as a confident
// number. Those ten do not share a backend story, and a tile cannot be honest
// without knowing which of the three it is:
//
//   TENANT-WIDE, REAL — fetched here, no selector needed:
//     projects       GET /api/v1/projects            project.view
//     documents      GET /api/v1/files/documents     docs.view
//     purchase_orders GET /api/v1/purchase-orders    procurement.view
//     actions        GET /api/v1/actions             personal.admin
//
//   PROJECT-SCOPED — real, but every route needs a project in the path, so a
//   cross-project "at a glance" total does not exist to fetch. Asking the hub
//   to pick one would make it a different screen:
//     incidents      GET /projects/:projectId/safety/incidents
//     punch items    GET /projects/:projectId/punch-lists
//     EVM metrics    GET /projects/:projectId/evm/metrics
//
//   NO BACKEND — nothing to call:
//     contracts      table (002_epc_core), no route
//     leads          table (002_epc_core:408), no route
//     invoices       no table, no route (see FinanceView)
//     rfqs           no table at all
//
// A tile that cannot know its number shows `—` and says why, rather than `0`.
// The Projects tile was also MISLABELLED: it read `contracts` — the table with
// no route — while a real projects endpoint existed all along.

type TileState = 'ok' | 'loading' | 'unavailable' | 'project-scoped' | 'no-backend'

interface ProjectRow { status?: string; budget?: string | number | null; [k: string]: unknown }
interface DocRow     { status?: string; [k: string]: unknown }
interface PoRow      { status?: string; total_amount?: string | number | null; [k: string]: unknown }
interface ActionRow  { status?: string; [k: string]: unknown }

interface HubData {
  projects:  { rows: ProjectRow[]; state: TileState }
  docs:      { rows: DocRow[];     state: TileState }
  pos:       { rows: PoRow[];      state: TileState }
  actions:   { rows: ActionRow[];  state: TileState }
}

const PENDING: HubData = {
  projects: { rows: [], state: 'loading' },
  docs:     { rows: [], state: 'loading' },
  pos:      { rows: [], state: 'loading' },
  actions:  { rows: [], state: 'loading' },
}
const IDLE: HubData = {
  projects: { rows: [], state: 'ok' },
  docs:     { rows: [], state: 'ok' },
  pos:      { rows: [], state: 'ok' },
  actions:  { rows: [], state: 'ok' },
}

/**
 * Fetch one tile's collection. Each tile degrades on its OWN — one domain the
 * caller may not read must not blank the other seven, so a refusal or a failure
 * resolves to `unavailable` rather than rejecting.
 */
async function tile<T>(url: string, pick: (body: unknown) => T[]): Promise<{ rows: T[]; state: TileState }> {
  try {
    const res = await fetch(url)
    if (!res.ok) return { rows: [], state: 'unavailable' }
    return { rows: pick(await res.json()), state: 'ok' }
  } catch {
    return { rows: [], state: 'unavailable' }
  }
}

const dataOf = <T,>(body: unknown): T[] => ((body as { data?: T[] })?.data ?? [])

function useHubData(enabled: boolean): HubData {
  const [data, setData] = useState<HubData>(enabled ? PENDING : IDLE)
  useEffect(() => {
    if (!enabled) return
    let live = true
    void (async () => {
      const [projects, docs, pos, actions] = await Promise.all([
        tile<ProjectRow>('/api/v1/projects?limit=200',        dataOf),
        tile<DocRow>('/api/v1/files/documents?limit=200',     dataOf),
        tile<PoRow>('/api/v1/purchase-orders?limit=200',      dataOf),
        tile<ActionRow>('/api/v1/actions?limit=200',          dataOf),
      ])
      if (!live) return
      setData({ projects, docs, pos, actions })
    })()
    return () => { live = false }
  }, [enabled])
  return data
}

/** What a tile prints when it has no number it can stand behind. */
const UNKNOWN: Record<Exclude<TileState, 'ok'>, string> = {
  'loading':        '…',
  'unavailable':    '—',
  'project-scoped': '—',
  'no-backend':     '—',
}
const WHY: Record<Exclude<TileState, 'ok' | 'loading'>, string> = {
  'unavailable':    'unavailable',
  'project-scoped': 'pick a project',
  'no-backend':     'not connected',
}
const show = (state: TileState, value: string): string => state === 'ok' ? value : UNKNOWN[state]
const why  = (state: TileState, sub: string): string =>
  state === 'ok' ? sub : state === 'loading' ? 'loading…' : WHY[state]

export function HubView({ policy: _p, onNavigate }: HubViewProps) {
  const contracts  = useBizStore(selectContracts)
  const leads      = useBizStore(selectLeads)
  const docs       = useBizStore(selectDocuments)
  const incidents  = useBizStore(selectIncidents) as Record<string,unknown>[]
  const actions    = useBizStore(selectActionItems)
  const punch      = useBizStore(selectPunchItems)
  const pos        = useBizStore(s => s.biz.purchase_orders ?? [])
  const rfqs       = useBizStore(s => s.biz.rfqs ?? [])
  const invoices   = useBizStore(s => s.biz.invoices ?? [])
  const evmPjs     = useBizStore(s => s.biz.evm_projects ?? [])

  // Store wins when anything was dispatched into it — the precedence the other
  // repaired registers use. Only the routed, nothing-dispatched case fetches.
  const anyStored = contracts.length + leads.length + docs.length + incidents.length +
                    actions.length + punch.length + pos.length + rfqs.length +
                    invoices.length + evmPjs.length > 0
  const live = !anyStored
  const api  = useHubData(live)

  const activeContracts  = contracts.filter(c => ['active','in-progress'].includes(String(c['status'] ?? '')))
  const openIncidents    = incidents.filter(i => i['status'] !== 'closed')
  const openActions      = actions.filter(a => a['status'] !== 'closed' && a['status'] !== 'complete')
  const portfolioValue   = contracts.reduce((s, c) => s + Number(c['value'] ?? 0), 0)
  const outstanding      = invoices.filter(i => i['status'] !== 'paid')
  const outstandingValue = outstanding.reduce((s, i) => s + Number(i['amount'] ?? 0), 0)
  const avgCPI           = evmPjs.length ? evmPjs.reduce((s, e) => s + e.cpi, 0) / evmPjs.length : null

  // ── Live equivalents, in the API's own vocabulary ──
  // project_status (002_epc_core): planning|active|on_hold|completed|cancelled.
  // `active` is the one that means work is under way.
  const apiActiveProjects = api.projects.rows.filter(p => p.status === 'active')
  const apiPortfolio      = api.projects.rows.reduce((t, p) => t + Number(p.budget ?? 0), 0)
  // file_status: a document that is still `uploading` is not yet a document.
  const apiDocs           = api.docs.rows.filter(d => d.status !== 'deleted')
  const apiActiveDocs     = apiDocs.filter(d => d.status === 'active')
  const apiOpenPos        = api.pos.rows.filter(p => !['cancelled','closed'].includes(String(p.status ?? '')))
  const apiPoValue        = api.pos.rows.reduce((t, p) => t + Number(p.total_amount ?? 0), 0)
  // migration 029: open|in_progress|completed|cancelled — the first two are live work.
  const apiOpenActions    = api.actions.rows.filter(a => ['open','in_progress'].includes(String(a.status ?? '')))

  // Per-tile state: the store's own rows are always `ok` (they are real for this
  // session); otherwise the tile is only as good as its backend.
  const st = (stored: number, liveState: TileState, absent: TileState = 'no-backend'): TileState =>
    stored > 0 ? 'ok' : live ? liveState : absent

  /** Whichever action list is authoritative right now. */
  const liveOpenActions = (live ? apiOpenActions : openActions) as Record<string, unknown>[]

  // A tile only raises an alert on a number it actually knows. An unavailable
  // domain must never render the red bar — a hub that cries wolf about data it
  // could not read is worse than one that admits it could not read it.
  const projectsState = st(contracts.length, api.projects.state)
  const docsState     = st(docs.length,      api.docs.state)
  const poState       = st(pos.length,       api.pos.state)
  const actionsState  = st(actions.length,   api.actions.state)
  const safetyState   = st(incidents.length, 'project-scoped', 'project-scoped')
  const evmState      = st(evmPjs.length,    'project-scoped', 'project-scoped')
  const crmState      = st(leads.length,     'no-backend')
  const financeState  = st(invoices.length,  'no-backend')

  const domains: { icon: string; label: string; stat: string; value: string; tab: string; alert: boolean }[] = [
    { icon: '🏗️', label: 'Projects',
      stat:  show(projectsState, `${(live ? apiActiveProjects : activeContracts).length} active`),
      value: why(projectsState, fmt(live ? apiPortfolio : portfolioValue)),
      tab: 'projects', alert: false },
    { icon: '🎯', label: 'CRM',
      stat:  show(crmState, `${leads.filter(l => l['status'] !== 'won' && l['status'] !== 'lost').length} leads`),
      value: why(crmState, `${leads.length} total`),
      tab: 'crm', alert: false },
    { icon: '📄', label: 'Documents',
      stat:  show(docsState, `${(live ? apiDocs : docs).length} docs`),
      value: why(docsState, live ? `${apiActiveDocs.length} active` : `${docs.filter(d => d['cde'] === 'issued').length} issued`),
      tab: 'documents', alert: false },
    { icon: '🛒', label: 'Procurement',
      stat:  show(poState, `${(live ? apiOpenPos : pos).length} POs`),
      // RFQs have no table at all, so the sub-line carries PO value instead of
      // an RFQ count that could only ever be zero.
      value: why(poState, live ? fmt(apiPoValue) : `${rfqs.filter(r => r['status'] === 'open').length} open RFQs`),
      tab: 'procurement', alert: false },
    { icon: '🦺', label: 'Safety',
      stat:  show(safetyState, `${openIncidents.length} open`),
      value: why(safetyState, 'incidents'),
      tab: 'safety', alert: safetyState === 'ok' && openIncidents.length > 0 },
    { icon: '💰', label: 'Finance',
      stat:  show(financeState, fmt(outstandingValue)),
      value: why(financeState, 'outstanding'),
      tab: 'finance', alert: financeState === 'ok' && outstanding.length > 0 },
    { icon: '✅', label: 'Actions',
      stat:  show(actionsState, `${(live ? apiOpenActions : openActions).length} open`),
      value: why(actionsState, live ? 'open + in progress' : `${punch.length} punch`),
      tab: 'actions',
      alert: actionsState === 'ok' && (live ? apiOpenActions.length : openActions.length) > 5 },
    { icon: '📊', label: 'EVM',
      stat:  show(evmState, avgCPI != null ? `CPI ${avgCPI.toFixed(2)}` : 'No data'),
      value: why(evmState, `${evmPjs.length} projects`),
      tab: 'projects', alert: evmState === 'ok' && avgCPI != null && avgCPI < 0.9 },
  ]

  return (
    <div role="main" aria-label="Project Hub">
      <h3 className="jarvis-heading" style={{ marginBottom: 4 }}>Project Hub</h3>
      <p className="jarvis-muted" style={{ marginBottom: 20, fontSize: 12 }}>Cross-domain project status at a glance</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 24 }}>
        {domains.map(d => (
          <div key={d.label} className="jarvis-card" onClick={() => onNavigate?.(d.tab)} style={{ padding: 16, cursor: 'pointer', borderLeft: d.alert ? '3px solid var(--jarvis-red)' : '3px solid var(--jarvis-bd)', transition: 'border-color 0.15s' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <span style={{ fontSize: 20 }}>{d.icon}</span>
              {d.alert && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--jarvis-red)', marginTop: 4 }} />}
            </div>
            <div className="jarvis-body" style={{ fontWeight: 700, fontSize: 14 }}>{d.label}</div>
            <div style={{ fontWeight: 700, color: 'var(--jarvis-ac)', fontSize: 16, marginTop: 2 }}>{d.stat}</div>
            <div className="jarvis-muted" style={{ fontSize: 11, marginTop: 2 }}>{d.value}</div>
          </div>
        ))}
      </div>

      {/* Recent activity snapshot */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="jarvis-card" style={{ padding: 16 }}>
          <h4 className="jarvis-label" style={{ marginBottom: 10 }}>Open Actions</h4>
          {/* "All clear" is a claim. It is only true if we actually read the
              actions; otherwise say the list could not be loaded. */}
          {actionsState !== 'ok' ? <p className="jarvis-muted" style={{ fontStyle: 'italic' }}>{why(actionsState, '')}</p> :
           liveOpenActions.length === 0 ? <p className="jarvis-muted" style={{ fontStyle: 'italic' }}>All clear ✅</p> :
            liveOpenActions.slice(0, 4).map(a => (
              <div key={String(a['id'])} className="jarvis-row">
                <span className="jarvis-flex-1 jarvis-body" style={{ fontSize: 12, fontWeight: 600 }}>{String(a['subject'] ?? a['title'] ?? a['description'] ?? a['id'])}</span>
                <StatusBadge status={String(a['status'] ?? 'open')} />
              </div>
            ))}
        </div>
        <div className="jarvis-card" style={{ padding: 16 }}>
          <h4 className="jarvis-label" style={{ marginBottom: 10 }}>{live ? 'Active Projects' : 'Active Contracts'}</h4>
          {/* `contracts` has a table but no route, so with an empty store this
              panel cannot know — "No active contracts" would be a claim. */}
          {projectsState !== 'ok' ? <p className="jarvis-muted" style={{ fontStyle: 'italic' }}>{why(projectsState, '')}</p> :
           activeContracts.length === 0 && !live ? <p className="jarvis-muted" style={{ fontStyle: 'italic' }}>No active contracts</p> :
            (live ? apiActiveProjects.slice(0, 4).map(p => ({
              id: p['id'], project: p['name'] ?? p['code'], progress: p['progress_pct'], status: p['status'],
            })) as Record<string, unknown>[] : activeContracts).slice(0, 4).map(c => (
              <div key={String(c['id'])} className="jarvis-row">
                <div className="jarvis-flex-1">
                  <span className="jarvis-body" style={{ fontSize: 12, fontWeight: 600 }}>{String(c['project'] ?? c['id'])}</span>
                  <span className="jarvis-small" style={{ display: 'block' }}>{Number(c['progress'] ?? 0)}% complete</span>
                </div>
                <StatusBadge status={String(c['status'] ?? 'active')} />
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}
export default HubView
