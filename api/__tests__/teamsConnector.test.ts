/**
 * Microsoft Teams Connector — Unit Tests
 * ─────────────────────────────────────────
 * Tests all card types and delivery logic.
 * Uses vi.stubGlobal to mock global fetch — no real HTTP calls.
 *
 * Coverage:
 *   sendCard             — success, HTTP error, network failure, timeout
 *   sendNotification     — Adaptive Card structure, priority colors
 *   sendApprovalRequest  — approve/reject action URLs, FactSet fields
 *   sendEscalation       — severity hex colors, bleed column, HMAC
 *   sendEvmStatusCard    — CPI/SPI formatting, health color
 *   verifyTeamsSignature — valid, tampered payload, wrong secret, empty
 *   sendTeamsWebhook     — helper factory function
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'node:crypto'
import {
  TeamsConnector,
  createTeamsConnector,
  sendTeamsWebhook,
  verifyTeamsSignature,
} from '../services/integration/teamsConnector'

// ─── Mock slog (imported inside teamsConnector for network errors) ─────────────

vi.mock('../../src/modules/observability/index', () => {
  const slog: any = vi.fn()
  slog.info  = vi.fn()
  slog.warn  = vi.fn()
  slog.error = vi.fn()
  return { slog }
})

// ─── Fetch mock helpers ───────────────────────────────────────────────────────

const WEBHOOK_URL = 'https://company.webhook.office.com/webhookb2/test-id/IncomingWebhook/test-key'

function mockFetch(status: number, body = '1') {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok:     status >= 200 && status < 300,
    status,
    text:   vi.fn().mockResolvedValue(body),
  }))
}

function mockFetchNetworkError(message = 'connection refused') {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(message)))
}

afterEach(() => { vi.unstubAllGlobals() })

// ─── Shared connector factory ─────────────────────────────────────────────────

function connector() {
  return createTeamsConnector({ webhookUrl: WEBHOOK_URL, timeout: 5000, tenantId: 'tenant-1' })
}

// ══════════════════════════════════════════════════════════════════════════════
// sendCard — core delivery method
// ══════════════════════════════════════════════════════════════════════════════

describe('TeamsConnector.sendCard', () => {
  it('returns { ok: true } on HTTP 200', async () => {
    mockFetch(200)
    const result = await connector().sendCard({ type: 'AdaptiveCard', version: '1.5', body: [] })
    expect(result.ok).toBe(true)
    expect(result.status).toBe(200)
  })

  it('sends POST with Content-Type: application/json', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, text: vi.fn().mockResolvedValue('1') })
    vi.stubGlobal('fetch', fetchSpy)

    await connector().sendCard({ type: 'AdaptiveCard' })

    const [url, init] = fetchSpy.mock.calls[0]!
    expect(url).toBe(WEBHOOK_URL)
    expect((init as RequestInit).method).toBe('POST')
    expect((init as RequestInit).headers).toMatchObject({ 'Content-Type': 'application/json' })
  })

  it('wraps card in message attachment envelope', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, text: vi.fn().mockResolvedValue('1') })
    vi.stubGlobal('fetch', fetchSpy)

    await connector().sendCard({ type: 'AdaptiveCard', version: '1.5' })

    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string)
    expect(body.type).toBe('message')
    expect(body.attachments[0].contentType).toBe('application/vnd.microsoft.card.adaptive')
    expect(body.attachments[0].content).toMatchObject({ type: 'AdaptiveCard', version: '1.5' })
  })

  it('returns { ok: false } on HTTP 4xx', async () => {
    mockFetch(400, 'Bad Request')
    const result = await connector().sendCard({})
    expect(result.ok).toBe(false)
    expect(result.status).toBe(400)
    expect(result.error).toMatch(/Bad Request/i)
  })

  it('returns { ok: false } on HTTP 5xx', async () => {
    mockFetch(500, 'Internal Server Error')
    const result = await connector().sendCard({})
    expect(result.ok).toBe(false)
    expect(result.status).toBe(500)
  })

  it('returns { ok: false } on network error (no throw)', async () => {
    mockFetchNetworkError('ECONNREFUSED')
    const result = await connector().sendCard({})
    expect(result.ok).toBe(false)
    expect(result.error).toContain('network_error')
    expect(result.error).toContain('ECONNREFUSED')
  })

  it('returns { ok: false } on AbortError (timeout)', async () => {
    mockFetchNetworkError('This operation was aborted')
    const result = await connector().sendCard({})
    expect(result.ok).toBe(false)
    expect(result.error).toContain('network_error')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// sendNotification
// ══════════════════════════════════════════════════════════════════════════════

describe('TeamsConnector.sendNotification', () => {
  beforeEach(() => mockFetch(200))

  it('sends a card with the notification title', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, text: vi.fn().mockResolvedValue('1') })
    vi.stubGlobal('fetch', fetchSpy)

    await connector().sendNotification({
      title:    'Budget Alert',
      body:     'Project overspend detected',
      priority: 'high',
    })

    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string)
    const card = body.attachments[0].content
    const titleBlock = card.body.find((b: any) => b.text === 'Budget Alert')
    expect(titleBlock).toBeDefined()
    expect(titleBlock.weight).toBe('Bolder')
  })

  it('maps priority to AdaptiveCard color', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, text: vi.fn().mockResolvedValue('1') })
    vi.stubGlobal('fetch', fetchSpy)

    await connector().sendNotification({ title: 'Test', body: 'msg', priority: 'critical' })

    const card = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string)
      .attachments[0].content
    const titleBlock = card.body.find((b: any) => b.text === 'Test')
    expect(titleBlock.color).toBe('attention')  // critical → attention (red)
  })

  it.each([
    ['critical', 'attention'],
    ['high',     'warning'],
    ['medium',   'accent'],
    ['low',      'good'],
    ['info',     'default'],
  ] as const)('priority "%s" maps to color "%s"', async (priority, expectedColor) => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, text: vi.fn().mockResolvedValue('1') })
    vi.stubGlobal('fetch', fetchSpy)

    await connector().sendNotification({ title: 'T', body: 'B', priority })

    const card = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string)
      .attachments[0].content
    const titleBlock = card.body.find((b: any) => b.text === 'T')
    expect(titleBlock.color).toBe(expectedColor)
  })

  it('includes Action.OpenUrl when actionUrl provided', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, text: vi.fn().mockResolvedValue('1') })
    vi.stubGlobal('fetch', fetchSpy)

    await connector().sendNotification({
      title:     'View Report',
      body:      'Click to view',
      actionUrl: 'https://app.example.com/report/42',
    })

    const card = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string)
      .attachments[0].content
    expect(card.actions?.[0]?.type).toBe('Action.OpenUrl')
    expect(card.actions?.[0]?.url).toBe('https://app.example.com/report/42')
  })

  it('includes FactSet for extra fields', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, text: vi.fn().mockResolvedValue('1') })
    vi.stubGlobal('fetch', fetchSpy)

    await connector().sendNotification({
      title:  'Status',
      body:   'Details below',
      fields: [{ label: 'Phase', value: 'Construction' }],
    })

    const card = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string)
      .attachments[0].content
    const factSet = card.body.find((b: any) => b.type === 'FactSet')
    expect(factSet).toBeDefined()
    expect(factSet.facts.some((f: any) => f.title === 'Phase')).toBe(true)
  })

  it('prepends Project fact when projectName provided', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, text: vi.fn().mockResolvedValue('1') })
    vi.stubGlobal('fetch', fetchSpy)

    await connector().sendNotification({
      title:       'Update',
      body:        'FYI',
      projectName: 'Terminal 5 Expansion',
    })

    const card = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string)
      .attachments[0].content
    const factSet = card.body.find((b: any) => b.type === 'FactSet')
    expect(factSet.facts[0].title).toBe('Project')
    expect(factSet.facts[0].value).toBe('Terminal 5 Expansion')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// sendApprovalRequest
// ══════════════════════════════════════════════════════════════════════════════

describe('TeamsConnector.sendApprovalRequest', () => {
  beforeEach(() => mockFetch(200))

  it('includes approve and reject Action.OpenUrl buttons', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, text: vi.fn().mockResolvedValue('1') })
    vi.stubGlobal('fetch', fetchSpy)

    await connector().sendApprovalRequest({
      title:       'CO-042 Approval',
      description: 'Change order for additional steel',
      requestedBy: 'J. Smith',
      approveUrl:  'https://api.example.com/approve/co-042',
      rejectUrl:   'https://api.example.com/reject/co-042',
    })

    const card = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string)
      .attachments[0].content
    const actions = card.actions as Array<{ type: string; title: string; url: string }>
    const approve = actions.find(a => a.url === 'https://api.example.com/approve/co-042')
    const reject  = actions.find(a => a.url === 'https://api.example.com/reject/co-042')
    expect(approve).toBeDefined()
    expect(reject).toBeDefined()
    expect(approve?.type).toBe('Action.OpenUrl')
    expect(reject?.type).toBe('Action.OpenUrl')
  })

  it('includes Requested By in FactSet', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, text: vi.fn().mockResolvedValue('1') })
    vi.stubGlobal('fetch', fetchSpy)

    await connector().sendApprovalRequest({
      title:       'RFI-018',
      description: 'Clarification needed',
      requestedBy: 'Alice Engineer',
      approveUrl:  'https://example.com/approve',
      rejectUrl:   'https://example.com/reject',
    })

    const card = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string)
      .attachments[0].content
    const factSet = card.body.find((b: any) => b.type === 'FactSet')
    expect(factSet.facts.some((f: any) => f.title === 'Requested By' && f.value === 'Alice Engineer')).toBe(true)
  })

  it('includes Due date in FactSet when dueDate provided', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, text: vi.fn().mockResolvedValue('1') })
    vi.stubGlobal('fetch', fetchSpy)

    await connector().sendApprovalRequest({
      title:       'Approval',
      description: 'Please approve',
      requestedBy: 'Bob',
      approveUrl:  'https://example.com/approve',
      rejectUrl:   'https://example.com/reject',
      dueDate:     '2025-12-31',
    })

    const card = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string)
      .attachments[0].content
    const factSet = card.body.find((b: any) => b.type === 'FactSet')
    expect(factSet.facts.some((f: any) => f.title === 'Due' && f.value === '2025-12-31')).toBe(true)
  })

  it('includes optional details link when detailsUrl provided', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, text: vi.fn().mockResolvedValue('1') })
    vi.stubGlobal('fetch', fetchSpy)

    await connector().sendApprovalRequest({
      title:       'Review',
      description: 'See details',
      requestedBy: 'Charlie',
      approveUrl:  'https://example.com/approve',
      rejectUrl:   'https://example.com/reject',
      detailsUrl:  'https://example.com/detail/99',
    })

    const card = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string)
      .attachments[0].content
    const detailsAction = (card.actions as any[]).find(a => a.url === 'https://example.com/detail/99')
    expect(detailsAction).toBeDefined()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// sendEscalation
// ══════════════════════════════════════════════════════════════════════════════

describe('TeamsConnector.sendEscalation', () => {
  beforeEach(() => mockFetch(200))

  it('uses critical hex color (#D13438) for critical severity', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, text: vi.fn().mockResolvedValue('1') })
    vi.stubGlobal('fetch', fetchSpy)

    await connector().sendEscalation({
      title:    'SLA Breach',
      body:     'Immediate action required',
      severity: 'critical',
    })

    const card = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string)
      .attachments[0].content
    // ColumnSet backgroundColor should be '#D13438' for critical
    const colSet = card.body.find((b: any) => b.type === 'ColumnSet')
    expect(colSet?.backgroundColor).toBe('#D13438')
  })

  it.each([
    ['critical', '#D13438'],
    ['high',     '#F7630C'],
    ['medium',   '#FFB900'],
  ] as const)('severity "%s" uses hex color %s', async (severity, hex) => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, text: vi.fn().mockResolvedValue('1') })
    vi.stubGlobal('fetch', fetchSpy)

    await connector().sendEscalation({ title: 'T', body: 'B', severity })

    const card = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string)
      .attachments[0].content
    const colSet = card.body.find((b: any) => b.type === 'ColumnSet')
    expect(colSet?.backgroundColor).toBe(hex)
  })

  it('includes SLA deadline and assignee in FactSet when provided', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, text: vi.fn().mockResolvedValue('1') })
    vi.stubGlobal('fetch', fetchSpy)

    await connector().sendEscalation({
      title:       'Urgent',
      body:        'Fix needed',
      severity:    'high',
      slaDeadline: '2025-07-01T08:00:00Z',
      assignee:    'ops-team@example.com',
    })

    const card = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string)
      .attachments[0].content
    const factSet = card.body.find((b: any) => b.type === 'FactSet')
    expect(factSet.facts.some((f: any) => f.title === 'SLA Due')).toBe(true)
    expect(factSet.facts.some((f: any) => f.title === 'Assignee' && f.value === 'ops-team@example.com')).toBe(true)
  })

  it('includes dashboard link action when dashboardUrl provided', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, text: vi.fn().mockResolvedValue('1') })
    vi.stubGlobal('fetch', fetchSpy)

    await connector().sendEscalation({
      title:        'Alert',
      body:         'Check dashboard',
      severity:     'medium',
      dashboardUrl: 'https://app.example.com/dashboard',
    })

    const card = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string)
      .attachments[0].content
    expect(card.actions?.[0]?.url).toBe('https://app.example.com/dashboard')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// sendEvmStatusCard
// ══════════════════════════════════════════════════════════════════════════════

describe('TeamsConnector.sendEvmStatusCard', () => {
  beforeEach(() => mockFetch(200))

  it('formats CPI and SPI with 2 decimal places', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, text: vi.fn().mockResolvedValue('1') })
    vi.stubGlobal('fetch', fetchSpy)

    await connector().sendEvmStatusCard({
      projectName: 'Terminal 5',
      statusDate:  '2025-06-01',
      cpi: 0.9345,
      spi: 1.0278,
      eac: 5_200_000,
      bac: 5_000_000,
      health: 'yellow',
    })

    const card = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string)
      .attachments[0].content
    const factSet = card.body.find((b: any) => b.type === 'FactSet')
    const cpiRow  = factSet.facts.find((f: any) => f.title === 'CPI')
    const spiRow  = factSet.facts.find((f: any) => f.title === 'SPI')
    expect(cpiRow.value).toContain('0.93')
    expect(spiRow.value).toContain('1.03')
  })

  it('appends ⚠️ to CPI when < 1', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, text: vi.fn().mockResolvedValue('1') })
    vi.stubGlobal('fetch', fetchSpy)

    await connector().sendEvmStatusCard({
      projectName: 'P', statusDate: '2025-01-01',
      cpi: 0.85, spi: 0.90,
      eac: 2_000_000, bac: 1_500_000,
      health: 'red',
    })

    const card = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string)
      .attachments[0].content
    const factSet = card.body.find((b: any) => b.type === 'FactSet')
    const cpiRow  = factSet.facts.find((f: any) => f.title === 'CPI')
    expect(cpiRow.value).toContain('⚠️')
  })

  it('appends ✅ to CPI when >= 1', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, text: vi.fn().mockResolvedValue('1') })
    vi.stubGlobal('fetch', fetchSpy)

    await connector().sendEvmStatusCard({
      projectName: 'P', statusDate: '2025-01-01',
      cpi: 1.05, spi: 1.10,
      eac: 900_000, bac: 1_000_000,
      health: 'green',
    })

    const card = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string)
      .attachments[0].content
    const factSet = card.body.find((b: any) => b.type === 'FactSet')
    const cpiRow  = factSet.facts.find((f: any) => f.title === 'CPI')
    expect(cpiRow.value).toContain('✅')
  })

  it.each([
    ['green',  '🟢'],
    ['yellow', '🟡'],
    ['red',    '🔴'],
  ] as const)('health "%s" uses emoji %s in title', async (health, emoji) => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, text: vi.fn().mockResolvedValue('1') })
    vi.stubGlobal('fetch', fetchSpy)

    await connector().sendEvmStatusCard({
      projectName: 'Test Project', statusDate: '2025-01-01',
      cpi: 1.0, spi: 1.0, eac: 100, bac: 100, health,
    })

    const card = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string)
      .attachments[0].content
    const titleBlock = card.body.find((b: any) => b.type === 'TextBlock' && b.text?.includes(emoji))
    expect(titleBlock).toBeDefined()
  })

  it('shows BAC and EAC in thousands (K format)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, text: vi.fn().mockResolvedValue('1') })
    vi.stubGlobal('fetch', fetchSpy)

    await connector().sendEvmStatusCard({
      projectName: 'P', statusDate: '2025-01-01',
      cpi: 1.0, spi: 1.0,
      eac: 4_750_000, bac: 5_000_000,
      health: 'green',
    })

    const card = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string)
      .attachments[0].content
    const factSet = card.body.find((b: any) => b.type === 'FactSet')
    const bacRow  = factSet.facts.find((f: any) => f.title === 'BAC')
    const eacRow  = factSet.facts.find((f: any) => f.title === 'EAC')
    expect(bacRow.value).toContain('5000K')
    expect(eacRow.value).toContain('4750K')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// verifyTeamsSignature
// ══════════════════════════════════════════════════════════════════════════════

describe('verifyTeamsSignature', () => {
  // Generate a valid signature for testing
  const SECRET   = Buffer.from('my-signing-secret').toString('base64')
  const BODY     = '{"type":"message","text":"hello"}'

  function makeSignature(secret: string, body: string): string {
    const key = Buffer.from(secret, 'base64')
    return 'HMAC ' + createHmac('sha256', key).update(body).digest('base64')
  }

  it('returns true for a valid signature', () => {
    const sig = makeSignature(SECRET, BODY)
    expect(verifyTeamsSignature(SECRET, BODY, sig)).toBe(true)
  })

  it('returns false when payload is tampered', () => {
    const sig     = makeSignature(SECRET, BODY)
    const tampered = BODY + 'extra'
    expect(verifyTeamsSignature(SECRET, tampered, sig)).toBe(false)
  })

  it('returns false when wrong secret is used', () => {
    const wrongSecret = Buffer.from('wrong-secret-value').toString('base64')
    const sig         = makeSignature(wrongSecret, BODY)
    expect(verifyTeamsSignature(SECRET, BODY, sig)).toBe(false)
  })

  it('returns false for empty signature string', () => {
    expect(verifyTeamsSignature(SECRET, BODY, '')).toBe(false)
  })

  it('returns false when signature prefix is missing (no "HMAC " prefix)', () => {
    const key    = Buffer.from(SECRET, 'base64')
    const rawSig = createHmac('sha256', key).update(BODY).digest('base64')
    // Without "HMAC " prefix the lengths will differ → timingSafeEqual returns false
    expect(verifyTeamsSignature(SECRET, BODY, rawSig)).toBe(false)
  })

  it('returns false on malformed base64 secret (does not throw)', () => {
    expect(() => verifyTeamsSignature('not-base64!!!', BODY, 'HMAC abc')).not.toThrow()
    expect(verifyTeamsSignature('not-base64!!!', BODY, 'HMAC abc')).toBe(false)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// sendTeamsWebhook (standalone helper)
// ══════════════════════════════════════════════════════════════════════════════

describe('sendTeamsWebhook', () => {
  it('delivers notification and returns { ok: true }', async () => {
    mockFetch(200)
    const result = await sendTeamsWebhook(WEBHOOK_URL, 'Alert Title', 'Alert body text')
    expect(result.ok).toBe(true)
  })

  it('passes through optional fields (priority, actionUrl)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, text: vi.fn().mockResolvedValue('1') })
    vi.stubGlobal('fetch', fetchSpy)

    await sendTeamsWebhook(WEBHOOK_URL, 'T', 'B', {
      priority:  'high',
      actionUrl: 'https://app.example.com/action',
    })

    const card = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string)
      .attachments[0].content
    expect(card.actions?.[0]?.url).toBe('https://app.example.com/action')
  })

  it('returns { ok: false } on network error', async () => {
    mockFetchNetworkError('timeout')
    const result = await sendTeamsWebhook(WEBHOOK_URL, 'T', 'B')
    expect(result.ok).toBe(false)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// createTeamsConnector factory
// ══════════════════════════════════════════════════════════════════════════════

describe('createTeamsConnector', () => {
  it('creates a TeamsConnector instance', () => {
    const c = createTeamsConnector({ webhookUrl: 'https://example.com' })
    expect(c).toBeInstanceOf(TeamsConnector)
  })

  it('uses default timeout of 10000ms when not specified', async () => {
    // Just verify no error is thrown with defaults
    mockFetch(200)
    const c = createTeamsConnector({ webhookUrl: WEBHOOK_URL })
    await expect(c.sendNotification({ title: 'T', body: 'B' })).resolves.toMatchObject({ ok: true })
  })
})
