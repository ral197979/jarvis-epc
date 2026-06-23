import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Button, Icon, Avatar, Badge, cn } from '@ds'
import { usePortfolioInsights } from '@adapters'

interface Source {
  label: string
  path: string
}
interface Suggested {
  label: string
  path: string
}
interface Message {
  role: 'user' | 'assistant'
  text: string
  phase?: 'tools' | 'typing' | 'done'
  steps?: string[]
  stepIdx?: number
  sources?: Source[]
  actions?: Suggested[]
}

const SUGGESTIONS = [
  'Summarize commissioning readiness for Gulf Coast LNG',
  'Which procurement items threaten the Oct turnover?',
  'Where is my biggest cost variance and why?',
  'Draft an FPT script for the chilled water system',
]

const CAPABILITIES = [
  { icon: 'insights', label: 'Project Analysis' },
  { icon: 'warning', label: 'Risk Analysis' },
  { icon: 'event', label: 'Schedule Analysis' },
  { icon: 'local_shipping', label: 'Procurement Delays' },
  { icon: 'precision_manufacturing', label: 'Cx Readiness' },
  { icon: 'description', label: 'Doc Summaries' },
  { icon: 'checklist', label: 'Action Generation' },
  { icon: 'science', label: 'Script Generation' },
]

interface Answer {
  steps: string[]
  text: string
  sources: Source[]
  actions: Suggested[]
}

function generateAnswer(q: string): Answer {
  const s = q.toLowerCase()
  if (/procure|vendor|turbine|delay|long.?lead|po\b/.test(s)) {
    return {
      steps: ['Querying procurement (124 POs)…', 'Cross-referencing long-lead schedule…', 'Assessing turnover impact…'],
      text: 'The critical exposure is PO-4510-14 (Siemens gas turbine generators), tracking ~6 weeks late against a Dec 1 ETA. This jeopardizes the RFSU milestone and, downstream, the Oct turnover for the Medium Voltage system. Dual-sourcing the secondary lot recovers ~3 weeks of float.',
      sources: [{ label: 'PO-4510-14', path: '/procurement' }, { label: 'Long-Lead Tracker', path: '/procurement' }],
      actions: [{ label: 'Open expediting actions', path: '/actions' }, { label: 'Review procurement board', path: '/procurement' }],
    }
  }
  if (/commission|fpt|ist|turnover|readiness|pfc|deficien/.test(s)) {
    return {
      steps: ['Reading completion matrix (210 systems)…', 'Scanning 124 deficiencies…', 'Computing readiness forecast…'],
      text: 'Overall commissioning completion is 78.4%. Electrical (62%) lags Mechanical (84%); at the current loop-check rate, IST sequencing slips ~9 days past the Oct turnover target. 42 critical (Cat A) deficiencies remain open, concentrated in Medium Voltage. Adding a second loop-check crew for 3 weeks closes the gap.',
      sources: [{ label: 'Completion Matrix', path: '/commissioning' }, { label: 'Deficiency Registry', path: '/commissioning' }, { label: 'IST Orchestration', path: '/commissioning' }],
      actions: [{ label: 'Create "add loop-check crew" action', path: '/actions' }, { label: 'Open deficiency registry', path: '/commissioning' }],
    }
  }
  if (/risk|variance|cost|budget|cpi|spi|evm|finance/.test(s)) {
    return {
      steps: ['Pulling EVM metrics…', 'Decomposing variance by WBS…', 'Ranking risk drivers…'],
      text: 'CPI is 0.94 (over budget) and SPI 0.92 (behind schedule). The primary drag is I&C (WBS-400) at CPI 0.89, followed by Mechanical (WBS-200). Combined variance at completion is trending to -$1.42M. Re-baselining the loop-check scope recovers ~$0.4M.',
      sources: [{ label: 'EVM Dashboard', path: '/finance' }, { label: 'WBS Breakdown', path: '/finance' }],
      actions: [{ label: 'Initiate RFC', path: '/finance' }, { label: 'View analytics', path: '/analytics' }],
    }
  }
  if (/schedule|milestone|rfsu|late|forecast/.test(s)) {
    return {
      steps: ['Loading milestones…', 'Evaluating critical path…'],
      text: 'Mechanical Completion (Sep 30) is on track, but Ready-For-Start-Up (Nov 15) is at risk — driven by the turbine PO slip and electrical loop-check rate. Substantial Completion (Jan 20) retains ~2 weeks of float if mitigations land this month.',
      sources: [{ label: 'Project Workspace', path: '/projects/PRJ-2024-004' }],
      actions: [{ label: 'Open project milestones', path: '/projects/PRJ-2024-004' }],
    }
  }
  return {
    steps: ['Aggregating portfolio signals…', 'Synthesizing…'],
    text: 'Across the portfolio, the dominant theme is long-lead procurement risk in the Gulf region cascading into commissioning readiness. Gulf Coast LNG is the critical project: cost overrun, 42 open Cat A deficiencies, and a turbine PO slip. I can drill into procurement, commissioning, or finance — just ask.',
    sources: [{ label: 'Executive Dashboard', path: '/' }, { label: 'Analytics', path: '/analytics' }],
    actions: [{ label: 'Open analytics', path: '/analytics' }],
  }
}

