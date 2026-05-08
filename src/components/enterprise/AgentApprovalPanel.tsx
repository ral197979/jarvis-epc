// Denver Engineering — AgentApprovalPanel (v5.0.0)
// Human-in-the-loop approval UI for agent-requested actions.

import React, { useState } from 'react'

interface AgentApproval {
  id: string
  taskId: string
  agentType: string
  actionType: string
  description: string
  payload: Record<string, unknown>
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  status: 'pending' | 'approved' | 'rejected' | 'expired'
  requestedBy: string
  expiresAt: string
  createdAt: string
}

interface Props {
  approvals: AgentApproval[]
  currentUserId: string
  tenantId: string
  onReviewed?: (approvalId: string, decision: 'approved' | 'rejected') => void
}

const RISK_CONFIG = {
  critical: { bg: '#fef2f2', border: '#fca5a5', badge: '#ef4444', label: '🔴 Critical' },
  high:     { bg: '#fff7ed', border: '#fed7aa', badge: '#f97316', label: '🟠 High' },
  medium:   { bg: '#fffbeb', border: '#fde68a', badge: '#f59e0b', label: '🟡 Medium' },
  low:      { bg: '#f0fdf4', border: '#86efac', badge: '#22c55e', label: '🟢 Low' },
}

function ApprovalCard({
  approval,
  currentUserId,
  tenantId,
  onReviewed,
}: {
  approval: AgentApproval
  currentUserId: string
  tenantId: string
  onReviewed?: (id: string, decision: 'approved' | 'rejected') => void
}) {
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const config = RISK_CONFIG[approval.riskLevel]
  const isExpired = new Date(approval.expiresAt) < new Date()

  async function submitReview(decision: 'approved' | 'rejected') {
    setLoading(true)
    try {
      const endpoint = decision === 'approved'
        ? `/api/v1/agents/approvals/${approval.id}/approve`
        : `/api/v1/agents/approvals/${approval.id}/reject`
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, reviewedBy: currentUserId, notes }),
      })
      onReviewed?.(approval.id, decision)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      border: `1px solid ${config.border}`,
      background: config.bg,
      borderRadius: '10px', padding: '16px',
      opacity: isExpired ? 0.6 : 1,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '15px' }}>{approval.description}</div>
          <div style={{ color: '#6b7280', fontSize: '13px', marginTop: '2px' }}>
            {approval.agentType} · {approval.actionType}
          </div>
        </div>
        <span style={{
          padding: '3px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 600,
          background: `${config.badge}20`, color: config.badge,
        }}>
          {config.label}
        </span>
      </div>

      {/* Expiry warning */}
      {isExpired ? (
        <div style={{ color: '#9ca3af', fontSize: '12px', marginBottom: '10px' }}>Expired</div>
      ) : (
        <div style={{ color: '#6b7280', fontSize: '12px', marginBottom: '10px' }}>
          Expires: {new Date(approval.expiresAt).toLocaleString()}
        </div>
      )}

      {/* Payload preview */}
      <button
        onClick={() => setExpanded(!expanded)}
        style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', fontSize: '13px', padding: 0, marginBottom: '10px' }}
      >
        {expanded ? '▲ Hide' : '▶ Show'} payload
      </button>
      {expanded && (
        <pre style={{
          background: 'rgba(0,0,0,0.04)', padding: '10px', borderRadius: '6px',
          fontSize: '12px', overflow: 'auto', marginBottom: '12px',
        }}>
          {JSON.stringify(approval.payload, null, 2)}
        </pre>
      )}

      {/* Review notes */}
      {!isExpired && approval.status === 'pending' && (
        <>
          <textarea
            placeholder="Review notes (optional)…"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            style={{
              width: '100%', padding: '8px', border: '1px solid #d1d5db',
              borderRadius: '6px', fontSize: '13px', resize: 'vertical',
              boxSizing: 'border-box', marginBottom: '10px',
            }}
          />

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => void submitReview('approved')}
              disabled={loading}
              style={{
                flex: 1, padding: '8px', background: '#22c55e', color: '#fff',
                border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '14px',
              }}
            >
              ✓ Approve
            </button>
            <button
              onClick={() => void submitReview('rejected')}
              disabled={loading}
              style={{
                flex: 1, padding: '8px', background: '#ef4444', color: '#fff',
                border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '14px',
              }}
            >
              ✗ Reject
            </button>
          </div>
        </>
      )}

      {approval.status !== 'pending' && (
        <div style={{
          padding: '8px', borderRadius: '6px', textAlign: 'center', fontWeight: 600, fontSize: '14px',
          background: approval.status === 'approved' ? '#dcfce7' : '#fee2e2',
          color: approval.status === 'approved' ? '#16a34a' : '#dc2626',
        }}>
          {approval.status === 'approved' ? '✓ Approved' : '✗ Rejected'}
        </div>
      )}
    </div>
  )
}

export function AgentApprovalPanel({ approvals, currentUserId, tenantId, onReviewed }: Props) {
  const pending = approvals.filter(a => a.status === 'pending' && new Date(a.expiresAt) > new Date())
  const reviewed = approvals.filter(a => a.status !== 'pending')

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>
          Agent Approval Queue
        </h3>
        {pending.length > 0 && (
          <span style={{
            padding: '3px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 700,
            background: '#fef2f2', color: '#ef4444',
          }}>
            {pending.length} pending
          </span>
        )}
      </div>

      {pending.length === 0 && (
        <div style={{ padding: '32px', textAlign: 'center', color: '#9ca3af', fontSize: '14px' }}>
          No pending approvals
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {pending.map(a => (
          <ApprovalCard
            key={a.id}
            approval={a}
            currentUserId={currentUserId}
            tenantId={tenantId}
            onReviewed={onReviewed}
          />
        ))}
      </div>

      {reviewed.length > 0 && (
        <>
          <h4 style={{ margin: '24px 0 12px', fontSize: '14px', fontWeight: 600, color: '#6b7280' }}>
            Recently Reviewed
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {reviewed.slice(0, 5).map(a => (
              <ApprovalCard
                key={a.id}
                approval={a}
                currentUserId={currentUserId}
                tenantId={tenantId}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
