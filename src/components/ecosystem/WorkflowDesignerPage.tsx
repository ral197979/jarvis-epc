// Denver Engineering — Workflow Designer Page (Phase 9)
// Visual workflow composition with node list canvas, validate, dry-run, and publish.

import React, { useState, useEffect } from 'react'

type NodeType = 'trigger' | 'condition' | 'action' | 'approval_gate' | 'policy_check'

interface WorkflowNode {
  id: string
  type: NodeType
  label: string
}

interface PolicyViolation {
  rule: string
  message: string
}

interface PolicyWarning {
  rule: string
  message: string
}

interface ValidateResult {
  violations: PolicyViolation[]
  warnings: PolicyWarning[]
}

interface DryRunStep {
  nodeId: string
  label: string
  wouldExecute: boolean
  reason?: string
}

interface DryRunResult {
  wouldExecute: DryRunStep[]
  wouldSkip: DryRunStep[]
}

interface WorkflowMeta {
  id: string
  name: string
}

interface Props {
  workflowId: string
  tenantId: string
}

const NODE_COLORS: Record<NodeType, string> = {
  trigger: 'border-violet-600 bg-violet-900/20 text-violet-300',
  condition: 'border-amber-600 bg-amber-900/20 text-amber-300',
  action: 'border-sky-600 bg-sky-900/20 text-sky-300',
  approval_gate: 'border-emerald-600 bg-emerald-900/20 text-emerald-300',
  policy_check: 'border-rose-600 bg-rose-900/20 text-rose-300',
}

const NODE_LABELS: Record<NodeType, string> = {
  trigger: 'Trigger',
  condition: 'Condition',
  action: 'Action',
  approval_gate: 'Approval Gate',
  policy_check: 'Policy Check',
}

let nodeCounter = 1

function makeNode(type: NodeType): WorkflowNode {
  return { id: `node-${nodeCounter++}`, type, label: `${NODE_LABELS[type]} ${nodeCounter - 1}` }
}

