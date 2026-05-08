// Denver Engineering — Certification Readiness Panel (v10.0.0)
// SOC 2, ISO 27001, and AI governance certification status and evidence tracking.

import React, { useState, useEffect } from 'react'

type CertificationFramework = 'soc2_type2' | 'iso27001' | 'ai_governance' | 'hipaa'

interface CertificationStatus {
  framework: CertificationFramework
  status: 'not_started' | 'in_progress' | 'ready' | 'certified' | 'expired'
  completionPercent: number
  openItems: number
  certifiedAt: string | null
  expiresAt: string | null
  nextAuditDate: string | null
}

interface CertificationEvidence {
  id: string
  framework: CertificationFramework
  controlId: string
  description: string
  evidenceType: 'screenshot' | 'log' | 'policy' | 'report' | 'attestation'
  status: 'collected' | 'pending' | 'expired'
  collectedAt: string | null
}

interface CertificationReadinessPanelProps {
  tenantId: string
  onEvidenceRequest?: (framework: CertificationFramework, controlId: string) => void
}

const FRAMEWORK_LABELS: Record<CertificationFramework, string> = {
  soc2_type2: 'SOC 2 Type II',
  iso27001: 'ISO 27001',
  ai_governance: 'AI Governance',
  hipaa: 'HIPAA',
}

const FRAMEWORK_ICONS: Record<CertificationFramework, string> = {
  soc2_type2: '🛡️',
  iso27001: '📋',
  ai_governance: '🤖',
  hipaa: '🏥',
}

const STATUS_STYLES: Record<string, string> = {
  certified: 'bg-green-100 text-green-700',
  ready: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-yellow-100 text-yellow-700',
  not_started: 'bg-gray-100 text-gray-500',
  expired: 'bg-red-100 text-red-700',
}

export function CertificationReadinessPanel({
  tenantId,
  onEvidenceRequest,
}: CertificationReadinessPanelProps) {
  const [certifications, setCertifications] = useState<CertificationStatus[]>([])
  const [evidence, setEvidence] = useState<CertificationEvidence[]>([])
  const [selectedFramework, setSelectedFramework] = useState<CertificationFramework | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [certRes, evidenceRes] = await Promise.all([
          fetch(`/api/phase10/certification/${tenantId}/status`),
          fetch(`/api/phase10/certification/${tenantId}/evidence`),
        ])
        if (certRes.ok) setCertifications(await certRes.json())
        if (evidenceRes.ok) setEvidence(await evidenceRes.json())
      } finally {
        setLoading(false)
      }
    }
    void fetchData()
  }, [tenantId])

  const frameworkEvidence = evidence.filter(e =>
    selectedFramework == null || e.framework === selectedFramework
  )
  const pendingEvidence = frameworkEvidence.filter(e => e.status === 'pending')
  const collectedEvidence = frameworkEvidence.filter(e => e.status === 'collected')

  return (
    <div className="certification-readiness-panel p-6 bg-white rounded-lg shadow">
      <h2 className="text-xl font-bold text-gray-900 mb-6">Certification Readiness</h2>

      {loading ? (
        <div className="text-center py-8 text-gray-400">Loading certification status...</div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {certifications.map(cert => (
              <button
                key={cert.framework}
                className={`p-4 rounded-xl border-2 text-left transition-all ${
                  selectedFramework === cert.framework ? 'border-blue-500' : 'border-gray-200'
                }`}
                onClick={() => setSelectedFramework(
                  selectedFramework === cert.framework ? null : cert.framework
                )}
              >
                <div className="text-2xl mb-2">{FRAMEWORK_ICONS[cert.framework]}</div>
                <div className="font-semibold text-sm text-gray-800">
                  {FRAMEWORK_LABELS[cert.framework]}
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium mt-1 inline-block ${STATUS_STYLES[cert.status]}`}>
                  {cert.status.replace('_', ' ')}
                </span>
                <div className="mt-2">
                  <div className="w-full bg-gray-200 rounded-full h-1">
                    <div
                      className="h-1 rounded-full bg-blue-500"
                      style={{ width: `${cert.completionPercent}%` }}
                    />
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {cert.completionPercent}% · {cert.openItems} open
                  </div>
                </div>
              </button>
            ))}
          </div>

          {selectedFramework && (
            <div className="border rounded-lg overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b">
                <h3 className="font-semibold text-gray-800">
                  {FRAMEWORK_LABELS[selectedFramework]} Evidence
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {collectedEvidence.length} collected · {pendingEvidence.length} pending
                </p>
              </div>
              <div className="divide-y max-h-64 overflow-y-auto">
                {frameworkEvidence.map(ev => (
                  <div key={ev.id} className="flex items-center gap-3 px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      ev.status === 'collected' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {ev.status}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-800">{ev.controlId}</div>
                      <div className="text-xs text-gray-500 truncate">{ev.description}</div>
                    </div>
                    <div className="text-xs text-gray-400">{ev.evidenceType}</div>
                    {ev.status === 'pending' && onEvidenceRequest && (
                      <button
                        className="text-xs text-blue-600 hover:underline whitespace-nowrap"
                        onClick={() => onEvidenceRequest(ev.framework, ev.controlId)}
                      >
                        Collect
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default CertificationReadinessPanel
