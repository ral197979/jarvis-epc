// Denver Engineering — Support Escalation Queue (v8.0.0)
// Lists open tickets with SLA status, priority badges, and quick escalation actions.

import React, { useEffect, useState } from 'react'
import { SupportTicket } from '../../../api/services/enterprise/enterpriseTypes'

interface Props {
  tenantId: string
  onEscalate?: (ticketId: string) => void
}

const PRIORITY_COLOR: Record<string, string> = {
  critical: 'bg-red-500 text-white',
  high: 'bg-orange-500 text-white',
  medium: 'bg-yellow-500 text-black',
  low: 'bg-gray-600 text-white',
}

const STATUS_COLOR: Record<string, string> = {
  open: 'text-blue-400',
  in_progress: 'text-yellow-400',
  waiting_customer: 'text-purple-400',
  resolved: 'text-green-400',
  closed: 'text-gray-500',
}

function isSlaBreached(ticket: SupportTicket): boolean {
  if (!ticket.slaDeadline) return false
  return new Date(ticket.slaDeadline) < new Date() && !['resolved', 'closed'].includes(ticket.status)
}

function formatDeadline(deadline: Date | undefined): string {
  if (!deadline) return '—'
  const d = new Date(deadline)
  const now = new Date()
  const diff = d.getTime() - now.getTime()
  if (diff < 0) return 'OVERDUE'
  const hours = Math.floor(diff / 3_600_000)
  if (hours < 24) return `${hours}h left`
  return `${Math.floor(hours / 24)}d left`
}

export function SupportEscalationQueue({ tenantId, onEscalate }: Props) {
  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [loading, setLoading] = useState(true)
  const [escalating, setEscalating] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/v1/enterprise/tickets?status=open', {
      headers: { 'X-Tenant-ID': tenantId },
    })
      .then(r => r.json())
      .then((data: SupportTicket[]) => { setTickets(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [tenantId])

  async function handleEscalate(ticket: SupportTicket) {
    setEscalating(ticket.id)
    try {
      await fetch(`/api/v1/enterprise/tickets/${ticket.id}/escalate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenantId },
        body: JSON.stringify({ reason: 'Manual escalation from queue' }),
      })
      onEscalate?.(ticket.id)
      setTickets(prev => prev.filter(t => t.id !== ticket.id))
    } finally {
      setEscalating(null)
    }
  }

  if (loading) return <div className="p-4 text-gray-400 animate-pulse">Loading tickets…</div>

  const breached = tickets.filter(isSlaBreached)
  const normal = tickets.filter(t => !isSlaBreached(t))

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-white font-semibold">Support Queue</h2>
        <span className="text-xs text-gray-400">{tickets.length} open</span>
      </div>

      {breached.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-red-400 uppercase tracking-wide">SLA Breached</p>
          {breached.map(t => <TicketRow key={t.id} ticket={t} onEscalate={handleEscalate} escalating={escalating} />)}
        </div>
      )}

      {normal.length > 0 && (
        <div className="space-y-2">
          {breached.length > 0 && <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Active</p>}
          {normal.map(t => <TicketRow key={t.id} ticket={t} onEscalate={handleEscalate} escalating={escalating} />)}
        </div>
      )}

      {tickets.length === 0 && (
        <p className="text-center text-gray-500 py-4">No open tickets</p>
      )}
    </div>
  )
}

function TicketRow({
  ticket,
  onEscalate,
  escalating,
}: {
  ticket: SupportTicket
  onEscalate: (t: SupportTicket) => void
  escalating: string | null
}) {
  const breached = isSlaBreached(ticket)
  return (
    <div className={`flex items-start gap-3 p-3 rounded-md ${breached ? 'bg-red-950/30 border border-red-800/30' : 'bg-gray-800'}`}>
      <span className={`mt-0.5 text-xs px-2 py-0.5 rounded font-semibold ${PRIORITY_COLOR[ticket.priority]}`}>
        {ticket.priority}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white truncate">{ticket.title}</p>
        <div className="flex gap-3 mt-0.5">
          <span className={`text-xs ${STATUS_COLOR[ticket.status]}`}>{ticket.status.replace('_', ' ')}</span>
          <span className={`text-xs ${breached ? 'text-red-400 font-semibold' : 'text-gray-500'}`}>
            {formatDeadline(ticket.slaDeadline)}
          </span>
        </div>
      </div>
      {ticket.priority !== 'critical' && (
        <button
          onClick={() => onEscalate(ticket)}
          disabled={escalating === ticket.id}
          className="text-xs text-orange-400 hover:text-orange-300 disabled:opacity-50 whitespace-nowrap"
        >
          {escalating === ticket.id ? 'Escalating…' : '↑ Escalate'}
        </button>
      )}
    </div>
  )
}

export default SupportEscalationQueue
