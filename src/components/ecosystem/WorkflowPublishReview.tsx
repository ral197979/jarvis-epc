// Denver Engineering — Workflow Publish Review (v9.0.0)
// Pre-publish checklist: policy validation, dry-run, approval gate review, final publish.

import React, { useEffect, useState } from 'react'

interface Workflow {
  id: string
  name: string
  status: string
  triggerType: string
  policyValidated: boolean
  dryRunPassed: boolean
  currentVersion: number
  publishedAt: string | null
}

interface PolicyResult {
  passed: boolean
  violations: string[]
  warnings: string[]
}

interface Props {
  workflowId: string
  tenantId: string
  onPublished?: () => void
}

export function WorkflowPublishReview({ workflowId, onPublished }: Props) {
  const [workflow, setWorkflow] = useState<Workflow | null>(null)
  const [policy, setPolicy] = useState<PolicyResult | null>(null)
  const [validating, setValidating] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishConfirm, setPublishConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/v1/ecosystem/workflows/${workflowId}`)
      .then(r => r.json())
      .then(setWorkflow)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [workflowId])

  async function runValidation() {
    setValidating(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/ecosystem/workflows/${workflowId}/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json()
      setPolicy(data)
      if (data.passed) {
        setWorkflow(prev => prev ? { ...prev, policyValidated: true } : null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Validation failed')
    } finally {
      setValidating(false)
    }
  }

  async function handlePublish() {
    setPublishing(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/ecosystem/workflows/${workflowId}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publishedBy: 'admin' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Publish failed')
      setWorkflow(data)
      setPublishConfirm(false)
      onPublished?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Publish failed')
    } finally {
      setPublishing(false)
    }
  }

  if (loading) return <div className="animate-pulse text-zinc-500 text-sm">Loading…</div>
  if (workflow == null) return <div className="text-red-500 text-sm">Workflow not found</div>

  const checks = [
    {
      label: 'Policy Validation',
      passed: workflow.policyValidated,
      required: true,
    },
    {
      label: 'Dry-Run Simulation',
      passed: workflow.dryRunPassed,
      required: true,
    },
    {
      label: 'Not Already Published',
      passed: workflow.status !== 'published',
      required: true,
    },
  ]

  const allPassed = checks.every(c => c.passed)

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-white">{workflow.name}</h3>
        <p className="text-xs text-zinc-400">
          v{workflow.currentVersion} · trigger: {workflow.triggerType}
        </p>
      </div>

      {/* Pre-publish checklist */}
      <div className="bg-zinc-800 rounded-lg border border-zinc-700 p-4 space-y-3">
        <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
          Pre-Publish Checklist
        </h4>
        {checks.map(check => (
          <div key={check.label} className="flex items-center gap-3">
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
              check.passed ? 'bg-emerald-600 text-white' : 'bg-zinc-700 text-zinc-400'
            }`}>
              {check.passed ? '✓' : '○'}
            </span>
            <span className={`text-sm ${check.passed ? 'text-white' : 'text-zinc-400'}`}>
              {check.label}
            </span>
            {check.required && !check.passed && (
              <span className="text-xs text-amber-400">(required)</span>
            )}
          </div>
        ))}
      </div>

      {/* Policy result */}
      {policy != null && (
        <div className={`rounded-lg border p-3 space-y-2 ${
          policy.passed ? 'bg-emerald-900/20 border-emerald-800' : 'bg-red-900/20 border-red-800'
        }`}>
          <p className={`text-sm font-medium ${policy.passed ? 'text-emerald-400' : 'text-red-400'}`}>
            Policy {policy.passed ? 'Passed ✓' : 'Failed ✗'}
          </p>
          {policy.violations.map((v, i) => (
            <p key={i} className="text-xs text-red-400">✗ {v}</p>
          ))}
          {policy.warnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-400">⚠ {w}</p>
          ))}
        </div>
      )}

      {error && <p className="text-red-500 text-sm">{error}</p>}

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={runValidation}
          disabled={validating}
          className="px-4 py-2 rounded text-sm font-medium bg-zinc-700 hover:bg-zinc-600 text-white disabled:opacity-50 transition-colors"
        >
          {validating ? 'Validating…' : 'Run Policy Validation'}
        </button>

        {!publishConfirm ? (
          <button
            onClick={() => setPublishConfirm(true)}
            disabled={!allPassed}
            className="px-4 py-2 rounded text-sm font-medium bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Publish Workflow
          </button>
        ) : (
          <div className="flex gap-2 items-center">
            <span className="text-sm text-amber-400">Publish this workflow?</span>
            <button
              onClick={handlePublish}
              disabled={publishing}
              className="px-3 py-1.5 rounded text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 transition-colors"
            >
              {publishing ? 'Publishing…' : 'Confirm Publish'}
            </button>
            <button
              onClick={() => setPublishConfirm(false)}
              className="px-3 py-1.5 rounded text-sm font-medium bg-zinc-700 hover:bg-zinc-600 text-white transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
