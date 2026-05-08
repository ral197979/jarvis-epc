/**
 * Denver Engineering — Policy Rule Builder (v4.40.0)
 * ────────────────────────────────────────────────────
 * Ava Phase 4 — Visual editor for governance policy rules.
 * Supports creating and managing escalation, approval, freeze,
 * evidence, and AI confidence threshold policies.
 */
import React, { useEffect, useState } from 'react'

interface PolicyRule {
  field:    string
  operator: string
  value:    string | number | string[]
}

interface Policy {
  id:          string
  name:        string
  scope:       string
  policy_type: string
  rules:       PolicyRule[]
  priority:    number
  status:      string
}

interface PolicyRuleBuilderProps {
  onSaved?: (policyId: string) => void
}

const POLICY_TYPES = [
  { value: 'escalation_rule',        label: 'Escalation Rule' },
  { value: 'approval_requirement',   label: 'Approval Requirement' },
  { value: 'freeze_condition',       label: 'Freeze Condition' },
  { value: 'evidence_requirement',   label: 'Evidence Requirement' },
  { value: 'ai_confidence_minimum',  label: 'AI Confidence Minimum' },
  { value: 'assignment_restriction', label: 'Assignment Restriction' },
  { value: 'after_hours_restriction',label: 'After-Hours Restriction' },
]

const SCOPES = ['tenant', 'project', 'module', 'role', 'workflow', 'severity']
const OPERATORS = ['eq', 'gte', 'lte', 'in', 'not_in', 'exists']
const FIELDS = ['priority', 'action_type', 'escalation_level', 'source_module', 'confidence_score', 'impact_score']

const emptyRule = (): PolicyRule => ({ field: 'priority', operator: 'eq', value: '' })

export function PolicyRuleBuilder({ onSaved }: PolicyRuleBuilderProps) {
  const [policies, setPolicies] = useState<Policy[]>([])
  const [loading, setLoading]   = useState(true)
  const [creating, setCreating] = useState(false)
  const [saving, setSaving]     = useState(false)
  const [form, setForm]         = useState({
    name: '', scope: 'tenant', scopeId: '', policyType: 'escalation_rule',
    priority: 100, rules: [emptyRule()],
  })

  useEffect(() => {
    setLoading(true)
    fetch('/api/v1/policies')
      .then(r => r.json())
      .then(j => setPolicies(j.data ?? []))
      .catch(() => setPolicies([]))
      .finally(() => setLoading(false))
  }, [])

  const addRule = () => setForm(f => ({ ...f, rules: [...f.rules, emptyRule()] }))
  const removeRule = (i: number) => setForm(f => ({ ...f, rules: f.rules.filter((_, idx) => idx !== i) }))
  const updateRule = (i: number, field: keyof PolicyRule, val: string) =>
    setForm(f => ({ ...f, rules: f.rules.map((r, idx) => idx === i ? { ...r, [field]: val } : r) }))

  const handleSave = async () => {
    if (!form.name || !form.policyType) return
    setSaving(true)
    try {
      const res = await fetch('/api/v1/policies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name, scope: form.scope,
          scope_id: form.scopeId || undefined,
          policy_type: form.policyType, rules: form.rules, priority: form.priority,
        }),
      })
      const j = await res.json()
      if (j.data?.policy_id) {
        onSaved?.(j.data.policy_id)
        setCreating(false)
        setForm({ name: '', scope: 'tenant', scopeId: '', policyType: 'escalation_rule', priority: 100, rules: [emptyRule()] })
        fetch('/api/v1/policies').then(r => r.json()).then(j2 => setPolicies(j2.data ?? []))
      }
    } finally { setSaving(false) }
  }

  const toggleStatus = async (id: string, current: string) => {
    await fetch(`/api/v1/policies/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: current === 'active' ? 'inactive' : 'active' }),
    })
    setPolicies(prev => prev.map(p => p.id === id
      ? { ...p, status: p.status === 'active' ? 'inactive' : 'active' }
      : p))
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>Governance Policies</div>
        <button onClick={() => setCreating(!creating)}
          style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
            background: creating ? '#f3f4f6' : '#2563eb', color: creating ? '#374151' : '#fff', border: 'none' }}>
          {creating ? 'Cancel' : '+ New Policy'}
        </button>
      </div>

      {/* Create form */}
      {creating && (
        <div style={{ padding: '12px 14px', borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <input placeholder="Policy name" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              style={{ padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12 }} />
            <select value={form.policyType} onChange={e => setForm(f => ({ ...f, policyType: e.target.value }))}
              style={{ padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12 }}>
              {POLICY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <select value={form.scope} onChange={e => setForm(f => ({ ...f, scope: e.target.value }))}
              style={{ padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12 }}>
              {SCOPES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <input type="number" placeholder="Priority (lower = higher)" value={form.priority}
              onChange={e => setForm(f => ({ ...f, priority: Number(e.target.value) }))}
              style={{ padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12 }} />
          </div>

          {/* Rules */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Rules</div>
            {form.rules.map((rule, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                <select value={rule.field} onChange={e => updateRule(i, 'field', e.target.value)}
                  style={{ padding: '4px 6px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 11 }}>
                  {FIELDS.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
                <select value={rule.operator} onChange={e => updateRule(i, 'operator', e.target.value)}
                  style={{ padding: '4px 6px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 11 }}>
                  {OPERATORS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
                <input placeholder="value" value={String(rule.value)}
                  onChange={e => updateRule(i, 'value', e.target.value)}
                  style={{ flex: 1, padding: '4px 6px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 11 }} />
                <button onClick={() => removeRule(i)}
                  style={{ color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14 }}>×</button>
              </div>
            ))}
            <button onClick={addRule}
              style={{ fontSize: 11, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer' }}>
              + Add Rule
            </button>
          </div>

          <button onClick={handleSave} disabled={saving || !form.name}
            style={{ padding: '6px 16px', borderRadius: 6, background: '#2563eb', color: '#fff',
              border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            {saving ? 'Saving…' : 'Save Policy'}
          </button>
        </div>
      )}

      {/* Policy list */}
      {loading ? (
        <div style={{ padding: 16, color: '#9ca3af', fontSize: 13 }}>Loading policies…</div>
      ) : policies.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>No policies defined.</div>
      ) : policies.map(p => (
        <div key={p.id} style={{ padding: '10px 14px', borderBottom: '1px solid #f3f4f6',
          display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: '#111827' }}>{p.name}</div>
            <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>
              {p.policy_type.replace(/_/g, ' ')} · {p.scope} · P{p.priority}
            </div>
          </div>
          <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 10,
            background: p.status === 'active' ? '#f0fdf4' : '#f9fafb',
            color: p.status === 'active' ? '#10b981' : '#9ca3af', fontWeight: 600 }}>
            {p.status}
          </span>
          <button onClick={() => toggleStatus(p.id, p.status)}
            style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
              background: '#f3f4f6', border: 'none', color: '#374151' }}>
            {p.status === 'active' ? 'Disable' : 'Enable'}
          </button>
        </div>
      ))}
    </div>
  )
}
