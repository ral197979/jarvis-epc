/**
 * Denver Engineering — MCPToolsPage  (v4.28.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Extends v4.27.0 MCPToolsPage with live tool execution.
 *
 * New in v4.28.0:
 *   - Live Execute panel: select tool → fill params → run → see response
 *   - Ava connection status badge (calls GET /api/v1/mcp/ava/health)
 *   - Native tool indicators (green dot) vs Ava-only (blue dot)
 *   - Execution history (last 10 runs, in-memory this session)
 *   - Tool catalogue auto-fetched from GET /api/v1/mcp/tools (live + static merge)
 */

import React, { useState, useMemo, useEffect, useCallback } from 'react'
import { JARVIS_MCP_TOOLS, JARVIS_MCP_RESOURCES, MCP_CATEGORY_ORDER, MCP_CATEGORY_COLOR, type MCPTool } from '../constants/mcpTools'
import type { PolicyConfig } from '../modules/biz/dispatch'

// ─── Types ────────────────────────────────────────────────────────────────────

interface LiveTool extends MCPTool {
  live?: boolean
  ava_only?: boolean
}

interface ExecResult {
  id:        string
  tool:      string
  params:    Record<string, string>
  result:    unknown
  ok:        boolean
  ts:        string
  duration:  number
}

interface AvaHealth {
  healthy:  boolean
  reason?:  string
  version?: string
  tools?:   number
}

export interface MCPToolsPageProps {
  policy?: Partial<PolicyConfig>
}

// ─── Native tool set (matches api/routes/mcp.ts NATIVE_TOOLS) ─────────────────

const NATIVE_TOOL_NAMES = new Set([
  'http_fetch','audit_log','audit_query','model_call','embedding_create','session_create','session_resume',
  'knowledge.fix_search','knowledge.search','ask_domain',
])

// ─── Component ────────────────────────────────────────────────────────────────

