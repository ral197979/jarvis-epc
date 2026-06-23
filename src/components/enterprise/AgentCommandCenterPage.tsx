// Denver Engineering — AgentCommandCenterPage (v5.0.0)
// Hub for monitoring and controlling all multi-agent operations.

import React, { useState, useEffect } from 'react'

interface AgentTask {
  id: string
  agentType: string
  taskType: string
  priority: number
  status: string
  createdAt: string
}

interface AgentExecution {
  id: string
  agentType: string
  status: string
  startedAt: string
  durationMs?: number
}

interface AgentApproval {
  id: string
  agentType: string
  actionType: string
  description: string
  riskLevel: string
  status: string
  expiresAt: string
}

interface Props {
  tenantId: string
}

export function AgentCommandCenterPage({ tenantId }: Props) {
  const [tasks, setTasks] = useState<AgentTask[]>([])
  const [executions, setExecutions] = useState<AgentExecution[]>([])
  const [approvals, setApprovals] = useState<AgentApproval[]>([])
  const [activeTab, setActiveTab] = useState<'tasks' | 'executions' | 'approvals'>('tasks')
  const [loading, setLoading] = useState(false)
  const [objective, setObjective] = useState('')
  const [scope, setScope] = useState('project')
  const [scopeId, setScopeId] = useState('')

  useEffect(() => {
    void loadData()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, tenantId])

  async function loadData() {
    setLoading(true)
    try {
      if (activeTab === 'tasks') {
        const res = await fetch(`/api/v1/agents/tasks?tenantId=${tenantId}&limit=50`)
        const data = await res.json() as { tasks: AgentTask[] }
        setTasks(data.tasks ?? [])
      } else if (activeTab === 'executions') {
        const res = await fetch(`/api/v1/agents/executions?tenantId=${tenantId}&limit=50`)
        const data = await res.json() as { executions: AgentExecution[] }
        setExecutions(data.executions ?? [])
      } else {
        const res = await fetch(`/api/v1/agents/approvals?tenantId=${tenantId}`)
        const data = await res.json() as { approvals: AgentApproval[] }
        setApprovals(data.approvals ?? [])
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleExecute() {
    if (!objective || !scopeId) return
    await fetch('/api/v1/agents/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, objective, scope, scopeId, requestedBy: 'user' }),
    })
    await loadData()
  }

  const statusColor = (status: string) => {
    if (status === 'completed') return '#22c55e'
    if (status === 'failed') return '#ef4444'
    if (status === 'running') return '#3b82f6'
    if (status === 'pending_approval') return '#f59e0b'
    return '#6b7280'
  }

  const riskColor = (level: string) => {
    if (level === 'critical') return '#ef4444'
    if (level === 'high') return '#f97316'
    if (level === 'medium') return '#f59e0b'
    return '#22c55e'
  }

  return (
    <div style={{ padding: '24px', fontFamily: 'system-ui, sans-serif', maxWidth: '1200px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 700 }}>Agent Command Center</h1>
          <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: '14px' }}>
            Multi-Agent Operational Intelligence — Ava v5.0.0
          </p>
        </div>
        <div style={{
          padding: '6px 14px', background: '#f0fdf4', border: '1px solid #86efac',
          borderRadius: '20px', color: '#16a34a', fontSize: '13px', fontWeight: 500,
        }}>
          ● 8 agents registered
        </div>
      </div>

      {/* Objective launcher */}
      <div style={{
        background: '#f8fafc', border: '1px solid #e2e8f0',
        borderRadius: '10px', padding: '20px', marginBottom: '24px',
      }}>
        <h3 style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 600 }}>
          Launch Objective
        </h3>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <select
            value={objective}
            onChange={e => setObjective(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', flex: 1, minWidth: '200px' }}
          >
            <option value="">Select objective…</option>
            <option value="assess_readiness">Assess Readiness</option>
            <option value="incident_response">Incident Response</option>
            <option value="optimize_operations">Optimize Operations</option>
            <option value="validate_and_document">Validate & Document</option>
          </select>
          <select
            value={scope}
            onChange={e => setScope(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', minWidth: '140px' }}
          >
            <option value="project">Project</option>
            <option value="workflow">Workflow</option>
            <option value="action">Action</option>
          </select>
          <input
            type="text"
            placeholder="Scope ID (UUID)"
            value={scopeId}
            onChange={e => setScopeId(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', flex: 1, minWidth: '200px' }}
          />
          <button
            onClick={() => void handleExecute()}
            disabled={!objective || !scopeId}
            style={{
              padding: '8px 20px', background: '#3b82f6', color: '#fff',
              border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 500,
            }}
          >
            Execute
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', borderBottom: '1px solid #e2e8f0' }}>
        {(['tasks', 'executions', 'approvals'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '8px 16px', border: 'none', cursor: 'pointer',
              background: activeTab === tab ? '#3b82f6' : 'transparent',
              color: activeTab === tab ? '#fff' : '#374151',
              borderRadius: '6px 6px 0 0', fontWeight: activeTab === tab ? 600 : 400,
              textTransform: 'capitalize', fontSize: '14px',
            }}
          >
            {tab}
          </button>
        ))}
        <button
          onClick={() => void loadData()}
          style={{
            marginLeft: 'auto', padding: '6px 12px', border: '1px solid #d1d5db',
            background: '#fff', borderRadius: '6px', cursor: 'pointer', fontSize: '13px',
          }}
        >
          ↻ Refresh
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#6b7280' }}>Loading…</div>
      ) : (
        <>
          {/* Tasks tab */}
          {activeTab === 'tasks' && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  {['Agent', 'Task Type', 'Priority', 'Status', 'Created'].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#374151', borderBottom: '1px solid #e2e8f0' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tasks.map(t => (
                  <tr key={t.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '10px 12px' }}>{t.agentType}</td>
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: '13px' }}>{t.taskType}</td>
                    <td style={{ padding: '10px 12px' }}>{t.priority}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{
                        padding: '2px 8px', borderRadius: '12px', fontSize: '12px',
                        background: `${statusColor(t.status)}20`, color: statusColor(t.status), fontWeight: 500,
                      }}>{t.status}</span>
                    </td>
                    <td style={{ padding: '10px 12px', color: '#6b7280' }}>{new Date(t.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
                {tasks.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: '32px', textAlign: 'center', color: '#9ca3af' }}>No tasks found</td></tr>
                )}
              </tbody>
            </table>
          )}

          {/* Executions tab */}
          {activeTab === 'executions' && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  {['Agent', 'Status', 'Started', 'Duration'].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#374151', borderBottom: '1px solid #e2e8f0' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {executions.map(e => (
                  <tr key={e.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '10px 12px' }}>{e.agentType}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{
                        padding: '2px 8px', borderRadius: '12px', fontSize: '12px',
                        background: `${statusColor(e.status)}20`, color: statusColor(e.status), fontWeight: 500,
                      }}>{e.status}</span>
                    </td>
                    <td style={{ padding: '10px 12px', color: '#6b7280' }}>{new Date(e.startedAt).toLocaleString()}</td>
                    <td style={{ padding: '10px 12px' }}>{e.durationMs != null ? `${e.durationMs}ms` : '—'}</td>
                  </tr>
                ))}
                {executions.length === 0 && (
                  <tr><td colSpan={4} style={{ padding: '32px', textAlign: 'center', color: '#9ca3af' }}>No executions found</td></tr>
                )}
              </tbody>
            </table>
          )}

          {/* Approvals tab */}
          {activeTab === 'approvals' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {approvals.map(a => (
                <div key={a.id} style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '15px', marginBottom: '4px' }}>{a.description}</div>
                      <div style={{ color: '#6b7280', fontSize: '13px' }}>{a.agentType} · {a.actionType}</div>
                    </div>
                    <span style={{
                      padding: '3px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 600,
                      background: `${riskColor(a.riskLevel)}20`, color: riskColor(a.riskLevel),
                    }}>{a.riskLevel} risk</span>
                  </div>
                  <div style={{ marginTop: '12px', color: '#9ca3af', fontSize: '12px' }}>
                    Expires: {new Date(a.expiresAt).toLocaleString()}
                  </div>
                </div>
              ))}
              {approvals.length === 0 && (
                <div style={{ padding: '32px', textAlign: 'center', color: '#9ca3af' }}>No pending approvals</div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
