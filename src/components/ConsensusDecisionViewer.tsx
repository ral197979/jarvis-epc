// Denver Engineering — Consensus Decision Viewer (v7.0.0)
// Shows multi-agent consensus results and coordination conflicts.

import React, { useState } from 'react'

interface AgentVote {
  agentType: string
  vote: string
  confidence: number
  rationale: string
}

interface ConsensusResult {
  topic: string
  tenantId: string
  agentVotes: AgentVote[]
  consensus: string | null
  consensusConfidence: number
  conflictingAgents: string[]
  resolvedAt: string
}

const AGENT_COLOR: Record<string, string> = {
  RiskAgent: 'border-red-700 bg-red-900/30 text-red-300',
  ReadinessCoordinatorAgent: 'border-emerald-700 bg-emerald-900/30 text-emerald-300',
  SchedulingAgent: 'border-blue-700 bg-blue-900/30 text-blue-300',
  ValidationAgent: 'border-violet-700 bg-violet-900/30 text-violet-300',
}

function ConfidencePill({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const color = pct >= 70 ? 'text-emerald-400' : pct >= 40 ? 'text-amber-400' : 'text-red-400'
  return <span className={`text-xs font-mono ${color}`}>{pct}% conf</span>
}

function VoteCard({ vote }: { vote: AgentVote }) {
  return (
    <div className={`rounded-lg border p-3 space-y-1 ${AGENT_COLOR[vote.agentType] ?? 'border-zinc-700 bg-zinc-800 text-zinc-300'}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">{vote.agentType}</span>
        <ConfidencePill value={vote.confidence} />
      </div>
      <p className="text-sm font-medium">"{vote.vote}"</p>
      <p className="text-xs opacity-70">{vote.rationale}</p>
    </div>
  )
}

export function ConsensusDecisionViewer() {
  const [topic, setTopic] = useState('')
  const [votes, setVotes] = useState<AgentVote[]>([
    { agentType: 'RiskAgent', vote: '', confidence: 0.8, rationale: '' },
    { agentType: 'ReadinessCoordinatorAgent', vote: '', confidence: 0.7, rationale: '' },
  ])
  const [result, setResult] = useState<ConsensusResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const updateVote = (i: number, field: keyof AgentVote, value: string | number) => {
    setVotes(prev => prev.map((v, idx) => idx === i ? { ...v, [field]: value } : v))
  }

  const addVote = () => {
    setVotes(prev => [...prev, { agentType: 'SchedulingAgent', vote: '', confidence: 0.75, rationale: '' }])
  }

  const removeVote = (i: number) => {
    setVotes(prev => prev.filter((_, idx) => idx !== i))
  }

  const runConsensus = async () => {
    if (topic.trim().length === 0 || votes.every(v => v.vote.trim().length === 0)) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/optimization/consensus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, votes: votes.filter(v => v.vote.trim().length > 0) }),
      })
      setResult(await res.json())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const confidencePct = result != null ? Math.round(result.consensusConfidence * 100) : 0

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 space-y-5">
      <h2 className="text-lg font-semibold text-zinc-100">Consensus Decision Viewer</h2>

      <div className="space-y-3">
        <input
          type="text"
          placeholder="Decision topic..."
          value={topic}
          onChange={e => setTopic(e.target.value)}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-violet-500"
        />

        <div className="space-y-2">
          {votes.map((v, i) => (
            <div key={i} className="bg-zinc-800 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <select
                  value={v.agentType}
                  onChange={e => updateVote(i, 'agentType', e.target.value)}
                  className="bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-200"
                >
                  {Object.keys(AGENT_COLOR).map(a => <option key={a}>{a}</option>)}
                  <option value="ValidationAgent">ValidationAgent</option>
                </select>
                <input
                  type="text"
                  placeholder="Vote..."
                  value={v.vote}
                  onChange={e => updateVote(i, 'vote', e.target.value)}
                  className="flex-1 bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-200 placeholder-zinc-500"
                />
                <input
                  type="number"
                  step="0.05"
                  min="0"
                  max="1"
                  value={v.confidence}
                  onChange={e => updateVote(i, 'confidence', Number(e.target.value))}
                  className="w-20 bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-200"
                />
                <button onClick={() => removeVote(i)} className="text-zinc-500 hover:text-red-400 text-xs">✕</button>
              </div>
              <input
                type="text"
                placeholder="Rationale..."
                value={v.rationale}
                onChange={e => updateVote(i, 'rationale', e.target.value)}
                className="w-full bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-200 placeholder-zinc-500"
              />
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <button onClick={addVote} className="text-xs border border-zinc-600 text-zinc-400 hover:border-zinc-500 rounded px-3 py-1.5">
            + Add Agent Vote
          </button>
          <button
            onClick={runConsensus}
            disabled={loading}
            className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-xs rounded px-4 py-1.5 transition-colors"
          >
            {loading ? 'Building Consensus...' : 'Build Consensus'}
          </button>
        </div>
      </div>

      {error != null && <p className="text-red-400 text-sm border border-red-800 rounded p-3">{error}</p>}

      {result != null && (
        <div className="space-y-4 border-t border-zinc-700 pt-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-zinc-400">Consensus reached</p>
              <p className="text-lg font-bold text-zinc-100">"{result.consensus ?? 'No consensus'}"</p>
            </div>
            <div className="text-right">
              <p className={`text-2xl font-bold ${confidencePct >= 70 ? 'text-emerald-400' : confidencePct >= 40 ? 'text-amber-400' : 'text-red-400'}`}>
                {confidencePct}%
              </p>
              <p className="text-xs text-zinc-500">confidence</p>
            </div>
          </div>

          {result.conflictingAgents.length > 0 && (
            <div className="bg-amber-900/20 border border-amber-700 rounded-lg p-3">
              <p className="text-xs text-amber-300 font-medium mb-1">Conflicting agents</p>
              <p className="text-xs text-amber-400">{result.conflictingAgents.join(', ')}</p>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-xs text-zinc-400 font-medium uppercase tracking-wide">Agent Votes</p>
            {result.agentVotes.map((v, i) => <VoteCard key={i} vote={v} />)}
          </div>
        </div>
      )}
    </div>
  )
}

export default ConsensusDecisionViewer