export function MCPToolsPage({ policy: _p }: MCPToolsPageProps) {
  const [search,       setSearch]       = useState('')
  const [filterCat,    setFilterCat]    = useState<string>('')
  const [liveTools,    setLiveTools]    = useState<LiveTool[]>([])
  const [avaHealth,    setAvaHealth]    = useState<AvaHealth | null>(null)
  const [healthLoading,setHealthLoading]= useState(false)
  const [selectedTool, setSelectedTool] = useState<LiveTool | null>(null)
  const [execParams,   setExecParams]   = useState<Record<string, string>>({})
  const [executing,    setExecuting]    = useState(false)
  const [history,      setHistory]      = useState<ExecResult[]>([])
  const [activeTab,    setActiveTab]    = useState<'catalogue' | 'execute' | 'history'>('catalogue')
  const [expandedRes,  setExpandedRes]  = useState<string | null>(null)

  // ── Load live tool catalogue ───────────────────────────────────────────────

  const loadCatalogue = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/mcp/tools')
      if (res.ok) {
        const d = await res.json()
        setLiveTools((d.tools ?? []) as LiveTool[])
      }
    } catch {
      // Fall back to static catalogue
      setLiveTools(JARVIS_MCP_TOOLS.map(t => ({
        ...t,
        live:     NATIVE_TOOL_NAMES.has(t.name),
        ava_only: !NATIVE_TOOL_NAMES.has(t.name),
      })))
    }
  }, [])

  useEffect(() => { void loadCatalogue() }, [loadCatalogue])

  // ── Ava health check ──────────────────────────────────────────────────────

  const checkAvaHealth = useCallback(async () => {
    setHealthLoading(true)
    try {
      const res = await fetch('/api/v1/mcp/ava/health')
      if (res.ok) setAvaHealth(await res.json())
      else setAvaHealth({ healthy: false, reason: `HTTP ${res.status}` })
    } catch (e: unknown) {
      setAvaHealth({ healthy: false, reason: (e as Error).message })
    } finally {
      setHealthLoading(false)
    }
  }, [])

  useEffect(() => { void checkAvaHealth() }, [checkAvaHealth])

  // ── Merged + filtered catalogue ───────────────────────────────────────────

  const displayTools = useMemo(() => {
    // Merge live catalogue with static fallback (live wins on name conflict)
    const liveNames = new Set(liveTools.map(t => t.name))
    const merged: LiveTool[] = [
      ...liveTools,
      ...JARVIS_MCP_TOOLS
        .filter(t => !liveNames.has(t.name))
        .map(t => ({
          ...t,
          live:     NATIVE_TOOL_NAMES.has(t.name),
          ava_only: !NATIVE_TOOL_NAMES.has(t.name),
        })),
    ]
    return merged.filter(t => {
      const q = search.toLowerCase()
      if (q && !t.name.toLowerCase().includes(q) && !t.desc.toLowerCase().includes(q) &&
          !t.cat.toLowerCase().includes(q)) return false
      if (filterCat && t.cat !== filterCat) return false
      return true
    })
  }, [liveTools, search, filterCat])

  const byCategory = useMemo(() => {
    const map: Record<string, LiveTool[]> = {}
    for (const cat of MCP_CATEGORY_ORDER) map[cat] = []
    for (const t of displayTools) {
      if (!map[t.cat]) map[t.cat] = []
      map[t.cat].push(t)
    }
    return Object.entries(map).filter(([, tools]) => tools.length > 0)
  }, [displayTools])

  // ── Execute tool ─────────────────────────────────────────────────────────

  async function executeToolCall() {
    if (!selectedTool) return
    setExecuting(true)
    const start = Date.now()
    try {
      const res = await fetch('/api/v1/mcp/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: selectedTool.name,
          params: Object.fromEntries(
            Object.entries(execParams).filter(([, v]) => v.trim() !== '')
          ),
        }),
      })
      const data = await res.json()
      const entry: ExecResult = {
        id:       `exec_${Date.now()}`,
        tool:     selectedTool.name,
        params:   { ...execParams },
        result:   data,
        ok:       res.ok,
        ts:       new Date().toISOString(),
        duration: Date.now() - start,
      }
      setHistory(h => [entry, ...h].slice(0, 20))
      setActiveTab('history')
    } catch (e: unknown) {
      const entry: ExecResult = {
        id:       `exec_${Date.now()}`,
        tool:     selectedTool.name,
        params:   { ...execParams },
        result:   { error: (e as Error).message },
        ok:       false,
        ts:       new Date().toISOString(),
        duration: Date.now() - start,
      }
      setHistory(h => [entry, ...h].slice(0, 20))
    } finally {
      setExecuting(false)
    }
  }

  function selectToolForExec(tool: LiveTool) {
    setSelectedTool(tool)
    setExecParams(Object.fromEntries(tool.params.map(p => [p, ''])))
    setActiveTab('execute')
  }

  // ─────────────────────────────────────────────────────────────────────────

  const nativeCount  = displayTools.filter(t => t.live && !t.ava_only).length
  const avaCount     = displayTools.filter(t => t.ava_only).length

  return (
    <div role="main" aria-label="MCP Tools" style={{ maxWidth: 1100 }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>MCP Tool Browser</h2>
          <div style={{ fontSize: 12, color: 'var(--jarvis-ts)', marginTop: 4 }}>
            {displayTools.length} tools
            {nativeCount > 0 && <span style={{ marginLeft: 10 }}>
              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: 'var(--jarvis-grn)', marginRight: 4 }} />
              {nativeCount} native
            </span>}
            {avaCount > 0 && <span style={{ marginLeft: 10 }}>
              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: 'var(--jarvis-blue)', marginRight: 4 }} />
              {avaCount} via Ava
            </span>}
          </div>
        </div>

        {/* Ava health badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px',
            borderRadius: 20, fontSize: 12, fontWeight: 600,
            background: avaHealth === null ? 'var(--jarvis-bd)' : avaHealth.healthy ? '#D1FAE5' : '#FEE2E2',
            color: avaHealth === null ? 'var(--jarvis-ts)' : avaHealth.healthy ? '#065F46' : '#991B1B',
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%', display: 'inline-block',
              background: avaHealth?.healthy ? '#059669' : '#DC2626',
              animation: avaHealth?.healthy ? 'none' : 'none',
            }} />
            {avaHealth === null ? 'Checking Ava…' : avaHealth.healthy
              ? `Ava connected${avaHealth.tools ? ` · ${avaHealth.tools} tools` : ''}`
              : `Ava offline${avaHealth.reason ? ` · ${avaHealth.reason}` : ''}`}
          </div>
          <button className="jarvis-btn jarvis-btn-ghost" style={{ fontSize: 11, padding: '4px 10px' }}
            onClick={checkAvaHealth} disabled={healthLoading}>
            {healthLoading ? '…' : '↻ Ping'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '2px solid var(--jarvis-bd)' }}>
        {(['catalogue','execute','history'] as const).map(t => (
          <button key={t} onClick={() => setActiveTab(t)} style={{
            padding: '7px 18px', fontSize: 13, fontWeight: activeTab === t ? 700 : 400,
            background: 'none', border: 'none', cursor: 'pointer',
            borderBottom: activeTab === t ? '2px solid var(--jarvis-ac)' : '2px solid transparent',
            color: activeTab === t ? 'var(--jarvis-ac)' : 'var(--jarvis-ts)', marginBottom: -2,
          }}>
            {t === 'catalogue' ? '🔌 Catalogue' : t === 'execute' ? `⚡ Execute${selectedTool ? ` · ${selectedTool.name}` : ''}` : `📜 History${history.length > 0 ? ` (${history.length})` : ''}`}
          </button>
        ))}
      </div>

      {/* ── Catalogue tab ───────────────────────────────────────────────────── */}
      {activeTab === 'catalogue' && (
        <div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            <input className="jarvis-input" style={{ flex: 1, minWidth: 180 }} type="search"
              placeholder="Search tools…" value={search} onChange={e => setSearch(e.target.value)} />
            <select className="jarvis-input" style={{ width: 150 }} value={filterCat}
              onChange={e => setFilterCat(e.target.value)}>
              <option value="">All categories</option>
              {MCP_CATEGORY_ORDER.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {byCategory.map(([cat, tools]) => (
            <div key={cat} style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 12,
                  background: MCP_CATEGORY_COLOR[cat as keyof typeof MCP_CATEGORY_COLOR] ?? 'var(--jarvis-bd)',
                  color: '#fff',
                }}>
                  {cat}
                </span>
                <span className="jarvis-small" style={{ color: 'var(--jarvis-ts)' }}>{tools.length} tools</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
                {tools.map(tool => (
                  <div key={tool.name} className="jarvis-card" style={{ padding: 14, cursor: 'pointer', position: 'relative' }}
                    onClick={() => selectToolForExec(tool)}
                    role="button" tabIndex={0}
                    onKeyDown={e => e.key === 'Enter' && selectToolForExec(tool)}
                  >
                    {/* Live/Ava indicator */}
                    <div style={{ position: 'absolute', top: 10, right: 10 }}>
                      {tool.live && !tool.ava_only ? (
                        <span title="Native tool — runs in JARVIS API" style={{
                          fontSize: 9, padding: '1px 6px', borderRadius: 8, fontWeight: 700,
                          background: '#D1FAE5', color: '#065F46',
                        }}>NATIVE</span>
                      ) : (
                        <span title={avaHealth?.healthy ? 'Runs on Ava MCP server' : 'Requires Ava MCP server (offline)'} style={{
                          fontSize: 9, padding: '1px 6px', borderRadius: 8, fontWeight: 700,
                          background: avaHealth?.healthy ? '#DBEAFE' : '#F3F4F6',
                          color: avaHealth?.healthy ? '#1D4ED8' : '#9CA3AF',
                        }}>AVA</span>
                      )}
                    </div>
                    <div style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 12, fontWeight: 700, marginBottom: 6, paddingRight: 50 }}>
                      {tool.name}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--jarvis-ts)', marginBottom: 8 }}>{tool.desc}</div>
                    {tool.params.length > 0 && (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {tool.params.map(p => (
                          <code key={p} style={{
                            fontSize: 9, padding: '1px 5px', borderRadius: 3,
                            background: 'var(--jarvis-bg2)', color: 'var(--jarvis-ts)',
                            fontFamily: 'var(--jarvis-font-mono)',
                          }}>
                            {p}
                          </code>
                        ))}
                      </div>
                    )}
                    <div style={{ marginTop: 8, fontSize: 10, color: 'var(--jarvis-ac)', fontWeight: 600 }}>
                      Click to execute →
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {displayTools.length === 0 && (
            <div className="jarvis-empty">
              <span className="jarvis-empty-icon">🔌</span>
              <span>No tools match your search</span>
            </div>
          )}

          {/* MCP Resources */}
          <div style={{ marginTop: 32 }}>
            <h4 className="jarvis-label" style={{ marginBottom: 14 }}>MCP Resources</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
              {JARVIS_MCP_RESOURCES.map(resource => (
                <div key={resource.uri} className="jarvis-card" style={{ padding: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 11, fontWeight: 700 }}>{resource.name}</span>
                    <button className="jarvis-btn jarvis-btn-ghost" style={{ fontSize: 10, padding: '1px 6px' }}
                      onClick={() => setExpandedRes(expandedRes === resource.uri ? null : resource.uri)}>
                      {expandedRes === resource.uri ? '▲' : '▼'}
                    </button>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--jarvis-ts)', marginBottom: 6 }}>{resource.desc}</div>
                  <div style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 10, color: 'var(--jarvis-ts)' }}>{resource.uri}</div>
                  {expandedRes === resource.uri && (
                    <pre style={{
                      marginTop: 10, fontSize: 10, background: 'var(--jarvis-bg2)', borderRadius: 4,
                      padding: 8, overflow: 'auto', maxHeight: 160, whiteSpace: 'pre-wrap',
                    }}>
                      {JSON.stringify(resource.data, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Execute tab ──────────────────────────────────────────────────────── */}
      {activeTab === 'execute' && (
        <div>
          {!selectedTool ? (
            <div className="jarvis-empty">
              <span className="jarvis-empty-icon">⚡</span>
              <span>Select a tool from the Catalogue tab to execute it</span>
            </div>
          ) : (
            <div style={{ maxWidth: 600 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                <span style={{ fontFamily: 'var(--jarvis-font-mono)', fontSize: 18, fontWeight: 700 }}>
                  {selectedTool.name}
                </span>
                <span style={{
                  fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 700,
                  background: MCP_CATEGORY_COLOR[selectedTool.cat as keyof typeof MCP_CATEGORY_COLOR] ?? 'var(--jarvis-bd)',
                  color: '#fff',
                }}>
                  {selectedTool.cat}
                </span>
                {selectedTool.live && !selectedTool.ava_only && (
                  <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: '#D1FAE5', color: '#065F46', fontWeight: 700 }}>
                    NATIVE
                  </span>
                )}
                {selectedTool.ava_only && (
                  <span style={{
                    fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 700,
                    background: avaHealth?.healthy ? '#DBEAFE' : '#FEE2E2',
                    color: avaHealth?.healthy ? '#1D4ED8' : '#991B1B',
                  }}>
                    {avaHealth?.healthy ? 'AVA' : 'AVA — OFFLINE'}
                  </span>
                )}
              </div>

              <p style={{ fontSize: 13, color: 'var(--jarvis-ts)', marginBottom: 20 }}>{selectedTool.desc}</p>

              {!avaHealth?.healthy && selectedTool.ava_only && (
                <div style={{ padding: 12, background: '#FEF3C7', borderRadius: 6, marginBottom: 16, fontSize: 12 }}>
                  ⚠ This tool requires the Ava MCP server. Set <code>AVA_MCP_URL</code> in your backend environment and restart the API.
                </div>
              )}

              {selectedTool.params.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--jarvis-ts)' }}>No parameters required.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 20 }}>
                  {selectedTool.params.map(param => (
                    <div key={param}>
                      <label className="jarvis-small" htmlFor={`param-${param}`} style={{ display: 'block', marginBottom: 4 }}>
                        <code style={{ fontFamily: 'var(--jarvis-font-mono)' }}>{param}</code>
                      </label>
                      <textarea
                        id={`param-${param}`}
                        className="jarvis-input"
                        rows={param.includes('message') || param.includes('content') || param.includes('system') || param.includes('body') ? 4 : 1}
                        value={execParams[param] ?? ''}
                        onChange={e => setExecParams(p => ({...p, [param]: e.target.value}))}
                        placeholder={getParamHint(selectedTool.name, param)}
                        style={{ fontFamily: param.includes('json') || param.includes('body') ? 'var(--jarvis-font-mono)' : undefined }}
                      />
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  className="jarvis-btn jarvis-btn-primary"
                  onClick={executeToolCall}
                  disabled={executing}
                >
                  {executing ? '⏳ Executing…' : '⚡ Execute Tool'}
                </button>
                <button className="jarvis-btn jarvis-btn-ghost"
                  onClick={() => setActiveTab('catalogue')}>
                  ← Back to Catalogue
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── History tab ─────────────────────────────────────────────────────── */}
      {activeTab === 'history' && (
        <div>
          {history.length === 0 ? (
            <div className="jarvis-empty">
              <span className="jarvis-empty-icon">📜</span>
              <span>No executions this session</span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {history.map(entry => (
                <div key={entry.id} className="jarvis-card" style={{ padding: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontFamily: 'var(--jarvis-font-mono)', fontWeight: 700, fontSize: 13 }}>
                        {entry.tool}
                      </span>
                      <span style={{
                        fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 700,
                        background: entry.ok ? '#D1FAE5' : '#FEE2E2',
                        color: entry.ok ? '#065F46' : '#991B1B',
                      }}>
                        {entry.ok ? '✓ OK' : '✗ Error'}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--jarvis-ts)' }}>
                      {new Date(entry.ts).toLocaleTimeString()} · {entry.duration}ms
                    </div>
                  </div>

                  {Object.entries(entry.params).filter(([,v]) => v).length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 10, color: 'var(--jarvis-ts)', marginBottom: 4 }}>PARAMS</div>
                      {Object.entries(entry.params).filter(([,v]) => v).map(([k,v]) => (
                        <div key={k} style={{ fontSize: 11, fontFamily: 'var(--jarvis-font-mono)', marginBottom: 2 }}>
                          <span style={{ color: 'var(--jarvis-ts)' }}>{k}:</span>{' '}
                          <span>{String(v).slice(0, 120)}{String(v).length > 120 ? '…' : ''}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div>
                    <div style={{ fontSize: 10, color: 'var(--jarvis-ts)', marginBottom: 4 }}>RESULT</div>
                    <pre style={{
                      fontSize: 11, background: 'var(--jarvis-bg2)', borderRadius: 4,
                      padding: 10, overflow: 'auto', maxHeight: 200, whiteSpace: 'pre-wrap', margin: 0,
                    }}>
                      {JSON.stringify(entry.result, null, 2)}
                    </pre>
                  </div>

                  <button className="jarvis-btn jarvis-btn-ghost"
                    style={{ fontSize: 11, marginTop: 10 }}
                    onClick={() => {
                      const tool = [...liveTools, ...JARVIS_MCP_TOOLS].find(t => t.name === entry.tool)
                      if (tool) { setSelectedTool(tool as LiveTool); setExecParams(entry.params); setActiveTab('execute') }
                    }}>
                    ↩ Re-run
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Param hints ─────────────────────────────────────────────────────────────

function getParamHint(tool: string, param: string): string {
  const hints: Record<string, Record<string, string>> = {
    http_fetch:   { url: 'https://api.example.com/data', method: 'GET', body: '{"key":"value"}' },
    audit_log:    { action: 'manual_check', details: '{"note":"inspection complete"}' },
    audit_query:  { filter: 'mcp:', limit: '20' },
    model_call:   { messages: '[{"role":"user","content":"Hello"}]', max_tokens: '512', system: 'You are a helpful assistant.' },
    session_create: { name: 'commissioning-agent', system_prompt: 'You are a commissioning engineer…', model: 'claude-sonnet-4-6' },
    session_resume: { session_id: 'sess_…', message: 'Continue the inspection checklist.' },
  }
  return hints[tool]?.[param] ?? ''
}

export default MCPToolsPage
