/**
 * Denver Engineering — Microsoft Teams Connector
 * ────────────────────────────────────────────────
 * Delivers workflow notifications and approval requests to Microsoft Teams
 * via Incoming Webhooks and Adaptive Cards v1.5.
 *
 * Usage:
 *   const teams = createTeamsConnector({ webhookUrl: 'https://...' })
 *   await teams.sendNotification({ title: 'Budget Alert', body: '...', priority: 'high' })
 *   await teams.sendApprovalRequest({ title: 'CO-042 Approval', ... })
 *
 * Supports:
 *   - Incoming Webhook (channel messages, no app registration required)
 *   - Adaptive Cards v1.5 (rich layout with actions)
 *   - Approval workflow cards (Approve / Reject buttons)
 *   - Escalation alerts with severity colors
 *   - EVM status cards with metric tables
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import { slog } from '../../../src/modules/observability/index'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TeamsConfig {
  webhookUrl:     string   // Incoming Webhook URL from Teams channel settings
  timeout?:       number   // ms, default 10000
  tenantId?:      string   // for logging
}

export interface TeamsDeliveryResult {
  ok:      boolean
  error?:  string
  status?: number
}

export type TeamsPriority = 'critical' | 'high' | 'medium' | 'low' | 'info'

export interface TeamsNotification {
  title:       string
  body:        string
  priority?:   TeamsPriority
  projectName?: string
  projectId?:  string
  actionUrl?:  string
  actionLabel?: string
  fields?:     Array<{ label: string; value: string }>
}

export interface TeamsApprovalRequest {
  title:       string
  description: string
  requestedBy: string
  dueDate?:    string
  priority?:   TeamsPriority
  approveUrl:  string   // POST URL for approval (your API)
  rejectUrl:   string
  detailsUrl?: string
  fields?:     Array<{ label: string; value: string }>
}

export interface TeamsEscalation {
  title:       string
  body:        string
  severity:    'critical' | 'high' | 'medium'
  projectName?: string
  slaDeadline?: string
  assignee?:   string
  dashboardUrl?: string
}

export interface TeamsEvmCard {
  projectName:  string
  statusDate:   string
  cpi:          number
  spi:          number
  eac:          number
  bac:          number
  health:       'green' | 'yellow' | 'red'
  dashboardUrl?: string
}

// ─── Color palette ─────────────────────────────────────────────────────────────

const PRIORITY_COLOR: Record<TeamsPriority, string> = {
  critical: 'attention',   // red
  high:     'warning',     // orange
  medium:   'accent',      // blue
  low:      'good',        // green
  info:     'default',
}

const SEVERITY_HEX: Record<string, string> = {
  critical: '#D13438',
  high:     '#F7630C',
  medium:   '#FFB900',
}

const HEALTH_COLOR: Record<string, string> = {
  green:  'good',
  yellow: 'warning',
  red:    'attention',
}

// ─── Teams connector class ────────────────────────────────────────────────────

export class TeamsConnector {
  private readonly config: Required<TeamsConfig>

  constructor(config: TeamsConfig) {
    this.config = {
      webhookUrl: config.webhookUrl,
      timeout:    config.timeout ?? 10_000,
      tenantId:   config.tenantId ?? 'unknown',
    }
  }

  // ── Core: POST Adaptive Card to webhook ───────────────────────────────────

  async sendCard(card: object): Promise<TeamsDeliveryResult> {
    const payload = {
      type:        'message',
      attachments: [{
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl:  null,
        content:     card,
      }],
    }

    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), this.config.timeout)
      try {
        const resp = await fetch(this.config.webhookUrl, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(payload),
          signal:  ctrl.signal,
        })
        if (!resp.ok) {
          const text = await resp.text().catch(() => '')
          return { ok: false, status: resp.status, error: text.slice(0, 200) }
        }
        return { ok: true, status: resp.status }
      } finally {
        clearTimeout(timer)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      slog('WARN', 'teams', '[deliver] Network error', { tenantId: this.config.tenantId, error: msg })
      return { ok: false, error: `network_error: ${msg}` }
    }
  }

  // ── Notification card ─────────────────────────────────────────────────────

  async sendNotification(n: TeamsNotification): Promise<TeamsDeliveryResult> {
    const color   = PRIORITY_COLOR[n.priority ?? 'info']
    const factSet = n.fields?.map(f => ({ title: f.label, value: f.value })) ?? []
    if (n.projectName) factSet.unshift({ title: 'Project', value: n.projectName })

    const card = {
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      type:    'AdaptiveCard',
      version: '1.5',
      body: [
        {
          type:   'TextBlock',
          text:   n.title,
          weight: 'Bolder',
          size:   'Medium',
          color,
        },
        { type: 'TextBlock', text: n.body, wrap: true },
        ...(factSet.length > 0 ? [{
          type:  'FactSet',
          facts: factSet,
        }] : []),
      ],
      actions: n.actionUrl ? [{
        type:  'Action.OpenUrl',
        title: n.actionLabel ?? 'View in Denver Engineering',
        url:   n.actionUrl,
      }] : [],
    }

    return this.sendCard(card)
  }

  // ── Approval request card ─────────────────────────────────────────────────

  async sendApprovalRequest(req: TeamsApprovalRequest): Promise<TeamsDeliveryResult> {
    const color   = PRIORITY_COLOR[req.priority ?? 'medium']
    const factSet = [
      { title: 'Requested By', value: req.requestedBy },
      ...(req.dueDate ? [{ title: 'Due', value: req.dueDate }] : []),
      ...(req.fields ?? []).map(f => ({ title: f.label, value: f.value })),
    ]

    const card = {
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      type:    'AdaptiveCard',
      version: '1.5',
      body: [
        {
          type:   'TextBlock',
          text:   '✅ Approval Required',
          weight: 'Bolder',
          size:   'Small',
          color:  'accent',
        },
        {
          type:   'TextBlock',
          text:   req.title,
          weight: 'Bolder',
          size:   'Medium',
          color,
        },
        { type: 'TextBlock', text: req.description, wrap: true },
        { type: 'FactSet', facts: factSet },
      ],
      actions: [
        {
          type:  'Action.OpenUrl',
          title: '✅ Approve',
          url:   req.approveUrl,
          style: 'positive',
        },
        {
          type:  'Action.OpenUrl',
          title: '❌ Reject',
          url:   req.rejectUrl,
          style: 'destructive',
        },
        ...(req.detailsUrl ? [{
          type:  'Action.OpenUrl',
          title: 'View Details',
          url:   req.detailsUrl,
        }] : []),
      ],
    }

    return this.sendCard(card)
  }

  // ── Escalation alert ──────────────────────────────────────────────────────

  async sendEscalation(e: TeamsEscalation): Promise<TeamsDeliveryResult> {
    const hexColor = SEVERITY_HEX[e.severity] ?? '#F7630C'
    const factSet = [
      { title: 'Severity',  value: e.severity.toUpperCase() },
      ...(e.projectName  ? [{ title: 'Project',  value: e.projectName  }] : []),
      ...(e.slaDeadline  ? [{ title: 'SLA Due',  value: e.slaDeadline  }] : []),
      ...(e.assignee     ? [{ title: 'Assignee', value: e.assignee     }] : []),
    ]

    const card = {
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      type:    'AdaptiveCard',
      version: '1.5',
      msteams: { width: 'Full' },
      body: [
        {
          type:            'ColumnSet',
          bleed:           true,
          backgroundColor: hexColor,
          columns: [{
            type:  'Column',
            width: 'stretch',
            items: [{
              type:   'TextBlock',
              text:   `🚨 ${e.title}`,
              weight: 'Bolder',
              color:  'Light',
              size:   'Medium',
            }],
          }],
        },
        { type: 'TextBlock', text: e.body, wrap: true },
        { type: 'FactSet', facts: factSet },
      ],
      actions: e.dashboardUrl ? [{
        type:  'Action.OpenUrl',
        title: 'Open Dashboard',
        url:   e.dashboardUrl,
      }] : [],
    }

    return this.sendCard(card)
  }

  // ── EVM status card ───────────────────────────────────────────────────────

  async sendEvmStatusCard(evm: TeamsEvmCard): Promise<TeamsDeliveryResult> {
    const healthColor = HEALTH_COLOR[evm.health] ?? 'default'
    const healthEmoji = evm.health === 'green' ? '🟢' : evm.health === 'yellow' ? '🟡' : '🔴'
    const spend = evm.bac > 0 ? ((evm.eac / evm.bac - 1) * 100).toFixed(1) : '0'
    const spendLabel = parseFloat(spend) >= 0 ? `+${spend}%` : `${spend}%`

    const card = {
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      type:    'AdaptiveCard',
      version: '1.5',
      body: [
        {
          type:   'TextBlock',
          text:   `${healthEmoji} EVM Status — ${evm.projectName}`,
          weight: 'Bolder',
          size:   'Medium',
          color:  healthColor,
        },
        { type: 'TextBlock', text: `Status Date: ${evm.statusDate}`, isSubtle: true, size: 'Small' },
        {
          type:  'FactSet',
          facts: [
            { title: 'CPI',  value: evm.cpi.toFixed(2)  + (evm.cpi < 1 ? ' ⚠️' : ' ✅') },
            { title: 'SPI',  value: evm.spi.toFixed(2)  + (evm.spi < 1 ? ' ⚠️' : ' ✅') },
            { title: 'EAC',  value: `$${(evm.eac / 1000).toFixed(0)}K` },
            { title: 'BAC',  value: `$${(evm.bac / 1000).toFixed(0)}K` },
            { title: 'Variance', value: spendLabel },
          ],
        },
      ],
      actions: evm.dashboardUrl ? [{
        type:  'Action.OpenUrl',
        title: 'View EVM Dashboard',
        url:   evm.dashboardUrl,
      }] : [],
    }

    return this.sendCard(card)
  }
}

// ─── Factory function ─────────────────────────────────────────────────────────

export function createTeamsConnector(config: TeamsConfig): TeamsConnector {
  return new TeamsConnector(config)
}

// ─── Standalone webhook helper ────────────────────────────────────────────────

export async function sendTeamsWebhook(
  webhookUrl: string,
  title:      string,
  body:       string,
  opts:       Partial<TeamsNotification> = {},
): Promise<TeamsDeliveryResult> {
  const connector = new TeamsConnector({ webhookUrl })
  return connector.sendNotification({ title, body, ...opts })
}

// ─── Teams webhook signature verification ─────────────────────────────────────
// Used when Teams sends outgoing webhook callbacks to your API.
// https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-outgoing-webhook

export function verifyTeamsSignature(
  signingSecret: string,   // HMAC secret from Teams outgoing webhook configuration
  rawBody:       string,
  signature:     string,   // value of 'Authorization' header from Teams
): boolean {
  try {
    const expected = 'HMAC ' + createHmac('sha256', Buffer.from(signingSecret, 'base64'))
      .update(rawBody)
      .digest('base64')
    const a = Buffer.from(expected)
    const b = Buffer.from(signature)
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}
