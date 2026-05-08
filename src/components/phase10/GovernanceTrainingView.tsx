// Denver Engineering — Governance Training View (v10.0.0)
// AI governance education: explainability standards, audit requirements, compliance posture.

import React, { useState } from 'react'

interface GovernanceTopic {
  id: string
  category: string
  title: string
  summary: string
  keyPoints: string[]
  links?: { label: string; href: string }[]
}

interface GovernanceTrainingViewProps {
  tenantId?: string
  onTopicAcknowledged?: (topicId: string) => void
}

const GOVERNANCE_TOPICS: GovernanceTopic[] = [
  {
    id: 'ai-explainability',
    category: 'AI Governance',
    title: 'AI Explainability Requirements',
    summary: 'Every AI decision must pass 4 explainability checks before it is logged as compliant.',
    keyPoints: [
      'Decision rationale must be recorded in the audit log',
      'Confidence scores are required for all model outputs',
      'Data lineage must trace to source events',
      'Human-reviewable outputs are mandatory for high-stakes decisions',
    ],
  },
  {
    id: 'replay-integrity',
    category: 'Determinism',
    title: 'Replay Integrity Standards',
    summary: 'Zero divergence is the accepted tolerance for replay verification runs.',
    keyPoints: [
      'All event handlers must be deterministic (no random(), no Date.now() in handlers)',
      'External calls must be mocked or idempotent during replay',
      'Divergence triggers immediate incident creation',
      'Replay must pass 3 consecutive passes to be marked verified',
    ],
  },
  {
    id: 'tenant-isolation',
    category: 'Security',
    title: 'Tenant Isolation Controls',
    summary: 'RLS policies enforce tenant boundaries at the database layer.',
    keyPoints: [
      'All multi-tenant tables must have a RLS policy prefixed with "tenant_"',
      'Minimum 5 tenant RLS policies required for gate pass',
      'Cross-tenant queries are prohibited outside admin context',
      'Audit log entries must record tenantId for every write',
    ],
  },
  {
    id: 'audit-completeness',
    category: 'Compliance',
    title: 'Audit Log Completeness',
    summary: 'Governance requires >100 audit events per 7-day window to pass completeness checks.',
    keyPoints: [
      'All state-changing operations emit an audit event',
      'Audit events are immutable — never updated, only appended',
      'Sparse audit logs trigger "warn" governance outcome',
      'Zero audit events trigger "fail" — investigate immediately',
    ],
  },
]

export function GovernanceTrainingView({
  tenantId,
  onTopicAcknowledged,
}: GovernanceTrainingViewProps) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set())

  const handleAcknowledge = async (topicId: string) => {
    try {
      if (tenantId) {
        await fetch(`/api/phase10/training/governance/${tenantId}/acknowledge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topicId }),
        })
      }
      setAcknowledged(prev => new Set([...prev, topicId]))
      onTopicAcknowledged?.(topicId)
    } catch {
      // acknowledgment best-effort
    }
  }

  const categories = [...new Set(GOVERNANCE_TOPICS.map(t => t.category))]

  return (
    <div className="governance-training-view p-6 bg-white rounded-lg shadow">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">Governance Training</h2>
        <p className="text-sm text-gray-500">
          {acknowledged.size}/{GOVERNANCE_TOPICS.length} topics acknowledged
        </p>
      </div>

      {categories.map(category => (
        <div key={category} className="mb-6">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            {category}
          </h3>
          <div className="space-y-3">
            {GOVERNANCE_TOPICS.filter(t => t.category === category).map(topic => (
              <div
                key={topic.id}
                className={`border rounded-lg overflow-hidden ${
                  acknowledged.has(topic.id) ? 'border-green-200' : 'border-gray-200'
                }`}
              >
                <button
                  className="w-full text-left p-4 flex justify-between items-start hover:bg-gray-50"
                  onClick={() => setExpanded(expanded === topic.id ? null : topic.id)}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-800">{topic.title}</span>
                      {acknowledged.has(topic.id) && (
                        <span className="text-green-500 text-sm">✓</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 mt-0.5">{topic.summary}</p>
                  </div>
                  <span className="text-gray-400 ml-3">{expanded === topic.id ? '▲' : '▼'}</span>
                </button>

                {expanded === topic.id && (
                  <div className="px-4 pb-4 border-t border-gray-100">
                    <ul className="mt-3 space-y-2">
                      {topic.keyPoints.map((point, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                          <span className="text-blue-500 font-bold mt-0.5">•</span>
                          {point}
                        </li>
                      ))}
                    </ul>
                    {!acknowledged.has(topic.id) && (
                      <button
                        className="mt-4 px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                        onClick={() => void handleAcknowledge(topic.id)}
                      >
                        I understand — acknowledge
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export default GovernanceTrainingView
