// Denver Engineering — Ecosystem Health Grid (Post-GA)
// Displays trust scores, moderation queue status, and entity health across ecosystem

import React, { useState, useEffect } from 'react'

interface TrustRecord {
  id: string
  entityId: string
  entityType: 'plugin' | 'workflow' | 'agent' | 'partner'
  trustScore: number
  moderationAction: string | null
  isImmutable: boolean
  actionedAt: string | null
  createdAt: string
}

interface ModerationQueueItem {
  id: string
  entityId: string
  entityType: string
  trustScore: number
  flagCount: number
  priority: 'critical' | 'high' | 'medium' | 'low'
  queuedAt: string
}

interface EcosystemData {
  trustRecords: TrustRecord[]
  moderationQueue: ModerationQueueItem[]
  trustSignal: number
  criticalCount: number
  highCount: number
  totalQueued: number
}

const PRIORITY_COLORS = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#22c55e',
}

const ENTITY_ICONS = {
  plugin: '🔌',
  workflow: '⚙️',
  agent: '🤖',
  partner: '🤝',
}

function TrustBadge({ score }: { score: number }) {
  const color = score >= 75 ? '#22c55e' : score >= 50 ? '#eab308' : '#ef4444'
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 10,
      background: `${color}20`, color, fontSize: 11, fontWeight: 600,
    }}>
      {score}
    </span>
  )
}

function ModActionBadge({ action }: { action: string | null }) {
  if (!action) return <span style={{ fontSize: 11, color: '#475569' }}>—</span>
  const colors: Record<string, string> = {
    approve: '#22c55e', warn: '#eab308', restrict: '#f97316',
    reject: '#ef4444', revoke: '#dc2626',
  }
  const color = colors[action] ?? '#94a3b8'
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 10,
      background: `${color}20`, color, fontSize: 11, fontWeight: 600,
      textTransform: 'capitalize',
    }}>
      {action}
    </span>
  )
}

function QueueItem({ item }: { item: ModerationQueueItem }) {
  const color = PRIORITY_COLORS[item.priority]
  const icon = ENTITY_ICONS[item.entityType as keyof typeof ENTITY_ICONS] ?? '📦'
  return (
    <div style={{
      background: '#0f172a', border: `1px solid ${color}40`,
      borderRadius: 8, padding: 12, marginBottom: 8,
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 16 }}>{icon}</span>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>
            {item.entityId}
          </div>
          <div style={{ fontSize: 11, color: '#64748b' }}>
            {item.entityType} · {item.flagCount} flag{item.flagCount !== 1 ? 's' : ''}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <TrustBadge score={item.trustScore} />
        <span style={{
          padding: '3px 8px', borderRadius: 10, fontSize: 11,
          background: `${color}20`, color, fontWeight: 600,
          textTransform: 'capitalize',
        }}>
          {item.priority}
        </span>
      </div>
    </div>
  )
}

function TrustRecordRow({ record }: { record: TrustRecord }) {
  const icon = ENTITY_ICONS[record.entityType] ?? '📦'
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '28px 1fr 80px 100px 80px',
      alignItems: 'center', gap: 12,
      padding: '10px 14px', borderBottom: '1px solid #0f172a',
    }}>
      <span>{icon}</span>
      <div>
        <div style={{ fontSize: 12, color: '#e2e8f0' }}>{record.entityId}</div>
        <div style={{ fontSize: 11, color: '#475569' }}>{record.entityType}</div>
      </div>
      <TrustBadge score={record.trustScore} />
      <ModActionBadge action={record.moderationAction} />
      <div style={{ fontSize: 11, color: record.isImmutable ? '#f97316' : '#475569' }}>
        {record.isImmutable ? '🔒 locked' : 'active'}
      </div>
    </div>
  )
}

export function EcosystemHealthGrid() {
  const [data, setData] = useState<EcosystemData | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'queue' | 'records'>('queue')
  const [priorityFilter, setPriorityFilter] = useState<string>('all')

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/postGA/ecosystem/health')
      setData(await res.json())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const filteredQueue = data?.moderationQueue.filter(
    i => priorityFilter === 'all' || i.priority === priorityFilter
  ) ?? []

  const tabStyle = (active: boolean) => ({
    padding: '6px 14px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
    border: active ? '1px solid #38bdf8' : '1px solid #1e293b',
    background: active ? '#0f2241' : 'transparent', color: active ? '#7dd3fc' : '#64748b',
  })

  return (
    <div style={{ background: '#060d1a', minHeight: '100vh', fontFamily: 'sans-serif', padding: 24, color: '#e2e8f0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700 }}>🌐 Ecosystem Health Grid</div>
          <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
            Trust scoring and moderation queue management
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          style={{
            padding: '7px 14px', borderRadius: 6, border: '1px solid #1e3a5f',
            background: '#0f2241', color: '#7dd3fc', cursor: 'pointer', fontSize: 12,
          }}
        >
          {loading ? '…' : '↻'}
        </button>
      </div>

      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
          {[
            {
              label: 'Trust Signal', value: `${(data.trustSignal * 100).toFixed(0)}%`,
              color: data.trustSignal >= 0.75 ? '#22c55e' : data.trustSignal >= 0.6 ? '#eab308' : '#ef4444',
            },
            {
              label: 'Total Queued', value: data.totalQueued,
              color: data.totalQueued === 0 ? '#22c55e' : '#eab308',
            },
            {
              label: 'Critical', value: data.criticalCount,
              color: data.criticalCount === 0 ? '#22c55e' : '#ef4444',
            },
            {
              label: 'High Priority', value: data.highCount,
              color: data.highCount === 0 ? '#22c55e' : '#f97316',
            },
          ].map(stat => (
            <div key={stat.label} style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 14 }}>
              <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>{stat.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: stat.color }}>{stat.value}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={tabStyle(tab === 'queue')} onClick={() => setTab('queue')}>Moderation Queue</button>
          <button style={tabStyle(tab === 'records')} onClick={() => setTab('records')}>Trust Records</button>
        </div>
        {tab === 'queue' && (
          <select
            value={priorityFilter}
            onChange={e => setPriorityFilter(e.target.value)}
            style={{
              background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6,
              color: '#94a3b8', padding: '5px 10px', fontSize: 12,
            }}
          >
            <option value="all">All Priorities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        )}
      </div>

      {loading && !data ? (
        <div style={{ color: '#475569', textAlign: 'center', padding: 80 }}>Loading…</div>
      ) : data ? (
        tab === 'queue' ? (
          filteredQueue.length === 0
            ? <div style={{ color: '#22c55e', textAlign: 'center', padding: 40 }}>✓ No items in queue.</div>
            : filteredQueue.map(item => <QueueItem key={item.id} item={item} />)
        ) : (
          <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{
              display: 'grid', gridTemplateColumns: '28px 1fr 80px 100px 80px',
              gap: 12, padding: '8px 14px', fontSize: 10,
              color: '#475569', textTransform: 'uppercase', borderBottom: '1px solid #1e293b',
            }}>
              <span />
              <span>Entity</span>
              <span>Trust</span>
              <span>Action</span>
              <span>Status</span>
            </div>
            {data.trustRecords.length === 0
              ? <div style={{ color: '#475569', textAlign: 'center', padding: 40 }}>No records.</div>
              : data.trustRecords.map(r => <TrustRecordRow key={r.id} record={r} />)
            }
          </div>
        )
      ) : null}
    </div>
  )
}
