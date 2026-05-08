// Denver Engineering — Guided Onboarding Flow (v10.0.0)
// Step-by-step onboarding wizard for new enterprise tenants.

import React, { useState } from 'react'

interface OnboardingStep {
  id: string
  title: string
  subtitle: string
  component: React.ReactNode
}

interface GuidedOnboardingFlowProps {
  tenantId: string
  tenantName: string
  onComplete?: (tenantId: string) => void
  onSkip?: () => void
}

function StepIndicator({ steps, currentIndex }: { steps: OnboardingStep[]; currentIndex: number }) {
  return (
    <div className="flex items-center justify-between mb-8">
      {steps.map((step, i) => (
        <React.Fragment key={step.id}>
          <div className="flex flex-col items-center">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              i < currentIndex
                ? 'bg-green-500 text-white'
                : i === currentIndex
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-500'
            }`}>
              {i < currentIndex ? '✓' : i + 1}
            </div>
            <span className="text-xs mt-1 text-gray-500 text-center max-w-16">{step.title}</span>
          </div>
          {i < steps.length - 1 && (
            <div className={`flex-1 h-0.5 mx-2 ${i < currentIndex ? 'bg-green-500' : 'bg-gray-200'}`} />
          )}
        </React.Fragment>
      ))}
    </div>
  )
}

export function GuidedOnboardingFlow({
  tenantId,
  tenantName,
  onComplete,
  onSkip,
}: GuidedOnboardingFlowProps) {
  const [currentStep, setCurrentStep] = useState(0)
  const [stepData, setStepData] = useState<Record<string, unknown>>({})
  const [saving, setSaving] = useState(false)

  const steps: OnboardingStep[] = [
    {
      id: 'welcome',
      title: 'Welcome',
      subtitle: `Welcome to Denver Engineering, ${tenantName}!`,
      component: (
        <div className="text-center">
          <div className="text-5xl mb-4">👋</div>
          <p className="text-gray-600">This short setup will get your workspace ready in minutes.</p>
        </div>
      ),
    },
    {
      id: 'team',
      title: 'Team',
      subtitle: 'Invite your core team members',
      component: (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Admin email addresses (one per line)
          </label>
          <textarea
            className="w-full border rounded p-2 text-sm h-28"
            placeholder="admin@company.com&#10;ops@company.com"
            onChange={e => setStepData(prev => ({ ...prev, adminEmails: e.target.value }))}
          />
        </div>
      ),
    },
    {
      id: 'notifications',
      title: 'Alerts',
      subtitle: 'Configure alert channels',
      component: (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Slack Webhook URL</label>
            <input
              className="w-full border rounded p-2 text-sm"
              placeholder="https://hooks.slack.com/..."
              onChange={e => setStepData(prev => ({ ...prev, slackWebhook: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">PagerDuty Key (optional)</label>
            <input
              className="w-full border rounded p-2 text-sm"
              placeholder="pagerduty-key..."
              onChange={e => setStepData(prev => ({ ...prev, pagerdutyKey: e.target.value }))}
            />
          </div>
        </div>
      ),
    },
    {
      id: 'confirm',
      title: 'Confirm',
      subtitle: 'Review and activate your workspace',
      component: (
        <div className="space-y-2 text-sm text-gray-700">
          <div className="p-3 bg-gray-50 rounded">
            <span className="font-medium">Tenant:</span> {tenantName} ({tenantId})
          </div>
          <div className="p-3 bg-gray-50 rounded">
            <span className="font-medium">Admins:</span>{' '}
            {(stepData['adminEmails'] as string)?.split('\n').filter(Boolean).join(', ') || 'None specified'}
          </div>
          <div className="p-3 bg-gray-50 rounded">
            <span className="font-medium">Slack alerts:</span>{' '}
            {stepData['slackWebhook'] ? '✓ Configured' : 'Not configured'}
          </div>
        </div>
      ),
    },
  ]

  const isLastStep = currentStep === steps.length - 1

  const handleNext = async () => {
    if (isLastStep) {
      setSaving(true)
      try {
        await fetch(`/api/phase10/onboarding/${tenantId}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(stepData),
        })
        onComplete?.(tenantId)
      } finally {
        setSaving(false)
      }
    } else {
      setCurrentStep(prev => prev + 1)
    }
  }

  const step = steps[currentStep]

  return (
    <div className="guided-onboarding-flow max-w-lg mx-auto p-8 bg-white rounded-xl shadow-lg">
      <StepIndicator steps={steps} currentIndex={currentStep} />

      <div className="mb-8">
        <h2 className="text-xl font-bold text-gray-900 mb-1">{step.subtitle}</h2>
        <div className="mt-4">{step.component}</div>
      </div>

      <div className="flex justify-between">
        <button
          className="text-sm text-gray-400 hover:text-gray-600"
          onClick={currentStep === 0 ? onSkip : () => setCurrentStep(prev => prev - 1)}
        >
          {currentStep === 0 ? 'Skip setup' : '← Back'}
        </button>
        <button
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
          disabled={saving}
          onClick={() => void handleNext()}
        >
          {saving ? 'Saving...' : isLastStep ? 'Activate Workspace' : 'Continue →'}
        </button>
      </div>
    </div>
  )
}

export default GuidedOnboardingFlow
