/**
 * Tests: components/NovaIntegrationPanel
 * Coverage: no-backend-project state, not-connected empty state, loading/error
 * states, connected rendering (incl. "not reported" honesty), failed-delivery
 * health rendering (never healthy), role-gated retry visibility + action,
 * absence of contract values.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { NovaIntegrationPanel, type NovaIntegrationStatus } from '../../components/NovaIntegrationPanel'

const PROJECT_ID = 'dddddddd-0000-0000-0000-000000000009'

function connectedStatus(overrides: Partial<NovaIntegrationStatus> = {}): NovaIntegrationStatus {
  return {
    linked: true,
    link: {
      novaProjectId:     'nova-p-9',
      novaProjectNumber: 'NV-2026-014',
      novaCustomerName:  'Aurora Midstream LLC',
      contractNumber:    'CN-88231',
      commercialPm:      null,
      linkedAt:          '2026-07-20T12:00:00.000Z',
      lastEventAt:       '2026-07-20T12:30:00.000Z',
    },
    connection: { connectionId: 'conn-1', novaTenantId: 'nova-t-1', status: 'connected' },
    health: 'healthy',
    delivery: {
      queuedCount: 0,
      failedCount: 0,
      deadCount:   0,
      lastDeliveredAt:        '2026-07-20T12:05:00.000Z',
      lastDeliveredEventType: 'denver.project.created',
    },
    openInNovaUrl: 'https://nova.example.com/projects/nova-p-9',
    ...overrides,
  }
}

const mockFetch = vi.fn()

function stubGet(body: unknown, ok = true, status = 200) {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ requeued: 2 }) })
    }
    return Promise.resolve({ ok, status, json: () => Promise.resolve(body) })
  })
}

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('NovaIntegrationPanel — unresolved backend project', () => {
  it('renders an honest unavailable state and never fetches', () => {
    render(<NovaIntegrationPanel projectId={null} canManage={true} />)
    expect(screen.getByRole('heading', { name: 'Nova Integration' })).toBeInTheDocument()
    expect(screen.getByText(/no\s+synced backend project/i)).toBeInTheDocument()
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('NovaIntegrationPanel — not connected', () => {
  it('renders the not-connected empty state when no link exists', async () => {
    stubGet({ linked: false })
    render(<NovaIntegrationPanel projectId={PROJECT_ID} canManage={true} />)
    expect(await screen.findByText(/Not connected to Nova/i)).toBeInTheDocument()
    expect(screen.getByText(/not created from a Nova commercial project/i)).toBeInTheDocument()
    // No dead controls in the empty state.
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})

describe('NovaIntegrationPanel — load error', () => {
  it('renders an error state with a reload action', async () => {
    stubGet({}, false, 500)
    render(<NovaIntegrationPanel projectId={PROJECT_ID} canManage={false} />)
    expect(await screen.findByText(/Could not load Nova integration status/i)).toBeInTheDocument()
    const reload = screen.getByRole('button', { name: /reload/i })
    stubGet(connectedStatus())
    fireEvent.click(reload)
    expect(await screen.findByText('NV-2026-014')).toBeInTheDocument()
  })
})

describe('NovaIntegrationPanel — connected', () => {
  it('renders link fields, connection, last event, and the Open in Nova link', async () => {
    stubGet(connectedStatus())
    render(<NovaIntegrationPanel projectId={PROJECT_ID} canManage={true} />)
    expect(await screen.findByText('NV-2026-014')).toBeInTheDocument()
    expect(screen.getByText('Aurora Midstream LLC')).toBeInTheDocument()
    expect(screen.getByText('CN-88231')).toBeInTheDocument()
    expect(screen.getByText('nova-t-1')).toBeInTheDocument()
    expect(screen.getByText(/denver\.project\.created/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Integration health: Healthy/i)).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /open in nova/i })
    expect(link).toHaveAttribute('href', 'https://nova.example.com/projects/nova-p-9')
    // Commercial PM not stored → honest "not reported", never a fake value.
    expect(screen.getByText(/not reported/i)).toBeInTheDocument()
    // No failed deliveries → no retry button rendered (no dead controls).
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()
  })

  it('never renders a contract value', async () => {
    stubGet(connectedStatus())
    const { container } = render(<NovaIntegrationPanel projectId={PROJECT_ID} canManage={true} />)
    await screen.findByText('NV-2026-014')
    expect(container.textContent).not.toMatch(/contract value/i)
    expect(container.textContent).not.toMatch(/\$\s?[\d,]+/)
  })

  it('renders an honest note instead of a dead link when no Nova URL exists', async () => {
    stubGet(connectedStatus({ openInNovaUrl: null }))
    render(<NovaIntegrationPanel projectId={PROJECT_ID} canManage={false} />)
    await screen.findByText('NV-2026-014')
    expect(screen.queryByRole('link', { name: /open in nova/i })).not.toBeInTheDocument()
    expect(screen.getByText(/No Nova deep link available/i)).toBeInTheDocument()
  })
})

describe('NovaIntegrationPanel — failed deliveries render honestly', () => {
  const failed = () => connectedStatus({
    health: 'failed',
    delivery: {
      queuedCount: 0, failedCount: 1, deadCount: 2,
      lastDeliveredAt: '2026-07-20T12:05:00.000Z',
      lastDeliveredEventType: 'denver.project.created',
    },
  })

  it('shows the failed health chip — never healthy — and the counts', async () => {
    stubGet(failed())
    render(<NovaIntegrationPanel projectId={PROJECT_ID} canManage={false} />)
    expect(await screen.findByLabelText(/Integration health: Delivery failed/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/Integration health: Healthy/i)).not.toBeInTheDocument()
    expect(screen.getByText('1 retrying')).toBeInTheDocument()
    expect(screen.getByText('2 dead')).toBeInTheDocument()
  })

  it('hides the retry action from non-privileged users', async () => {
    stubGet(failed())
    render(<NovaIntegrationPanel projectId={PROJECT_ID} canManage={false} />)
    await screen.findByLabelText(/Integration health: Delivery failed/i)
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()
  })

  it('shows retry for privileged users, posts, reports the result, and reloads', async () => {
    stubGet(failed())
    render(<NovaIntegrationPanel projectId={PROJECT_ID} canManage={true} />)
    const btn = await screen.findByRole('button', { name: /retry 3 failed deliveries/i })
    fireEvent.click(btn)
    expect(await screen.findByText(/Re-queued 2 deliveries/i)).toBeInTheDocument()
    const postCall = mockFetch.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
    expect(postCall).toBeDefined()
    expect(String(postCall![0])).toBe(`/api/v1/projects/${PROJECT_ID}/nova-integration/retry`)
  })

  it('reports an honest message when the server rejects the retry with 403', async () => {
    mockFetch.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({ error: 'forbidden' }) })
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(failed()) })
    })
    render(<NovaIntegrationPanel projectId={PROJECT_ID} canManage={true} />)
    const btn = await screen.findByRole('button', { name: /retry/i })
    fireEvent.click(btn)
    expect(await screen.findByText(/Not permitted — requires owner or admin/i)).toBeInTheDocument()
  })

  it('renders disconnected health when the connection is unavailable', async () => {
    stubGet(connectedStatus({ health: 'disconnected', connection: null }))
    render(<NovaIntegrationPanel projectId={PROJECT_ID} canManage={false} />)
    expect(await screen.findByLabelText(/Integration health: Connection unavailable/i)).toBeInTheDocument()
    expect(screen.getByText('not found')).toBeInTheDocument()
  })
})
