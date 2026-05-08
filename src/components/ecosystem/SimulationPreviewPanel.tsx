// Denver Engineering — Simulation Preview Panel (v9.0.0)
// Shows dry-run results: steps that would execute, steps skipped, approval gates triggered.

import React, { useState } from 'react'

interface DryRunResult {
  workflowId: string
  stepsSimulated: number
  wouldExecute: string[]
  wouldSkip: string[]
  approvalGatesTriggered: number
  passed: boolean
}

interface Props {
  workflowId: string
  tenantId: string
}

export function SimulationPreviewPanel({ workflowId }: Props) {
  const [result, setResult] = useState<DryRunResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testContext, setTestContext] = useState<string>('{}')
  const [contextError, setContextError] = useState<string | null>(null)

  async function runSimulation() {
    setContextError(null)
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(testContext)
    } catch {
      setContextError('Invalid JSON in test context')
      return
    }

    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/ecosystem/workflows/${workflowId}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testContext: parsed }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Dry run failed')
      setResult(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Simulation failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
          Test Context (JSON)
        </label>
        <textarea
          value={testContext}
          onChange={e => setTestContext(e.target.value)}
          rows={3}
          className="w-full mt-1 bg-zinc-900 border border-zinc-700 rounded p-2 text-sm text-zinc-200 font-mono focus:outline-none focus:border-blue-500"
          placeholder='{ "condition_a": true }'
        />
        {contextError && <p className="text-red-500 text-xs mt-1">{contextError}</p>}
      </div>

      <button
        onClick={runSimulation}
        disabled={loading}
        className="px-4 py-2 rounded text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition-colors"
      >
        {loading ? 'Simulating…' : '▶ Run Dry-Run Simulation'}
      </button>

      {error && <p className="text-red-500 text-sm">{error}</p>}

      {result != null && (
        <div className="space-y-3">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-zinc-800 rounded-lg p-3 border border-zinc-700 text-center">
              <p className="text-xs text-zinc-400">Steps Simulated</p>
              <p className="text-2xl font-bold text-white mt-1">{result.stepsSimulated}</p>
            </div>
            <div className="bg-zinc-800 rounded-lg p-3 border border-zinc-700 text-center">
              <p className="text-xs text-zinc-400">Approval Gates</p>
              <p className={`text-2xl font-bold mt-1 ${result.approvalGatesTriggered > 0 ? 'text-amber-400' : 'text-zinc-400'}`}>
                {result.approvalGatesTriggered}
              </p>
            </div>
            <div className="bg-zinc-800 rounded-lg p-3 border border-zinc-700 text-center">
              <p className="text-xs text-zinc-400">Result</p>
              <p className={`text-sm font-bold mt-1 ${result.passed ? 'text-emerald-400' : 'text-red-400'}`}>
                {result.passed ? '✓ PASS' : '✗ FAIL'}
              </p>
            </div>
          </div>

          {/* Would execute */}
          {result.wouldExecute.length > 0 && (
            <div className="bg-emerald-900/20 border border-emerald-800 rounded-lg p-3">
              <h4 className="text-xs font-semibold text-emerald-400 mb-2">
                Would Execute ({result.wouldExecute.length})
              </h4>
              <div className="space-y-1">
                {result.wouldExecute.map((step, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-emerald-600 text-white text-xs flex items-center justify-center">{i + 1}</span>
                    <span className="text-sm text-emerald-300 font-mono">{step}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Would skip */}
          {result.wouldSkip.length > 0 && (
            <div className="bg-zinc-800 border border-zinc-600 rounded-lg p-3">
              <h4 className="text-xs font-semibold text-zinc-400 mb-2">
                Would Skip ({result.wouldSkip.length})
              </h4>
              <div className="space-y-1">
                {result.wouldSkip.map((step, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-zinc-600 text-zinc-300 text-xs flex items-center justify-center">—</span>
                    <span className="text-sm text-zinc-500 font-mono line-through">{step}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
