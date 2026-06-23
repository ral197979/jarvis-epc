/**
 * Denver Engineering — Slack Integration Connector (v1.0.0)
 * ──────────────────────────────────────────────────────────
 * Real Slack integration: incoming webhooks + Events API.
 *
 * Supported delivery modes:
 *   1. Incoming Webhook URL (per-channel, no OAuth required)
 *   2. Bot Token (workspace-level, requires Slack app install)
 *
 * Features:
 *   - Workflow action notifications (RFI, punch item, SLA breach)
 *   - Approval request cards with approve/reject buttons
 *   - Escalation alerts with project + assignee context
 *   - Rich Block Kit message formatting
 *
 * Configuration (per integration record):
 *   config.webhook_url    — Incoming Webhook URL
 *   config.bot_token      — xoxb-* Bot OAuth token (optional, for chat.postMessage)
 *   config.channel        — Channel ID (used with bot_token)
 *   config.signing_secret — For verifying Slack event payloads
 *
 * Usage:
 *   const connector = new SlackConnector({ webhook_url: '...', ... })
 *   await connector.sendWorkflowNotification({ ... })
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SlackConfig {
  webhook_url?:    string   // Incoming webhook URL (required for webhook delivery)
  bot_token?:      string   // xoxb-* OAuth token (for chat.postMessage API)
  channel?:        string   // Channel ID when using bot_token
  signing_secret?: string   // For verifying incoming Slack events
}

export interface WorkflowNotification {
  type:        'rfi_created' | 'punch_item' | 'approval_required' | 'sla_breach' | 'action_overdue' | 'general'
  title:       string
  body:        string
  projectName: string
  priority?:   'low' | 'medium' | 'high' | 'critical'
  assignee?:   string
  dueAt?:      string   // ISO date string
  link?:       string   // Deep link into the platform
  actionId?:   string
}

export interface ApprovalRequest {
  title:       string
  description: string
  requestedBy: string
  projectName: string
  actionId:    string
  callbackUrl: string   // Platform URL to POST approve/reject response
}

export interface SlackDeliveryResult {
  ok:         boolean
  statusCode: number
  body:       string
  error?:     string
}

// ─── Priority color mapping ───────────────────────────────────────────────────

const PRIORITY_COLOR: Record<string, string> = {
  critical: '#ef4444',   // red
  high:     '#f97316',   // orange
  medium:   '#eab308',   // yellow
  low:      '#22c55e',   // green
}

const TYPE_EMOJI: Record<string, string> = {
  rfi_created:       ':envelope_with_arrow:',
  punch_item:        ':white_check_mark:',
  approval_required: ':hourglass_flowing_sand:',
  sla_breach:        ':rotating_light:',
  action_overdue:    ':warning:',
  general:           ':bell:',
}

// ─── SlackConnector ───────────────────────────────────────────────────────────

export class SlackConnector {
  private readonly config: SlackConfig

  constructor(config: SlackConfig) {
    if (!config.webhook_url && !config.bot_token) {
      throw new Error('SlackConnector requires either webhook_url or bot_token')
    }
    this.config = config
  }

  // ── Send to incoming webhook ────────────────────────────────────────────────

  async sendToWebhook(payload: object): Promise<SlackDeliveryResult> {
    const url = this.config.webhook_url
    if (!url) return { ok: false, statusCode: 0, body: '', error: 'No webhook_url configured' }

    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })
    const body = await res.text()
    return {
      ok:         res.ok,
      statusCode: res.status,
      body,
      error:      res.ok ? undefined : body,
    }
  }

  // ── Post via Bot Token (chat.postMessage) ────────────────────────────────────

  async postMessage(channel: string, payload: object): Promise<SlackDeliveryResult> {
    const token = this.config.bot_token
    if (!token) return { ok: false, statusCode: 0, body: '', error: 'No bot_token configured' }

    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ channel, ...payload }),
    })
    const json = await res.json() as { ok: boolean; error?: string }
    return {
      ok:         json.ok,
      statusCode: res.status,
      body:       JSON.stringify(json),
      error:      json.ok ? undefined : json.error,
    }
  }

  // ── Deliver to configured destination ────────────────────────────────────────

  async deliver(payload: object): Promise<SlackDeliveryResult> {
    if (this.config.bot_token && this.config.channel) {
      return this.postMessage(this.config.channel, payload)
    }
    return this.sendToWebhook(payload)
  }

  // ── sendWorkflowNotification ────────────────────────────────────────────────

  async sendWorkflowNotification(n: WorkflowNotification): Promise<SlackDeliveryResult> {
    const color   = PRIORITY_COLOR[n.priority ?? 'medium']!
    const emoji   = TYPE_EMOJI[n.type]!
    const fields: object[] = [
      { type: 'mrkdwn', text: `*Project*\n${n.projectName}` },
    ]

    if (n.assignee) {
      fields.push({ type: 'mrkdwn', text: `*Assignee*\n${n.assignee}` })
    }
    if (n.dueAt) {
      const due = new Date(n.dueAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      fields.push({ type: 'mrkdwn', text: `*Due*\n${due}` })
    }
    if (n.priority) {
      fields.push({ type: 'mrkdwn', text: `*Priority*\n${n.priority.charAt(0).toUpperCase() + n.priority.slice(1)}` })
    }

    const blocks: object[] = [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `${emoji} *${n.title}*` },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: n.body },
      },
    ]

    if (fields.length > 0) {
      blocks.push({ type: 'section', fields })
    }

    if (n.link) {
      blocks.push({
        type: 'actions',
        elements: [{
          type:      'button',
          text:      { type: 'plain_text', text: 'View in Denver Engineering' },
          url:       n.link,
          style:     n.priority === 'critical' ? 'danger' : 'primary',
          action_id: `view_${n.actionId ?? 'unknown'}`,
        }],
      })
    }

    const payload = {
      attachments: [{
        color,
        blocks,
        fallback: `${n.title} — ${n.body}`,
      }],
    }

    return this.deliver(payload)
  }

  // ── sendApprovalRequest ─────────────────────────────────────────────────────

  async sendApprovalRequest(req: ApprovalRequest): Promise<SlackDeliveryResult> {
    const payload = {
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: ':hourglass_flowing_sand: Approval Required' },
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*${req.title}*\n${req.description}` },
          fields: [
            { type: 'mrkdwn', text: `*Project*\n${req.projectName}` },
            { type: 'mrkdwn', text: `*Requested by*\n${req.requestedBy}` },
          ],
        },
        {
          type: 'actions',
          block_id: `approval_${req.actionId}`,
          elements: [
            {
              type:      'button',
              text:      { type: 'plain_text', text: 'Approve' },
              style:     'primary',
              action_id: `approve_${req.actionId}`,
              value:     req.actionId,
              confirm: {
                title:   { type: 'plain_text', text: 'Confirm Approval' },
                text:    { type: 'mrkdwn', text: `Approve: *${req.title}*?` },
                confirm: { type: 'plain_text', text: 'Yes, approve' },
                deny:    { type: 'plain_text', text: 'Cancel' },
              },
            },
            {
              type:      'button',
              text:      { type: 'plain_text', text: 'Reject' },
              style:     'danger',
              action_id: `reject_${req.actionId}`,
              value:     req.actionId,
            },
          ],
        },
      ],
    }

    return this.deliver(payload)
  }

  // ── sendEscalationAlert ─────────────────────────────────────────────────────

  async sendEscalationAlert(params: {
    actionTitle:  string
    projectName:  string
    escalatedTo:  string
    reason:       string
    hoursOverdue: number
    link?:        string
  }): Promise<SlackDeliveryResult> {
    const payload = {
      attachments: [{
        color: '#ef4444',  // red — always critical
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `:rotating_light: *SLA Escalation: ${params.actionTitle}*\n` +
                    `Project: *${params.projectName}* | Overdue: *${params.hoursOverdue}h* | ` +
                    `Escalated to: *${params.escalatedTo}*\n\nReason: ${params.reason}`,
            },
          },
          ...(params.link ? [{
            type: 'actions',
            elements: [{
              type:      'button',
              text:      { type: 'plain_text', text: 'View Action' },
              url:       params.link,
              action_id: 'view_escalation',
            }],
          }] : []),
        ],
        fallback: `SLA Escalation: ${params.actionTitle} is ${params.hoursOverdue}h overdue`,
      }],
    }

    return this.deliver(payload)
  }

  // ── verifySlackSignature ─────────────────────────────────────────────────────
  // Verifies that an incoming Slack event originated from Slack's servers.

  verifySignature(
    signingSecret: string,
    rawBody:       string,
    timestamp:     string,
    signature:     string,
  ): boolean {
    const signingSecret_ = this.config.signing_secret ?? signingSecret
    if (!signingSecret_) return false

    // Reject requests older than 5 minutes (replay attack prevention)
    const now = Math.floor(Date.now() / 1000)
    if (Math.abs(now - parseInt(timestamp, 10)) > 300) return false

    const baseString = `v0:${timestamp}:${rawBody}`
    const hmac       = createHmac('sha256', signingSecret_)
      .update(baseString)
      .digest('hex')
    const expected = Buffer.from(`v0=${hmac}`)
    const received = Buffer.from(signature)

    if (expected.length !== received.length) return false
    return timingSafeEqual(expected, received)
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createSlackConnector(config: SlackConfig): SlackConnector {
  return new SlackConnector(config)
}

// ─── Quick-send helper (one-off webhook) ─────────────────────────────────────

export async function sendSlackWebhook(
  webhookUrl: string,
  text:       string,
  opts:       { color?: string; title?: string } = {},
): Promise<SlackDeliveryResult> {
  const connector = new SlackConnector({ webhook_url: webhookUrl })
  return connector.sendToWebhook({
    attachments: [{
      color:    opts.color ?? '#3b82f6',
      pretext:  opts.title,
      text,
      fallback: text,
    }],
  })
}
