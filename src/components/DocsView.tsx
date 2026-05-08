/**
 * Denver Engineering — DocsView  ·  Documents Overview (wraps DocumentsView + transmittals summary)
 */
import React from 'react'
import { useBizStore, selectDocuments } from '../modules/biz/store'
import { KpiCard }        from './KpiCard'
import { DocumentsView }  from './DocumentsView'
import type { PolicyConfig } from '../modules/biz/dispatch'

export interface DocsViewProps { policy?: Partial<PolicyConfig>; onAudit?: (e: unknown) => void; onToast?: (msg: string, type: string) => void }

export function DocsView({ policy, onAudit, onToast }: DocsViewProps) {
  const docs         = useBizStore(selectDocuments)
  const transmittals = useBizStore(s => s.biz.transmittals ?? [])
  const issued = docs.filter(d => d['cde'] === 'issued' || d['status'] === 'issued').length
  const draft  = docs.filter(d => d['cde'] === 'draft'  || d['status'] === 'draft').length
  const rev    = [...new Set(docs.map(d => d['rev'] ?? d['revision']))].length

  const defPolicy: PolicyConfig = { writesEnabled: false, chatEnabled: false, exportsEnabled: false, activeRole: 'viewer', ...policy }

  return (
    <div role="main" aria-label="Documents Overview">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8, marginBottom: 20 }}>
        <KpiCard label="Total Documents" value={docs.length} />
        <KpiCard label="Issued"          value={issued}  color="var(--jarvis-grn)" />
        <KpiCard label="Draft"           value={draft}   color="var(--jarvis-amb)" />
        <KpiCard label="Revisions"       value={rev}     color="var(--jarvis-blue)" />
        <KpiCard label="Transmittals"    value={transmittals.length} color="var(--jarvis-pur)" />
      </div>
      <DocumentsView policy={defPolicy} onAudit={onAudit} onToast={onToast} />
    </div>
  )
}
export default DocsView
