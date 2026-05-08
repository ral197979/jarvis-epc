// Denver Engineering — AgentDecisionTraceViewer (v5.0.0)
// Explainability panel showing agent decision reasoning and alternatives considered.

import React, { useState } from 'react'

interface DecisionAlternative {
  action: string
  reason: string
  confidence: number
  rejected: boolean
  rejectionReason?: string
}

interface DecisionTrace {
  id: string
  executionId: string
  decisionType: string
  rationale: string
  confidence: number
  alternatives: DecisionAlternative[]
  policyContext: Record<string, unknown>
  chosenAction: string
  decidedAt: string
}

interface Props {
  traces: DecisionTrace[]
  agentType: string
}

function ConfidenceBar({ value }: { value: number }) {
  const color = value >= 80 ? '#22c55e' : value >= 60 ? '#f59e0b' : '#ef4444'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div style={{ flex: 1, background: '#e5e7eb', borderRadius: '4px', height: '6px', overflow: 'hidden' }}>
        <div style={{ width: `${value}%`, background: color, height: '100%', borderRadius: '4px', transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: '12px', fontWeight: 600, color, minWidth: '36px' }}>{value}%</span>
    </div>
  )
}

function TraceCard({ trace }: { trace: DecisionTrace }) {
  const [showAlternatives, setShowAlternatives] = useState(false)
  const [showPolicy, setShowPolicy] = useState(false)
  const hasPolicyCtx = Object.keys(trace.policyContext).length > 0

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px', marginBottom: '12px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
        <div>
          <span style={{
            padding: '2px 8px', background: '#eff6ff', color: '#3b82f6',
            borderRadius: '4px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
          }}>
            {trace.decisionType.replace(/_/g, ' ')}
          </span>
          <div style={{ marginTop: '6px', fontSize: '13px', color: '#6b7280' }}>
            {new Date(trace.decidedAt).toLocaleString()}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Confidence</div>
          <ConfidenceBar value={trace.confidence} />
        </div>
      </div>

      {/* Chosen action */}
      <div style={{ marginBottom: '10px' }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>DECISION</div>
        <div style={{
          padding: '8px 12px', background: '#f0fdf4', border: '1px solid #86efac',
          borderRadius: '6px', fontWeight: 600, color: '#16a34a',
        }}>
          ✓ {trace.chosenAction.replace(/_/g, ' ')}
        </div>
      </div>

      {/* Rationale */}
      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>RATIONALE</div>
        <div style={{ fontSize: '13px', color: '#374151', lineHeight: 1.5 }}>{trace.rationale}</div>
      </div>

      {/* Alternatives */}
      {trace.alternatives.length > 0 && (
        <div style={{ marginBottom: hasPolicyCtx ? '10px' : 0 }}>
          <button
            onClick={() => setShowAlternatives(!showAlternatives)}
            style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: '13px', padding: 0, fontWeight: 500 }}
          >
            {showAlternatives ? '▲' : '▶'} {trace.alternatives.length} alternatives considered
          </button>
          {showAlternatives && (
            <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {trace.alternatives.map((alt, idx) => (
                <div key={idx} style={{
                  padding: '8px 12px',
                  background: alt.rejected ? '#fef2f2' : '#f9fafb',
                  border: `1px solid ${alt.rejected ? '#fca5a5' : '#e5e7eb'}`,
                  borderRadius: '6px',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 500, color: alt.rejected ? '#9ca3af' : '#374151' }}>
                      {alt.rejected ? '✗' : '?'} {alt.action.replace(/_/g, ' ')}
                    </span>
                    <span style={{ fontSize: '12px', color: '#9ca3af' }}>{alt.confidence}% confidence</span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#9ca3af' }}>{alt.reason}</div>
                  {alt.rejectionReason && (
                    <div style={{ fontSize: '12px', color: '#ef4444', marginTop: '2px' }}>
                      Rejected: {alt.rejectionReason}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Policy context */}
      {hasPolicyCtx && (
        <div>
          <button
            onClick={() => setShowPolicy(!showPolicy)}
            style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: '13px', padding: 0, fontWeight: 500 }}
          >
            {showPolicy ? '▲' : '▶'} Policy context
          </button>
          {showPolicy && (
            <pre style={{
              marginTop: '8px', background: '#f8fafc', padding: '10px',
              borderRadius: '6px', fontSize: '12px', overflow: 'auto',
            }}>
              {JSON.stringify(trace.policyContext, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

export function AgentDecisionTraceViewer({ traces, agentType }: Props) {
  if (traces.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '40px', color: '#9ca3af', fontFamily: 'system-ui, sans-serif' }}>
        No decision traces recorded for this execution
      </div>
    )
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>Decision Traces</h3>
        <div style={{ color: '#6b7280', fontSize: '13px' }}>{agentType} · {traces.length} decisions</div>
      </div>

      {traces.map(trace => (
        <TraceCard key={trace.id} trace={trace} />
      ))}
    </div>
  )
}