export function AiCopilotPage() {
  const navigate = useNavigate()
  const { data: insights } = usePortfolioInsights()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const updateLast = (fn: (m: Message) => Message) =>
    setMessages((prev) => prev.map((m, i) => (i === prev.length - 1 ? fn(m) : m)))

  const send = (text: string) => {
    if (!text.trim() || busy) return
    const answer = generateAnswer(text)
    setInput('')
    setBusy(true)
    setMessages((prev) => [
      ...prev,
      { role: 'user', text },
      { role: 'assistant', text: '', phase: 'tools', steps: answer.steps, stepIdx: 0 },
    ])

    let t = 0
    // 1) tool-use steps
    answer.steps.forEach((_, i) => {
      timers.current.push(setTimeout(() => updateLast((m) => ({ ...m, stepIdx: i + 1 })), (t += 650)))
    })
    // 2) stream the answer text
    timers.current.push(
      setTimeout(() => {
        updateLast((m) => ({ ...m, phase: 'typing' }))
        const chars = answer.text.split('')
        chars.forEach((_, i) => {
          timers.current.push(
            setTimeout(() => updateLast((m) => ({ ...m, text: answer.text.slice(0, i + 1) })), i * 14),
          )
        })
        // 3) finalize with sources + actions
        timers.current.push(
          setTimeout(() => {
            updateLast((m) => ({ ...m, phase: 'done', sources: answer.sources, actions: answer.actions }))
            setBusy(false)
          }, chars.length * 14 + 100),
        )
      }, t + 300),
    )
  }

  return (
    <div className="grid h-[calc(100vh-140px)] grid-cols-12 gap-lg">
      <Card className="col-span-12 flex flex-col overflow-hidden lg:col-span-8">
        <div className="flex items-center gap-2 border-b border-outline-variant p-md">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-white"><Icon name="smart_toy" filled size={20} /></div>
          <div>
            <h2 className="text-headline-sm font-bold text-primary">AI Copilot</h2>
            <p className="text-body-sm text-on-surface-variant">Grounded on your live project corpus (RAG)</p>
          </div>
          <Badge tone="success" dot className="ml-auto">Online</Badge>
        </div>

        <div ref={scrollRef} className="custom-scrollbar flex-1 space-y-4 overflow-y-auto p-md">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-white"><Icon name="auto_awesome" filled size={28} /></div>
              <h3 className="text-headline-sm font-bold text-primary">How can I help with your program?</h3>
              <p className="mb-lg mt-1 max-w-md text-body-sm text-on-surface-variant">Ask about risk, schedule, procurement, or commissioning readiness — I cite the records I used.</p>
              <div className="grid w-full max-w-xl grid-cols-1 gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => send(s)} className="rounded-lg border border-outline-variant bg-background p-3 text-left text-body-sm text-on-surface transition-colors hover:border-secondary hover:bg-surface-container-low">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => (
              <div key={i} className={cn('flex gap-3', m.role === 'user' && 'flex-row-reverse')}>
                {m.role === 'assistant' ? (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-white"><Icon name="smart_toy" filled size={18} /></div>
                ) : (
                  <Avatar name="Alex Sterling" />
                )}
                <div className={cn('max-w-[80%] space-y-2', m.role === 'user' && 'flex flex-col items-end')}>
                  {/* tool-use trace */}
                  {m.role === 'assistant' && m.phase === 'tools' && (
                    <div className="space-y-1 rounded-xl bg-surface-container-low px-4 py-3">
                      {m.steps?.slice(0, m.stepIdx ?? 0).map((step, si) => (
                        <div key={si} className="flex items-center gap-2 text-body-sm text-on-surface-variant">
                          <Icon name="check_circle" size={14} className="text-success" /> {step}
                        </div>
                      ))}
                      <div className="flex items-center gap-2 text-body-sm text-secondary">
                        <Icon name="progress_activity" size={14} className="animate-spin" /> Thinking…
                      </div>
                    </div>
                  )}
                  {/* answer bubble */}
                  {(m.role === 'user' || m.phase === 'typing' || m.phase === 'done') && (
                    <div className={cn('rounded-xl px-4 py-2.5 text-body-md', m.role === 'user' ? 'bg-secondary text-on-secondary' : 'bg-surface-container-low text-on-surface')}>
                      {m.text}
                      {m.phase === 'typing' && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-secondary align-middle" />}
                    </div>
                  )}
                  {/* sources */}
                  {m.phase === 'done' && m.sources && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono-tag text-label-sm uppercase text-on-surface-variant">Sources:</span>
                      {m.sources.map((src) => (
                        <button key={src.label} onClick={() => navigate(src.path)} className="inline-flex items-center gap-1 rounded-full bg-secondary/10 px-2 py-0.5 text-body-sm font-medium text-secondary hover:bg-secondary/20">
                          <Icon name="link" size={13} /> {src.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {/* suggested actions */}
                  {m.phase === 'done' && m.actions && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {m.actions.map((a) => (
                        <Button key={a.label} size="sm" variant="secondary" onClick={() => navigate(a.path)}>
                          <Icon name="bolt" size={16} /> {a.label}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="border-t border-outline-variant p-md">
          <div className="flex items-center gap-2 rounded-lg border border-outline-variant bg-background px-3 focus-within:border-secondary">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send(input)}
              placeholder={busy ? 'Copilot is responding…' : 'Ask the Copilot…'}
              disabled={busy}
              className="h-11 flex-1 bg-transparent text-body-md outline-none placeholder:text-on-surface-variant disabled:opacity-60"
            />
            <Button variant="accent" size="icon" onClick={() => send(input)} disabled={busy}><Icon name="send" size={18} /></Button>
          </div>
        </div>
      </Card>

      <div className="col-span-12 space-y-lg lg:col-span-4">
        <Card className="p-lg">
          <h3 className="mb-md text-headline-sm font-bold text-primary">Capabilities</h3>
          <div className="grid grid-cols-2 gap-2">
            {CAPABILITIES.map((c) => (
              <div key={c.label} className="flex items-center gap-2 rounded-lg bg-surface-container-low p-2.5 text-body-sm">
                <Icon name={c.icon} size={18} className="text-secondary" /> {c.label}
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-lg">
          <h3 className="mb-md text-headline-sm font-bold text-primary">Live Insights</h3>
          <div className="space-y-3">
            {insights?.map((i) => (
              <div key={i.id} className="rounded-lg border border-outline-variant border-l-4 border-l-secondary bg-background p-3">
                <div className="text-body-sm font-bold text-primary">{i.title}</div>
                <p className="mt-0.5 text-body-sm text-on-surface-variant">{i.recommendation}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
