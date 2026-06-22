/**
 * ProcessDesignView — AI-driven process engineering design surface.
 *
 * Chat interface that routes natural language to the 10 Ava EPC
 * process design MCP tools via /api/v1/mcp/execute, then has Claude
 * explain the results in structured HTML.
 */
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import DOMPurify from 'dompurify'

// AUD-007: assistant messages are raw HTML produced by the LLM and must be
// sanitized before rendering via dangerouslySetInnerHTML. Allow only
// presentational markup (incl. tables); strip scripts, event handlers, and
// dangerous URIs.
function sanitizeAssistantHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p', 'br', 'b', 'strong', 'i', 'em', 'u', 'span', 'div', 'code', 'pre',
      'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'hr',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
    ],
    ALLOWED_ATTR: ['class', 'colspan', 'rowspan'],
  })
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  toolUsed?: string
  rawData?: unknown
  warnings?: { code: string; severity: string; message: string }[]
}

type ToolId =
  | 'process_design_pwtp' | 'process_design_wwtp'
  | 'process_design_separator' | 'process_design_flash'
  | 'process_design_reactor' | 'process_design_mass_balance'
  | 'process_design_pump' | 'process_design_heat_exchanger'
  | 'process_design_vessel' | 'process_design_pipe'

interface ToolDef {
  id: ToolId
  name: string
  icon: string
  desc: string
  category: string
}

const TOOLS: ToolDef[] = [
  { id: 'process_design_pwtp', name: 'PWTP Design', icon: '💧', desc: 'Potable water treatment', category: 'Plant Design' },
  { id: 'process_design_wwtp', name: 'WWTP Design', icon: '🏭', desc: 'Wastewater treatment', category: 'Plant Design' },
  { id: 'process_design_separator', name: 'Separator', icon: '⚙️', desc: '2/3-phase separator', category: 'Oil & Gas' },
  { id: 'process_design_flash', name: 'Flash Calc', icon: '🔥', desc: 'VLE flash calculation', category: 'Oil & Gas' },
  { id: 'process_design_reactor', name: 'Reactor', icon: '⚗️', desc: 'CSTR / PFR / Batch', category: 'Reaction' },
  { id: 'process_design_mass_balance', name: 'Mass Balance', icon: '⚖️', desc: 'Flowsheet solver', category: 'Reaction' },
  { id: 'process_design_pump', name: 'Pump', icon: '🔄', desc: 'Darcy-Weisbach sizing', category: 'Equipment' },
  { id: 'process_design_heat_exchanger', name: 'Heat Exchanger', icon: '🌡️', desc: 'LMTD / NTU', category: 'Equipment' },
  { id: 'process_design_vessel', name: 'Vessel', icon: '🛢️', desc: 'ASME VIII Div 1', category: 'Equipment' },
  { id: 'process_design_pipe', name: 'Pipe', icon: '📏', desc: 'NPS selection', category: 'Equipment' },
]

const QUICK_PROMPTS = [
  'Design a 500 m³/h PWTP for surface water with 80 NTU turbidity',
  'Size a 3-phase separator for 5000 bbl/day oil, 2 MMSCFD gas at 200 psig',
  'Design a 10,000 m³/day WWTP with nitrification, influent BOD 250 mg/L',
  'Size a pump for 120 m³/h water, 200m of 150mm steel pipe, 30m static head',
  'CSTR for 1st-order reaction k=0.05/s, C₀=2 mol/L, 90% conversion, 5 L/s',
  'Shell-tube HX: hot 150→80°C at 5000 kg/h, cold 25°C water 8000 kg/h, U=500',
]

const SYSTEM_PROMPT = `You are an AI process design engineer inside Denver Engineering.
Your job: parse the user's natural language, determine which process design MCP tool to call, extract correct parameters, and output a tool call.

Available tools:
process_design_pwtp: { input: { designFlow (m³/h), peakFactor, rawWater: { turbidity, tds, ph, alkalinity, hardness, toc, iron, manganese, temperature, sourceType }, targets: { turbidity, residualCl2 } } }
process_design_wwtp: { input: { designFlow (m³/day), peakFactor, influent: { bod, cod, tss, tkn, tp, ph, temperature }, effluent: { bod, tss, nh3 }, processConfig: { primaryClarifier, biologicalProcess, nitrification, denitrification, bioP, tertiaryFiltration, disinfection, sludgeDigestion } } }
process_design_separator: { input: { type, orientation, oilFlowRate (bbl/day), gasFlowRate (MMSCFD), waterFlowRate, operatingPressure (psig), operatingTemperature (°F), oilSpecificGravity, gasSpecificGravity, oilViscosity (cp) } }
process_design_flash: { input: { feedComposition: [{component, moleFraction}], temperature (°F), pressure (psia) } }
process_design_reactor: { input: { reactorType, reactionOrder, rateConstant, initialConcentration (mol/L), targetConversion, feedFlowRate (L/s) } }
process_design_mass_balance: { input: { streams: [...], nodes: [...] } }
process_design_pump: { input: { flowRate (m³/h), fluidDensity, fluidViscosity (cP), staticHead (m), pipeDiameter (mm), pipeLength (m), pipeMaterial, fittingsK } }
process_design_heat_exchanger: { input: { method, hotInTemp, hotOutTemp, coldInTemp, hotFlowRate (kg/h), hotCp, coldFlowRate, coldCp, overallU (W/m²·K) } }
process_design_vessel: { input: { type, designPressure (kPa), designTemperature (°C), innerDiameter (mm), cylinderLength (mm), material, headType, corrosionAllowance, jointEfficiency } }
process_design_pipe: { input: { flowRate (m³/h), fluidDensity, fluidViscosity, material } }

Fill reasonable engineering defaults for unspecified params.
Reply with a brief sentence, then: \`\`\`tool\\n{"tool":"name","params":{"input":{...}}}\\n\`\`\`
If conversational, answer normally without a tool block.`

