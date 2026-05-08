// Denver Engineering — Customer Go-Live Dashboard (Phase 11)
// Track milestones, checklist completion, and activation readiness per customer

import React, { useEffect, useState, useCallback } from 'react'

interface GoLiveChecklistItem {
  id: string
  checkKey: string
  title: string
  required: boolean
  completed: boolean
  completedAt: string | null
  completedBy: string | null
}

interface GoLiveMilestone {
  id: string
  milestoneKey: string
  milestoneName: string
  achievedAt: string | null
  expectedByDate: string | null
  notes: string | null
}

interface CustomerGoLiveDashboardProps {
  tenantId: string
  tenantName: string
  onGoLive?: (tenantId: string) => void
}

export function CustomerGoLiveDashboard({ tenantId, tenantName, onGoLive }: CustomerGoLiveDashboardProps) {
  const [checklist, setChecklist] = useState<GoLiveChecklistItem[]>([])
  const [milestones, setMilestones] = useState<GoLiveMilestone[]>([])
  const [loading, setLoading] = useState(true)
  const [completing, setCompleting] = useState<string | null>(null)
  const [completedBy, setCompletedBy] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [checkRes, msRes] = await Promise.all([
        fetch(`/api/phase11/tenants/${tenantId}/checklist`),
        fetch(`/api/phase11/tenants/${tenantId}/milestones`),
      ])
      const [checkData, msData] = await Promise.all([checkRes.json(), msRes.json()])
      setChecklist(checkData.items ?? [])
      setMilestones(msData.milestones ?? [])
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  useEffect(() => { fetchData() }, [fetchData])

  const completeItem = async (itemId: string) => {
    if (!completedBy.trim()) return
    await fetch(`/api/phase11/checklist/${itemId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completedBy }),
    })
    setCompleting(null)
    setCompletedBy('')
    fetchData()
  }

  const allRequired = checklist.filter(i => i.required)
  const completedRequired = allRequired.filter(i => i.completed)
  const readyForGoLive = allRequired.length > 0 && allRequired.every(i => i.completed)
  const completionPct = checklist.length === 0 ? 0
    : Math.round((checklist.filter(i => i.completed).length / checklist.length) * 100)
  const activationPct = milestones.length === 0 ? 0
    : Math.round((milestones.filter(m => m.achievedAt).length / milestones.length) * 100)

  return (
    <div style={{ background: '#0f172a', color: '#e2e8f0', fontFamily: 'sans-serif', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Go-Live: {tenantName}</h2>
          <p style={{ margin: '4px 0 0', color: '#94a3b8', fontSize: 13 }}>
            Checklist {completionPct}% · Milestones {activationPct}%
          </p>
        </div>
        {onGoLive && (
          <button
            onClick={() => onGoLive(tenantId)}
            disabled={!readyForGoLive}
            style={{
              padding: '10px 20px', borderRadius: 8, border: 'none', cursor: readyForGoLive ? 'pointer' : 'not-allowed',
              background: readyForGoLive ? '#22c55e' : '#334155',
              color: readyForGoLive ? '#fff' : '#64748b',
              fontWeight: 700, fontSize: 14,
            }}
          >
            {readyForGoLive ? '🚀 Go Live' : `Go Live (${completedRequired.length}/${allRequired.length} required)`}
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>Loading…</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {/* Checklist */}
          <div style={{ background: '#1e293b', borderRadius: 8, padding: 16 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600, color: '#94a3b8' }}>
              Go-Live Checklist
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {checklist.map(item => (
                <div key={item.id}>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '8px 12px', borderRadius: 6,
                    background: item.completed ? '#22c55e10' : '#1e293b',
                    border: `1px solid ${item.completed ? '#22c55e33' : '#334155'}`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: item.completed ? '#22c55e' : '#475569', fontSize: 16 }}>
                        {item.completed ? '✓' : '○'}
                      </span>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: item.required ? 600 : 400 }}>
                          {item.title}
                          {item.required && <span style={{ color: '#f59e0b', marginLeft: 4 }}>*</span>}
                        </div>
                        {item.completedBy && (
                          <div style={{ fontSize: 11, color: '#64748b' }}>
                            by {item.completedBy}
                          </div>
                        )}
                      </div>
                    </div>
                    {!item.completed && (
                      <button
                        onClick={() => setCompleting(item.id)}
                        style={{
                          padding: '4px 10px', background: 'transparent', color: '#3b82f6',
                          border: '1px solid #3b82f6', borderRadius: 4, cursor: 'pointer', fontSize: 11,
                        }}
                      >
                        Complete
                      </button>
                    )}
                  </div>
                  {completing === item.id && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 6, padding: '8px 12px', background: '#0f172a', borderRadius: 6 }}>
                      <input
                        value={completedBy}
                        onChange={e => setCompletedBy(e.target.value)}
                        placeholder="Completed by…"
                        style={{
                          flex: 1, padding: '6px 10px', background: '#1e293b',
                          border: '1px solid #334155', borderRadius: 4, color: '#e2e8f0', fontSize: 12,
                        }}
                      />
                      <button
                        onClick={() => completeItem(item.id)}
                        style={{
                          padding: '6px 12px', background: '#22c55e', color: '#fff',
                          border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12,
                        }}
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setCompleting(null)}
                        style={{
                          padding: '6px 12px', background: 'transparent', color: '#94a3b8',
                          border: '1px solid #334155', borderRadius: 4, cursor: 'pointer', fontSize: 12,
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Milestones */}
          <div style={{ background: '#1e293b', borderRadius: 8, padding: 16 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600, color: '#94a3b8' }}>
              Activation Milestones
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {milestones.map(m => (
                <div
                  key={m.id}
                  style={{
                    padding: '10px 12px', borderRadius: 6,
                    background: m.achievedAt ? '#22c55e10' : '#1e293b',
                    border: `1px solid ${m.achievedAt ? '#22c55e33' : '#334155'}`,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{m.milestoneName}</div>
                      {m.expectedByDate && !m.achievedAt && (
                        <div style={{ fontSize: 11, color: '#f59e0b' }}>
                          Due: {new Date(m.expectedByDate).toLocaleDateString()}
                        </div>
                      )}
                      {m.achievedAt && (
                        <div style={{ fontSize: 11, color: '#22c55e' }}>
                          Achieved {new Date(m.achievedAt).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                    <span style={{ fontSize: 20 }}>{m.achievedAt ? '🏆' : '⏳'}</span>
                  </div>
                </div>
              ))}
              {milestones.length === 0 && (
                <div style={{ color: '#64748b', fontSize: 13, padding: 8 }}>No milestones defined.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
