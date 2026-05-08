// Denver Engineering — Operator Training Panel (v10.0.0)
// Tracks operator training completion and certifications.

import React, { useState, useEffect } from 'react'

interface TrainingModule {
  id: string
  title: string
  description: string
  estimatedMinutes: number
  required: boolean
  completedAt: string | null
  score: number | null
}

interface OperatorTrainingPanelProps {
  tenantId: string
  operatorId: string
  operatorName: string
  onModuleComplete?: (moduleId: string, score: number) => void
}

const TRAINING_MODULES: TrainingModule[] = [
  {
    id: 'platform-overview',
    title: 'Platform Overview',
    description: 'Core concepts: workflows, tenants, replay, and governance.',
    estimatedMinutes: 20,
    required: true,
    completedAt: null,
    score: null,
  },
  {
    id: 'incident-response',
    title: 'Incident Response',
    description: 'How to identify, triage, and escalate production incidents.',
    estimatedMinutes: 30,
    required: true,
    completedAt: null,
    score: null,
  },
  {
    id: 'replay-debugging',
    title: 'Replay Debugging',
    description: 'Diagnosing non-determinism and replay divergence.',
    estimatedMinutes: 25,
    required: true,
    completedAt: null,
    score: null,
  },
  {
    id: 'governance-controls',
    title: 'Governance Controls',
    description: 'AI explainability, audit completeness, and compliance posture.',
    estimatedMinutes: 20,
    required: false,
    completedAt: null,
    score: null,
  },
  {
    id: 'advanced-diagnostics',
    title: 'Advanced Diagnostics',
    description: 'Support diagnostic reports, tenant health, and edge scenarios.',
    estimatedMinutes: 35,
    required: false,
    completedAt: null,
    score: null,
  },
]

export function OperatorTrainingPanel({
  tenantId,
  operatorId,
  operatorName,
  onModuleComplete,
}: OperatorTrainingPanelProps) {
  const [modules, setModules] = useState<TrainingModule[]>(TRAINING_MODULES)
  const [activeModule, setActiveModule] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchProgress = async () => {
      try {
        const res = await fetch(
          `/api/phase10/training/${tenantId}/operators/${operatorId}/progress`
        )
        if (res.ok) {
          const progress: Record<string, { completedAt: string; score: number }> = await res.json()
          setModules(prev => prev.map(m => ({
            ...m,
            completedAt: progress[m.id]?.completedAt ?? null,
            score: progress[m.id]?.score ?? null,
          })))
        }
      } finally {
        setLoading(false)
      }
    }
    void fetchProgress()
  }, [tenantId, operatorId])

  const handleComplete = async (moduleId: string, score: number) => {
    try {
      await fetch(`/api/phase10/training/${tenantId}/operators/${operatorId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moduleId, score }),
      })
      const completedAt = new Date().toISOString()
      setModules(prev => prev.map(m =>
        m.id === moduleId ? { ...m, completedAt, score } : m
      ))
      onModuleComplete?.(moduleId, score)
    } finally {
      setActiveModule(null)
    }
  }

  const requiredCompleted = modules.filter(m => m.required && m.completedAt).length
  const totalRequired = modules.filter(m => m.required).length
  const totalCompleted = modules.filter(m => m.completedAt).length
  const certified = requiredCompleted === totalRequired

  return (
    <div className="operator-training-panel p-6 bg-white rounded-lg shadow">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Operator Training</h2>
          <p className="text-sm text-gray-500">{operatorName}</p>
        </div>
        {certified && (
          <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-medium">
            ✓ Certified
          </span>
        )}
      </div>

      <div className="mb-4">
        <div className="flex justify-between text-sm text-gray-500 mb-1">
          <span>{totalCompleted}/{modules.length} modules complete</span>
          <span>{requiredCompleted}/{totalRequired} required</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className={`h-2 rounded-full ${certified ? 'bg-green-500' : 'bg-blue-500'}`}
            style={{ width: `${Math.round((totalCompleted / modules.length) * 100)}%` }}
          />
        </div>
      </div>

      {loading ? (
        <div className="text-gray-400 text-center py-6">Loading training progress...</div>
      ) : (
        <div className="space-y-3">
          {modules.map(module => (
            <div
              key={module.id}
              className={`p-4 rounded-lg border ${
                module.completedAt ? 'border-green-200 bg-green-50' : 'border-gray-200'
              }`}
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-800">{module.title}</span>
                    {module.required && <span className="text-xs text-red-500">Required</span>}
                    {module.score != null && (
                      <span className="text-xs text-green-600">{module.score}%</span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500 mt-0.5">{module.description}</p>
                  <p className="text-xs text-gray-400 mt-1">~{module.estimatedMinutes} min</p>
                </div>
                {module.completedAt ? (
                  <span className="text-green-500 text-lg">✓</span>
                ) : (
                  <button
                    className="ml-3 px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                    onClick={() => setActiveModule(module.id)}
                  >
                    Start
                  </button>
                )}
              </div>

              {activeModule === module.id && (
                <div className="mt-3 pt-3 border-t border-gray-200">
                  <p className="text-sm text-gray-600 mb-3">
                    After completing the training material, record your completion:
                  </p>
                  <div className="flex gap-2">
                    <button
                      className="px-4 py-1.5 bg-green-600 text-white text-sm rounded"
                      onClick={() => void handleComplete(module.id, 100)}
                    >
                      Mark Complete (100%)
                    </button>
                    <button
                      className="px-4 py-1.5 bg-gray-400 text-white text-sm rounded"
                      onClick={() => setActiveModule(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default OperatorTrainingPanel
