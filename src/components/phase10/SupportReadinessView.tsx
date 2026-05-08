// Denver Engineering — Support Readiness View (v10.0.0)
// Validates that support infrastructure is ready for enterprise launch.

import React, { useState, useEffect } from 'react'

interface SupportReadinessItem {
  id: string
  category: string
  title: string
  description: string
  status: 'ready' | 'partial' | 'not_ready'
  owner?: string
  notes?: string
}

interface SupportMetrics {
  openTickets: number
  criticalOpen: number
  avgResolutionHours: number
  slaBreachCount: number
  activeEscalations: number
}

interface SupportReadinessViewProps {
  environment?: string
  onItemUpdate?: (itemId: string, status: SupportReadinessItem['status'], notes: string) => void
}

const DEFAULT_ITEMS: SupportReadinessItem[] = [
  {
    id: 'runbook',
    category: 'Documentation',
    title: 'Incident Response Runbook',
    description: 'Runbook covers all P0/P1 scenario categories with escalation paths.',
    status: 'not_ready',
  },
  {
    id: 'on-call',
    category: 'Staffing',
    title: 'On-Call Rotation',
    description: 'Minimum 2-person on-call coverage with 15-min response SLA.',
    status: 'not_ready',
  },
  {
    id: 'diagnostic-tools',
    category: 'Tooling',
    title: 'Diagnostic Tooling',
    description: 'TenantDiagnosticsPanel and ReplayIncidentViewer deployed and accessible.',
    status: 'not_ready',
  },
  {
    id: 'escalation-contacts',
    category: 'Contacts',
    title: 'Escalation Contacts',
    description: 'Engineering escalation contacts registered for all enterprise tenants.',
    status: 'not_ready',
  },
  {
    id: 'sla-agreements',
    category: 'Contracts',
    title: 'SLA Agreements Signed',
    description: 'Customer SLA agreements executed and filed.',
    status: 'not_ready',
  },
  {
    id: 'pagerduty',
    category: 'Tooling',
    title: 'PagerDuty Integration',
    description: 'Alert routing to PagerDuty active for P0/P1 incidents.',
    status: 'not_ready',
  },
]

const STATUS_CONFIG = {
  ready: { label: 'Ready', color: 'text-green-700', bg: 'bg-green-100', icon: '✓' },
  partial: { label: 'Partial', color: 'text-yellow-700', bg: 'bg-yellow-100', icon: '~' },
  not_ready: { label: 'Not Ready', color: 'text-red-700', bg: 'bg-red-100', icon: '✗' },
}

export function SupportReadinessView({ environment = 'production', onItemUpdate }: SupportReadinessViewProps) {
  const [items, setItems] = useState<SupportReadinessItem[]>(DEFAULT_ITEMS)
  const [metrics, setMetrics] = useState<SupportMetrics | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editNotes, setEditNotes] = useState('')
  const [editStatus, setEditStatus] = useState<SupportReadinessItem['status']>('not_ready')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [itemsRes, metricsRes] = await Promise.all([
          fetch(`/api/phase10/support/readiness?environment=${environment}`),
          fetch(`/api/phase10/support/metrics?environment=${environment}`),
        ])
        if (itemsRes.ok) setItems(await itemsRes.json())
        if (metricsRes.ok) setMetrics(await metricsRes.json())
      } finally {
        setLoading(false)
      }
    }
    void fetchData()
  }, [environment])

  const handleSaveEdit = async (itemId: string) => {
    try {
      await fetch(`/api/phase10/support/readiness/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: editStatus, notes: editNotes }),
      })
      setItems(prev => prev.map(i =>
        i.id === itemId ? { ...i, status: editStatus, notes: editNotes } : i
      ))
      onItemUpdate?.(itemId, editStatus, editNotes)
    } finally {
      setEditingId(null)
    }
  }

  const readyCount = items.filter(i => i.status === 'ready').length
  const isFullyReady = readyCount === items.length
  const categories = [...new Set(items.map(i => i.category))]

  return (
    <div className="support-readiness-view p-6 bg-white rounded-lg shadow">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Support Readiness</h2>
          <p className="text-sm text-gray-500">
            {readyCount}/{items.length} items ready
            {isFullyReady && <span className="text-green-600 font-medium ml-2">✓ Launch Ready</span>}
          </p>
        </div>
      </div>

      {metrics && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          {[
            { label: 'Open Tickets', value: metrics.openTickets, alert: metrics.openTickets > 10 },
            { label: 'Critical Open', value: metrics.criticalOpen, alert: metrics.criticalOpen > 0 },
            { label: 'Avg Resolution', value: `${metrics.avgResolutionHours}h`, alert: metrics.avgResolutionHours > 24 },
            { label: 'SLA Breaches', value: metrics.slaBreachCount, alert: metrics.slaBreachCount > 0 },
            { label: 'Escalations', value: metrics.activeEscalations, alert: metrics.activeEscalations > 0 },
          ].map(m => (
            <div key={m.label} className={`p-3 rounded-lg text-center ${m.alert ? 'bg-red-50' : 'bg-gray-50'}`}>
              <div className={`text-xl font-bold ${m.alert ? 'text-red-600' : 'text-gray-800'}`}>{m.value}</div>
              <div className="text-xs text-gray-500">{m.label}</div>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="text-center py-6 text-gray-400">Loading readiness items...</div>
      ) : (
        categories.map(category => (
          <div key={category} className="mb-5">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">{category}</h3>
            <div className="space-y-2">
              {items.filter(i => i.category === category).map(item => {
                const cfg = STATUS_CONFIG[item.status]
                return (
                  <div key={item.id} className="border rounded-lg p-3">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.color}`}>
                            {cfg.icon} {cfg.label}
                          </span>
                          <span className="font-medium text-gray-800 text-sm">{item.title}</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">{item.description}</p>
                        {item.notes && (
                          <p className="text-xs text-gray-600 italic mt-1">Note: {item.notes}</p>
                        )}
                      </div>
                      <button
                        className="ml-3 text-xs text-blue-600 hover:underline whitespace-nowrap"
                        onClick={() => {
                          setEditingId(item.id)
                          setEditStatus(item.status)
                          setEditNotes(item.notes ?? '')
                        }}
                      >
                        Update
                      </button>
                    </div>

                    {editingId === item.id && (
                      <div className="mt-3 pt-3 border-t flex gap-2">
                        <select
                          className="border rounded px-2 py-1 text-sm"
                          value={editStatus}
                          onChange={e => setEditStatus(e.target.value as SupportReadinessItem['status'])}
                        >
                          <option value="ready">Ready</option>
                          <option value="partial">Partial</option>
                          <option value="not_ready">Not Ready</option>
                        </select>
                        <input
                          className="flex-1 border rounded px-2 py-1 text-sm"
                          placeholder="Notes..."
                          value={editNotes}
                          onChange={e => setEditNotes(e.target.value)}
                        />
                        <button
                          className="px-3 py-1 bg-blue-600 text-white text-sm rounded"
                          onClick={() => void handleSaveEdit(item.id)}
                        >
                          Save
                        </button>
                        <button
                          className="px-3 py-1 text-gray-500 text-sm"
                          onClick={() => setEditingId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))
      )}
    </div>
  )
}

export default SupportReadinessView
