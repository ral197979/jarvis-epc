/**
 * Denver Engineering — Owner / Board Narrative Report (v4.58.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Vision Phase 11 — "Executive Copilot: generate board reports, owner reports,
 * weekly summaries." Composes a deterministic, copy-pasteable narrative from the
 * already-shipped deterministic services (Executive briefing + Cost IQ + Safety +
 * NCR). The prose is templated over verified numbers — never an LLM — so the
 * report is testable and unhallucinated. An LLM "polish" pass can wrap it later.
 */
import { buildProjectReport } from './executiveReportService'
import { buildCostIntelligence } from '../costControl/costIntelligenceService'
import { buildSafetyIntelligence } from '../safety/safetyService'
import { buildNcrSummary } from '../quality/ncrService'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NarrativeInputs {
  project: { name: string | null; code: string | null }
  health: { score: number; status: string }
  executiveHeadline: string
  scheduleBody: string | null
  costHeadline: string | null
  costRisk: string | null
  quality?: { openNcrs: number; openCritical: number; overdueCapas: number } | null
  safety?: { riskIndex: number; riskLevel: string; recordables: number; nearMisses: number } | null
  recommendations: string[]
}
export interface NarrativeSection { heading: string; body: string }
export interface NarrativeReport {
  title: string
  generatedAt: string
  sections: NarrativeSection[]
  markdown: string
}

const STATUS_LABEL: Record<string, string> = { on_track: 'On Track', watch: 'Watch', at_risk: 'At Risk', critical: 'Critical' }

// ─── Pure composition ─────────────────────────────────────────────────────────

export function composeNarrative(inp: NarrativeInputs, now: Date = new Date()): NarrativeReport {
  const name = inp.project.name ?? inp.project.code ?? 'Project'
  const statusLabel = STATUS_LABEL[inp.health.status] ?? inp.health.status
  const sections: NarrativeSection[] = []

  sections.push({ heading: 'Executive Summary', body: `${inp.executiveHeadline} Overall health is ${inp.health.score}/100 (${statusLabel}).` })

  if (inp.scheduleBody) sections.push({ heading: 'Schedule', body: inp.scheduleBody })

  if (inp.costHeadline) {
    const riskNote = inp.costRisk && inp.costRisk !== 'low' ? ` Cost overrun risk is ${inp.costRisk}.` : ''
    sections.push({ heading: 'Cost', body: `${inp.costHeadline}${riskNote}` })
  }

  const qa: string[] = []
  if (inp.quality) qa.push(`${inp.quality.openNcrs} open NCR${inp.quality.openNcrs === 1 ? '' : 's'} (${inp.quality.openCritical} critical), ${inp.quality.overdueCapas} overdue corrective action${inp.quality.overdueCapas === 1 ? '' : 's'}.`)
  if (inp.safety) qa.push(`Safety risk index ${inp.safety.riskIndex}/100 (${inp.safety.riskLevel}) — ${inp.safety.recordables} recordable${inp.safety.recordables === 1 ? '' : 's'}, ${inp.safety.nearMisses} near-miss${inp.safety.nearMisses === 1 ? '' : 'es'}.`)
  if (qa.length) sections.push({ heading: 'Quality & Safety', body: qa.join(' ') })

  if (inp.recommendations.length) {
    sections.push({ heading: 'Recommended Actions', body: inp.recommendations.map((r, i) => `${i + 1}. ${r}`).join('\n') })
  }

  const dateStr = now.toISOString().slice(0, 10)
  const markdown = `# ${name} — Owner Report\n\n_Generated ${dateStr}_\n\n` +
    sections.map(s => `## ${s.heading}\n\n${s.body}`).join('\n\n') + '\n'

  return { title: `${name} — Owner Report`, generatedAt: now.toISOString(), sections, markdown }
}

// ─── DB-backed builder ────────────────────────────────────────────────────────

export async function buildNarrativeReport(tenantId: string, projectId: string, now: Date = new Date()): Promise<NarrativeReport | null> {
  const exec = await buildProjectReport(tenantId, projectId, now)
  if (!exec) return null

  const [cost, safety, ncr] = await Promise.all([
    buildCostIntelligence(tenantId, projectId).catch(() => null),
    buildSafetyIntelligence(tenantId, projectId, now).catch(() => null),
    buildNcrSummary(tenantId, projectId, now).catch(() => null),
  ])

  const scheduleBody = exec.sections.find(s => s.id === 'schedule')?.body ?? null

  return composeNarrative({
    project: { name: exec.project.name, code: exec.project.code },
    health: { score: exec.healthScore, status: exec.healthStatus },
    executiveHeadline: exec.headline,
    scheduleBody,
    costHeadline: cost?.headline ?? null,
    costRisk: cost?.overrunRisk ?? null,
    quality: ncr ? { openNcrs: ncr.totals.open, openCritical: ncr.totals.openCritical, overdueCapas: ncr.overdueCapas } : null,
    safety: safety ? { riskIndex: safety.leadingIndicators.riskIndex, riskLevel: safety.leadingIndicators.riskLevel, recordables: safety.leadingIndicators.recordables, nearMisses: safety.leadingIndicators.nearMisses } : null,
    recommendations: exec.recommendedActions,
  }, now)
}