export function WorkflowDesignerPage({ workflowId, tenantId: _tenantId }: Props) {
  const [meta, setMeta] = useState<WorkflowMeta | null>(null)
  const [nodes, setNodes] = useState<WorkflowNode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [validating, setValidating] = useState(false)
  const [validateResult, setValidateResult] = useState<ValidateResult | null>(null)
  const [validateError, setValidateError] = useState<string | null>(null)

  const [dryRunning, setDryRunning] = useState(false)
  const [dryRunResult, setDryRunResult] = useState<DryRunResult | null>(null)
  const [dryRunError, setDryRunError] = useState<string | null>(null)

  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [publishSuccess, setPublishSuccess] = useState(false)
  const [showPublishConfirm, setShowPublishConfirm] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`/api/v1/ecosystem/workflows/${workflowId}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data: WorkflowMeta & { nodes?: WorkflowNode[] }) => {
        setMeta({ id: data.id, name: data.name })
        setNodes(data.nodes ?? [])
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [workflowId])

  function addNode(type: NodeType) {
    setNodes(prev => [...prev, makeNode(type)])
  }

  function removeNode(id: string) {
    setNodes(prev => prev.filter(n => n.id !== id))
  }

  function moveUp(index: number) {
    if (index === 0) return
    setNodes(prev => {
      const next = [...prev]
      ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
      return next
    })
  }

  function moveDown(index: number) {
    setNodes(prev => {
      if (index === prev.length - 1) return prev
      const next = [...prev]
      ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
      return next
    })
  }

  function handleValidate() {
    setValidating(true)
    setValidateResult(null)
    setValidateError(null)
    fetch(`/api/v1/ecosystem/workflows/${workflowId}/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodes }),
    })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data: ValidateResult) => setValidateResult(data))
      .catch(e => setValidateError(e.message))
      .finally(() => setValidating(false))
  }

  function handleDryRun() {
    setDryRunning(true)
    setDryRunResult(null)
    setDryRunError(null)
    fetch(`/api/v1/ecosystem/workflows/${workflowId}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodes }),
    })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data: DryRunResult) => setDryRunResult(data))
      .catch(e => setDryRunError(e.message))
      .finally(() => setDryRunning(false))
  }

  function handlePublish() {
    setPublishing(true)
    setPublishError(null)
    setPublishSuccess(false)
    setShowPublishConfirm(false)
    fetch(`/api/v1/ecosystem/workflows/${workflowId}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodes }),
    })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(() => setPublishSuccess(true))
      .catch(e => setPublishError(e.message))
      .finally(() => setPublishing(false))
  }

  if (loading) {
    return (
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 space-y-3 animate-pulse">
        <div className="h-5 bg-zinc-700 rounded w-48" />
        <div className="h-4 bg-zinc-800 rounded w-32" />
        <div className="h-24 bg-zinc-800 rounded" />
      </div>
    )
  }

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-zinc-100">
          Workflow Designer
          {meta != null && <span className="text-zinc-400 font-normal ml-2">— {meta.name}</span>}
        </h2>
        <p className="text-xs text-zinc-500 mt-0.5">Phase 9 — Ecosystem Workflow Composition</p>
      </div>

      {error != null && (
        <p className="text-red-400 text-sm border border-red-800 rounded p-3">{error}</p>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap gap-2">
        {(['trigger', 'condition', 'action', 'approval_gate', 'policy_check'] as NodeType[]).map(type => (
          <button
            key={type}
            onClick={() => addNode(type)}
            className="text-xs border border-zinc-600 rounded px-3 py-1.5 text-zinc-300 hover:border-zinc-400 hover:text-zinc-100 transition-colors"
          >
            + {NODE_LABELS[type]}
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          <button
            onClick={handleValidate}
            disabled={validating || nodes.length === 0}
            className="text-xs border border-amber-700 rounded px-3 py-1.5 text-amber-400 hover:border-amber-500 hover:text-amber-200 disabled:opacity-40 transition-colors"
          >
            {validating ? 'Validating...' : 'Validate'}
          </button>
          <button
            onClick={handleDryRun}
            disabled={dryRunning || nodes.length === 0}
            className="text-xs border border-sky-700 rounded px-3 py-1.5 text-sky-400 hover:border-sky-500 hover:text-sky-200 disabled:opacity-40 transition-colors"
          >
            {dryRunning ? 'Running...' : 'Dry Run'}
          </button>
          <button
            onClick={() => setShowPublishConfirm(true)}
            disabled={publishing || nodes.length === 0}
            className="text-xs border border-emerald-700 rounded px-3 py-1.5 text-emerald-400 hover:border-emerald-500 hover:text-emerald-200 disabled:opacity-40 transition-colors"
          >
            {publishing ? 'Publishing...' : 'Publish'}
          </button>
        </div>
      </div>

      {/* Publish confirm */}
      {showPublishConfirm && (
        <div className="border border-emerald-700 bg-emerald-900/20 rounded-lg p-4 flex items-center justify-between gap-4">
          <p className="text-sm text-emerald-300">
            Publish this workflow? This will make it live for all tenant users.
          </p>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={handlePublish}
              className="text-xs bg-emerald-700 hover:bg-emerald-600 text-white rounded px-3 py-1.5 transition-colors"
            >
              Confirm Publish
            </button>
            <button
              onClick={() => setShowPublishConfirm(false)}
              className="text-xs border border-zinc-600 text-zinc-400 hover:text-zinc-200 rounded px-3 py-1.5 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {publishSuccess && (
        <p className="text-emerald-400 text-sm border border-emerald-800 rounded p-3">
          Workflow published successfully.
        </p>
      )}
      {publishError != null && (
        <p className="text-red-400 text-sm border border-red-800 rounded p-3">{publishError}</p>
      )}

      {/* Node canvas */}
      <div className="space-y-0">
        {nodes.length === 0 ? (
          <div className="border border-dashed border-zinc-700 rounded-lg p-8 text-center text-zinc-500 text-sm">
            No nodes yet. Use the toolbar above to add workflow steps.
          </div>
        ) : (
          nodes.map((node, index) => (
            <div key={node.id} className="relative flex gap-0">
              {/* Vertical connector line */}
              <div className="flex flex-col items-center w-8 shrink-0">
                <div className={`w-3 h-3 rounded-full mt-4 shrink-0 ${
                  node.type === 'trigger' ? 'bg-violet-500' :
                  node.type === 'condition' ? 'bg-amber-500' :
                  node.type === 'action' ? 'bg-sky-500' :
                  node.type === 'approval_gate' ? 'bg-emerald-500' :
                  'bg-rose-500'
                }`} />
                {index < nodes.length - 1 && (
                  <div className="w-px flex-1 bg-zinc-700 my-1" />
                )}
              </div>

              {/* Node card */}
              <div className={`flex-1 mb-2 border rounded-lg p-3 ${NODE_COLORS[node.type]}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-medium uppercase tracking-wide opacity-70 shrink-0">
                      {NODE_LABELS[node.type]}
                    </span>
                    <span className="text-sm font-semibold truncate">{node.label}</span>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => moveUp(index)}
                      disabled={index === 0}
                      className="text-xs text-zinc-400 hover:text-zinc-100 disabled:opacity-30 px-1"
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => moveDown(index)}
                      disabled={index === nodes.length - 1}
                      className="text-xs text-zinc-400 hover:text-zinc-100 disabled:opacity-30 px-1"
                      title="Move down"
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => removeNode(node.id)}
                      className="text-xs text-zinc-500 hover:text-red-400 px-1"
                      title="Remove"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Validate result */}
      {validateError != null && (
        <p className="text-red-400 text-sm border border-red-800 rounded p-3">{validateError}</p>
      )}
      {validateResult != null && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-zinc-300">Policy Validation Result</h3>
          {validateResult.violations.length === 0 && validateResult.warnings.length === 0 ? (
            <p className="text-emerald-400 text-sm">No violations or warnings found.</p>
          ) : null}
          {validateResult.violations.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-red-400 font-medium uppercase tracking-wide">
                Violations ({validateResult.violations.length})
              </p>
              {validateResult.violations.map((v, i) => (
                <div key={i} className="border border-red-800 bg-red-900/10 rounded p-2 text-sm text-red-300">
                  <span className="font-mono text-xs text-red-500 mr-2">{v.rule}</span>
                  {v.message}
                </div>
              ))}
            </div>
          )}
          {validateResult.warnings.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-amber-400 font-medium uppercase tracking-wide">
                Warnings ({validateResult.warnings.length})
              </p>
              {validateResult.warnings.map((w, i) => (
                <div key={i} className="border border-amber-800 bg-amber-900/10 rounded p-2 text-sm text-amber-300">
                  <span className="font-mono text-xs text-amber-500 mr-2">{w.rule}</span>
                  {w.message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Dry-run result */}
      {dryRunError != null && (
        <p className="text-red-400 text-sm border border-red-800 rounded p-3">{dryRunError}</p>
      )}
      {dryRunResult != null && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-zinc-300">Dry Run Result</h3>
          {dryRunResult.wouldExecute.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-emerald-400 font-medium uppercase tracking-wide">
                Would Execute ({dryRunResult.wouldExecute.length})
              </p>
              {dryRunResult.wouldExecute.map((s, i) => (
                <div key={i} className="border border-emerald-800 bg-emerald-900/10 rounded p-2 text-sm text-emerald-300">
                  {s.label}
                </div>
              ))}
            </div>
          )}
          {dryRunResult.wouldSkip.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-zinc-500 font-medium uppercase tracking-wide">
                Would Skip ({dryRunResult.wouldSkip.length})
              </p>
              {dryRunResult.wouldSkip.map((s, i) => (
                <div key={i} className="border border-zinc-700 bg-zinc-800 rounded p-2 text-sm text-zinc-500">
                  {s.label}
                  {s.reason != null && <span className="ml-2 text-xs opacity-70">— {s.reason}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