// ─── Component ───────────────────────────────────────────────────────────────

interface Props {
  onToast?: (msg: string, type?: string) => void
}

export default function ProcessDesignView({ onToast }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [selectedTool, setSelectedTool] = useState<ToolId | null>(null)
  const [expandedRaw, setExpandedRaw] = useState<Set<string>>(new Set())
  const scrollRef = useRef<HTMLDivElement>(null)

  const token = useMemo(() => {
    try { return localStorage.getItem('jarvis_token') || '' } catch { return '' }
  }, [])
  const headers = useMemo(() => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }), [token])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  const mcpExecute = useCallback(async (tool: string, params: Record<string, unknown>) => {
    const r = await fetch('/api/v1/mcp/execute', {
      method: 'POST', headers,
      body: JSON.stringify({ tool, params }),
    })
    if (!r.ok) throw new Error(`MCP execute failed: ${r.status}`)
    return r.json()
  }, [headers])

  async function send() {
    const q = input.trim()
    if (!q || busy) return
    setBusy(true)
    setInput('')

    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content: q }
    setMessages(prev => [...prev, userMsg])

    try {
      const toolHint = selectedTool ? `\nUser has selected: ${selectedTool}. Prefer this tool.` : ''

      // Step 1: AI plans the tool call
      const planResult = await mcpExecute('model_call', {
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: SYSTEM_PROMPT + toolHint,
        messages: [
          ...messages.filter(m => m.role !== 'system').slice(-10).map(m => ({
            role: m.role, content: m.content,
          })),
          { role: 'user', content: q },
        ],
      })

      const aiText: string = planResult.content?.[0]?.text || ''
      const toolMatch = aiText.match(/```tool\s*\n([\s\S]*?)\n```/)

      if (!toolMatch) {
        setMessages(prev => [...prev, {
          id: `a-${Date.now()}`, role: 'assistant', content: aiText,
        }])
        setBusy(false)
        return
      }

      const toolCall = JSON.parse(toolMatch[1])
      const toolName: string = toolCall.tool
      const toolParams = toolCall.params

      // Step 2: Execute process design tool
      const execResult = await mcpExecute(toolName, toolParams)

      // Step 3: Claude explains results
      const explainResult = await mcpExecute('model_call', {
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: 'You are a process engineer presenting calculation results. Format with clean HTML tables for numeric data. Highlight warnings in amber. Be concise. Use engineering units. Output raw HTML, not markdown.',
        messages: [
          { role: 'user', content: q },
          { role: 'assistant', content: `I ran ${toolName}:\n${JSON.stringify(execResult, null, 2)}` },
          { role: 'user', content: 'Present these results clearly with HTML tables. Flag warnings.' },
        ],
      })

      const explanation: string = explainResult.content?.[0]?.text || JSON.stringify(execResult, null, 2)

      const warnings = execResult?.warnings || execResult?.data?.warnings || []

      setMessages(prev => [...prev, {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: explanation,
        toolUsed: toolName,
        rawData: execResult,
        warnings: Array.isArray(warnings) ? warnings : [],
      }])
    } catch (e) {
      setMessages(prev => [...prev, {
        id: `e-${Date.now()}`, role: 'assistant',
        content: `Error: ${(e as Error).message}`,
      }])
      onToast?.((e as Error).message, 'error')
    }
    setBusy(false)
  }

  function toggleRaw(id: string) {
    setExpandedRaw(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const categories = [...new Set(TOOLS.map(t => t.category))]

  return (
    <div className="h-full flex bg-gray-950 text-gray-200">
      {/* ── Tool Sidebar ──────────────────────────────────── */}
      <div className="w-64 border-r border-gray-800 bg-gray-900 flex flex-col shrink-0">
        <div className="p-4 border-b border-gray-800">
          <h1 className="text-sm font-bold text-cyan-400">ProcessDesignPro</h1>
          <span className="text-[10px] text-gray-500">v1.0 — AI Process Engineering</span>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {categories.map(cat => (
            <React.Fragment key={cat}>
              <div className="text-[9px] font-bold uppercase tracking-widest text-gray-500 pt-3 pb-1 px-1">{cat}</div>
              {TOOLS.filter(t => t.category === cat).map(t => (
                <button key={t.id}
                  onClick={() => setSelectedTool(prev => prev === t.id ? null : t.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg border transition-all text-xs
                    ${selectedTool === t.id
                      ? 'border-cyan-500 bg-cyan-950/40'
                      : 'border-gray-800 bg-gray-800/50 hover:border-cyan-700'}`}>
                  <span className="mr-2">{t.icon}</span>
                  <span className="font-semibold">{t.name}</span>
                  <div className="text-[10px] text-gray-500 mt-0.5 ml-6">{t.desc}</div>
                </button>
              ))}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* ── Main Chat ─────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="px-5 py-3 border-b border-gray-800 bg-gray-900 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-semibold">AI Process Design</h2>
            <p className="text-[10px] text-gray-500">Describe your process — calculations run automatically via Ava EPC</p>
          </div>
          {selectedTool && (
            <span className="text-[10px] px-2 py-1 rounded bg-cyan-900/50 text-cyan-300 border border-cyan-800">
              {TOOLS.find(t => t.id === selectedTool)?.name}
            </span>
          )}
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.length === 0 && !busy && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center max-w-lg">
                <div className="text-4xl mb-3">🧪</div>
                <h3 className="text-base font-semibold mb-2">Describe your process — I'll design it.</h3>
                <p className="text-xs text-gray-500 mb-5">
                  Natural language in, engineering calculations out. Pick a tool on the left to hint, or let AI choose.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {QUICK_PROMPTS.map(p => (
                    <button key={p} onClick={() => { setInput(p); setTimeout(send, 50) }}
                      className="text-left text-[11px] p-3 rounded-lg border border-gray-800 bg-gray-800/30 text-gray-400 hover:border-cyan-700 hover:text-gray-200 transition-colors">
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {messages.map(m => (
            <div key={m.id} className={`max-w-[85%] ${m.role === 'user' ? 'ml-auto' : 'mr-auto'}`}>
              {m.role === 'user' ? (
                <div className="px-4 py-3 rounded-2xl rounded-br-sm bg-cyan-600 text-white text-sm">
                  {m.content}
                </div>
              ) : (
                <div className="px-4 py-4 rounded-2xl rounded-bl-sm bg-gray-800 border border-gray-700">
                  {m.toolUsed && (
                    <div className="text-[9px] font-bold uppercase tracking-wider text-cyan-400 mb-2">
                      {m.toolUsed.replace('process_design_', '').replace(/_/g, ' ')}
                    </div>
                  )}
                  <div className="text-sm leading-relaxed prose-invert [&_table]:w-full [&_table]:text-xs [&_table]:border-collapse [&_th]:text-left [&_th]:p-1.5 [&_th]:border-b [&_th]:border-gray-600 [&_th]:text-cyan-400 [&_th]:text-[10px] [&_th]:uppercase [&_td]:p-1.5 [&_td]:border-b [&_td]:border-gray-700/50"
                    dangerouslySetInnerHTML={{ __html: sanitizeAssistantHtml(m.content) }} />

                  {m.warnings && m.warnings.length > 0 && (
                    <div className="mt-3 space-y-1">
                      {m.warnings.map((w, i) => (
                        <div key={i} className={`text-[11px] px-3 py-2 rounded border
                          ${w.severity === 'CRITICAL' ? 'bg-red-950/50 border-red-800 text-red-300' :
                            w.severity === 'WARNING' ? 'bg-amber-950/50 border-amber-800 text-amber-300' :
                            'bg-blue-950/50 border-blue-800 text-blue-300'}`}>
                          <strong>{w.code}</strong>: {w.message}
                        </div>
                      ))}
                    </div>
                  )}

                  {m.rawData !== undefined && (
                    <div className="mt-3">
                      <button onClick={() => toggleRaw(m.id)}
                        className="text-[10px] text-gray-500 hover:text-gray-300">
                        {expandedRaw.has(m.id) ? '▼' : '▶'} Raw JSON
                      </button>
                      {expandedRaw.has(m.id) && (
                        <pre className="mt-2 p-3 bg-gray-900 rounded text-[10px] overflow-x-auto border border-gray-700 max-h-64 overflow-y-auto">
                          {JSON.stringify(m.rawData, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {busy && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <span className="inline-block w-4 h-4 border-2 border-gray-600 border-t-cyan-400 rounded-full animate-spin" />
              Running process design calculations…
            </div>
          )}
        </div>

        <div className="p-4 border-t border-gray-800 bg-gray-900 shrink-0">
          <form onSubmit={e => { e.preventDefault(); send() }} className="flex gap-3">
            <textarea value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() } }}
              placeholder="Describe your process design problem… (⌘+Enter to send)"
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-gray-200 resize-none placeholder-gray-500 focus:outline-none focus:border-cyan-600"
              rows={2} />
            <button type="submit" disabled={!input.trim() || busy}
              className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-sm font-semibold disabled:opacity-40 transition-colors">
              Send
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
