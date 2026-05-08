// Denver Engineering — Support Operations Center (v10.0.0)
// Unified support queue: tickets, escalations, diagnostics, and SLA tracking.

import React, { useState, useEffect } from 'react'

interface SupportTicket {
  id: string
  tenantId: string
  subject: string
  priority: 'low' | 'medium' | 'high' | 'critical'
  status: 'open' | 'in_progress' | 'escalated' | 'resolved'
  reportedBy: string
  category: string
  createdAt: string
  resolvedAt: string | null
}

interface SupportOperationsCenterProps {
  onTicketSelect?: (ticket: SupportTicket) => void
}

const PRIORITY_STYLES: Record<string, string> = {
  critical: 'bg-red-100 text-red-700',
  high: 'bg-orange-100 text-orange-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low: 'bg-gray-100 text-gray-600',
}

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-indigo-100 text-indigo-700',
  escalated: 'bg-red-100 text-red-700',
  resolved: 'bg-green-100 text-green-700',
}

export function SupportOperationsCenter({ onTicketSelect }: SupportOperationsCenterProps) {
  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [statusFilter, setStatusFilter] = useState<string>('open')
  const [priorityFilter, setPriorityFilter] = useState<string>('all')
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    const fetchTickets = async () => {
      try {
        const params = new URLSearchParams({ limit: '100' })
        if (statusFilter !== 'all') params.set('status', statusFilter)
        const res = await fetch(`/api/phase10/support/tickets?${params}`)
        if (res.ok) setTickets(await res.json())
      } finally {
        setLoading(false)
      }
    }
    void fetchTickets()
  }, [statusFilter])

  const filtered = tickets.filter(t => {
    if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false
    if (search && !t.subject.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const criticalOpen = tickets.filter(t => t.priority === 'critical' && t.status !== 'resolved').length

  return (
    <div className="support-operations-center p-6 bg-white rounded-lg shadow">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Support Operations</h2>
          {criticalOpen > 0 && (
            <span className="text-sm text-red-600 font-medium">
              ⚠ {criticalOpen} critical ticket(s) open
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <input
          className="border rounded px-3 py-1.5 text-sm flex-1 min-w-48"
          placeholder="Search tickets..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select
          className="border rounded px-3 py-1.5 text-sm"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
        >
          <option value="all">All Statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="escalated">Escalated</option>
          <option value="resolved">Resolved</option>
        </select>
        <select
          className="border rounded px-3 py-1.5 text-sm"
          value={priorityFilter}
          onChange={e => setPriorityFilter(e.target.value)}
        >
          <option value="all">All Priorities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>

      {loading ? (
        <div className="text-gray-400 text-center py-8">Loading tickets...</div>
      ) : filtered.length === 0 ? (
        <div className="text-gray-400 text-center py-8">No tickets found.</div>
      ) : (
        <div className="space-y-2">
          {filtered.map(ticket => (
            <button
              key={ticket.id}
              className="w-full text-left p-3 border rounded-lg hover:bg-gray-50 transition-colors"
              onClick={() => onTicketSelect?.(ticket)}
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_STYLES[ticket.priority]}`}>
                      {ticket.priority}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLES[ticket.status]}`}>
                      {ticket.status.replace('_', ' ')}
                    </span>
                    <span className="text-xs text-gray-400">{ticket.category}</span>
                  </div>
                  <div className="font-medium text-gray-800 mt-1">{ticket.subject}</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {ticket.tenantId} · {ticket.reportedBy} · {new Date(ticket.createdAt).toLocaleDateString()}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default SupportOperationsCenter
