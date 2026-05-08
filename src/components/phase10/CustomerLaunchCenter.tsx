// Denver Engineering — Customer Launch Center (v10.0.0)
// Orchestrates enterprise customer launch: provisioning, onboarding, go-live checklist.

import React, { useState } from 'react'

interface LaunchStep {
  id: string
  title: string
  description: string
  completed: boolean
  required: boolean
  completedAt?: string
  completedBy?: string
}

interface CustomerLaunchCenterProps {
  tenantId: string
  tenantName: string
  onLaunchComplete?: (tenantId: string) => void
}

const DEFAULT_STEPS: LaunchStep[] = [
  {
    id: 'provision',
    title: 'Tenant Provisioning',
    description: 'Database schema, RLS policies, and default configuration applied.',
    completed: false,
    required: true,
  },
  {
    id: 'sso',
    title: 'SSO Configuration',
    description: 'SAML or OIDC integration verified end-to-end.',
    completed: false,
    required: true,
  },
  {
    id: 'billing',
    title: 'Billing Setup',
    description: 'Stripe customer created, subscription active, webhook verified.',
    completed: false,
    required: true,
  },
  {
    id: 'rbac',
    title: 'RBAC Seed',
    description: 'Admin, operator, and viewer roles configured.',
    completed: false,
    required: true,
  },
  {
    id: 'replay',
    title: 'Replay Verification',
    description: 'Event replay tested deterministic across 3 passes.',
    completed: false,
    required: true,
  },
  {
    id: 'training',
    title: 'Operator Training',
    description: 'Key operators completed onboarding training module.',
    completed: false,
    required: false,
  },
  {
    id: 'support',
    title: 'Support Handoff',
    description: 'Support contacts registered, escalation path documented.',
    completed: false,
    required: false,
  },
]

export function CustomerLaunchCenter({
  tenantId,
  tenantName,
  onLaunchComplete,
}: CustomerLaunchCenterProps) {
  const [steps, setSteps] = useState<LaunchStep[]>(DEFAULT_STEPS)
  const [launching, setLaunching] = useState(false)
  const [launchError, setLaunchError] = useState<string | null>(null)

  const completedRequired = steps.filter(s => s.required && s.completed).length
  const totalRequired = steps.filter(s => s.required).length
  const readyToLaunch = completedRequired === totalRequired
  const progressPct = Math.round((completedRequired / totalRequired) * 100)

  const markStep = async (stepId: string, completed: boolean) => {
    try {
      await fetch(`/api/phase10/launch/steps/${tenantId}/${stepId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed }),
      })
      setSteps(prev => prev.map(s =>
        s.id === stepId ? { ...s, completed, completedAt: completed ? new Date().toISOString() : undefined } : s
      ))
    } catch {
      // optimistic update already applied; silently fail
    }
  }

  const handleLaunch = async () => {
    setLaunching(true)
    setLaunchError(null)
    try {
      const res = await fetch(`/api/phase10/launch/${tenantId}/go-live`, { method: 'POST' })
      if (!res.ok) throw new Error(await res.text())
      onLaunchComplete?.(tenantId)
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : 'Launch failed')
    } finally {
      setLaunching(false)
    }
  }

  return (
    <div className="customer-launch-center p-6 bg-white rounded-lg shadow max-w-2xl">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">{tenantName}</h2>
        <p className="text-sm text-gray-500">Customer Launch Checklist · {tenantId}</p>
      </div>

      <div className="mb-6">
        <div className="flex justify-between text-sm text-gray-600 mb-1">
          <span>Launch Readiness</span>
          <span>{completedRequired}/{totalRequired} required steps</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all ${readyToLaunch ? 'bg-green-500' : 'bg-blue-500'}`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      <div className="space-y-3 mb-6">
        {steps.map(step => (
          <div
            key={step.id}
            className={`flex items-start gap-3 p-3 rounded-lg border ${
              step.completed ? 'border-green-200 bg-green-50' : 'border-gray-200'
            }`}
          >
            <button
              className={`mt-0.5 w-5 h-5 rounded border-2 flex-shrink-0 transition-colors ${
                step.completed
                  ? 'bg-green-500 border-green-500'
                  : 'border-gray-300 hover:border-blue-400'
              }`}
              onClick={() => void markStep(step.id, !step.completed)}
            >
              {step.completed && (
                <svg className="w-full h-full text-white p-0.5" viewBox="0 0 12 12">
                  <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" fill="none" />
                </svg>
              )}
            </button>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className={`font-medium ${step.completed ? 'text-green-800' : 'text-gray-800'}`}>
                  {step.title}
                </span>
                {step.required && (
                  <span className="text-xs text-red-500 font-medium">Required</span>
                )}
              </div>
              <p className="text-sm text-gray-500 mt-0.5">{step.description}</p>
            </div>
          </div>
        ))}
      </div>

      {launchError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {launchError}
        </div>
      )}

      <button
        className={`w-full py-3 rounded-lg font-semibold transition-colors ${
          readyToLaunch && !launching
            ? 'bg-green-600 hover:bg-green-700 text-white'
            : 'bg-gray-200 text-gray-400 cursor-not-allowed'
        }`}
        disabled={!readyToLaunch || launching}
        onClick={handleLaunch}
      >
        {launching ? 'Launching...' : readyToLaunch ? '🚀 Go Live' : 'Complete required steps first'}
      </button>
    </div>
  )
}

export default CustomerLaunchCenter
