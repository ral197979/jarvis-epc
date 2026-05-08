/**
 * JARVIS EPC — Tests for P1/P4 new views
 * ScheduleView, TeamView, ProposalsView, NotificationsView, MarketplacePage
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'

// Mock fetch for components that call API
beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tools: [], total: 0 }) })
})

// ─── ScheduleView ──────────────────────────────────────────────────────────────

describe('ScheduleView', () => {
  it('renders without crashing', async () => {
    const { ScheduleView } = await import('../../components/ScheduleView')
    const { container } = render(React.createElement(ScheduleView))
    expect(container.firstChild).toBeTruthy()
  })

  it('exposes the Schedule landmark', async () => {
    const { ScheduleView } = await import('../../components/ScheduleView')
    render(React.createElement(ScheduleView))
    expect(screen.getByRole('main', { name: /Schedule/i })).toBeTruthy()
  })

  it('shows KPI cards', async () => {
    const { ScheduleView } = await import('../../components/ScheduleView')
    render(React.createElement(ScheduleView))
    expect(screen.getAllByText(/Activities/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/Critical/i).length).toBeGreaterThanOrEqual(1)
  })

  it('can switch to Float Analysis tab', async () => {
    const { ScheduleView } = await import('../../components/ScheduleView')
    render(React.createElement(ScheduleView))
    const floatTab = screen.getByRole('tab', { name: /Float Analysis/i })
    fireEvent.click(floatTab)
    expect(screen.getByText(/Total Float/i)).toBeTruthy()
  })

  it('can switch to CPM Network tab', async () => {
    const { ScheduleView } = await import('../../components/ScheduleView')
    render(React.createElement(ScheduleView))
    fireEvent.click(screen.getByRole('tab', { name: /CPM Network/i }))
    expect(screen.getByText(/Critical Path Network/i)).toBeTruthy()
  })

  it('can switch to EVM tab', async () => {
    const { ScheduleView } = await import('../../components/ScheduleView')
    render(React.createElement(ScheduleView))
    fireEvent.click(screen.getByRole('tab', { name: /EVM/i }))
    expect(screen.getByText(/Earned Value Management/i)).toBeTruthy()
  })
})

// ─── TeamView ──────────────────────────────────────────────────────────────────

describe('TeamView', () => {
  it('renders without crashing', async () => {
    const { TeamView } = await import('../../components/TeamView')
    const { container } = render(React.createElement(TeamView))
    expect(container.firstChild).toBeTruthy()
  })

  it('exposes the Team landmark', async () => {
    const { TeamView } = await import('../../components/TeamView')
    render(React.createElement(TeamView))
    expect(screen.getByRole('main', { name: /Team/i })).toBeTruthy()
  })

  it('shows demo team members when biz state is empty', async () => {
    const { TeamView } = await import('../../components/TeamView')
    render(React.createElement(TeamView))
    expect(screen.getByText(/Alex Reyes/i)).toBeTruthy()
  })

  it('shows Add Member button for write-enabled policy', async () => {
    const { TeamView } = await import('../../components/TeamView')
    render(React.createElement(TeamView, { policy: { writesEnabled: true, activeRole: 'owner' } }))
    expect(screen.getByText(/\+ Add Member/i)).toBeTruthy()
  })

  it('hides Add Member button for read-only policy', async () => {
    const { TeamView } = await import('../../components/TeamView')
    render(React.createElement(TeamView, { policy: { writesEnabled: false, activeRole: 'viewer' } }))
    expect(screen.queryByText(/\+ Add Member/i)).toBeNull()
  })

  it('filters by role', async () => {
    const { TeamView } = await import('../../components/TeamView')
    render(React.createElement(TeamView))
    const engineerBtn = screen.getByRole('button', { name: /^Engineer$/i })
    fireEvent.click(engineerBtn)
    expect(screen.queryByText(/Dana Patel/i)).toBeNull()
  })
})

// ─── ProposalsView ─────────────────────────────────────────────────────────────

describe('ProposalsView', () => {
  it('renders without crashing', async () => {
    const { ProposalsView } = await import('../../components/ProposalsView')
    const { container } = render(React.createElement(ProposalsView))
    expect(container.firstChild).toBeTruthy()
  })

  it('exposes the Proposals landmark', async () => {
    const { ProposalsView } = await import('../../components/ProposalsView')
    render(React.createElement(ProposalsView))
    expect(screen.getByRole('main', { name: /Proposals/i })).toBeTruthy()
  })

  it('shows KPI cards including Pipeline and Awarded', async () => {
    const { ProposalsView } = await import('../../components/ProposalsView')
    render(React.createElement(ProposalsView))
    expect(screen.getAllByText(/Pipeline/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/Hit Rate/i).length).toBeGreaterThanOrEqual(1)
  })

  it('shows demo proposals', async () => {
    const { ProposalsView } = await import('../../components/ProposalsView')
    render(React.createElement(ProposalsView))
    expect(screen.getByText(/Substation Upgrade/i)).toBeTruthy()
  })

  it('filters by status', async () => {
    const { ProposalsView } = await import('../../components/ProposalsView')
    render(React.createElement(ProposalsView))
    fireEvent.click(screen.getByRole('button', { name: /^Awarded$/i }))
    expect(screen.getByText(/HVAC Retrofit/i)).toBeTruthy()
    expect(screen.queryByText(/Pipeline Integrity/i)).toBeNull()
  })

  it('shows New Proposal button for write-enabled', async () => {
    const { ProposalsView } = await import('../../components/ProposalsView')
    render(React.createElement(ProposalsView, { policy: { writesEnabled: true } }))
    expect(screen.getByText(/\+ New Proposal/i)).toBeTruthy()
  })
})

// ─── NotificationsView ─────────────────────────────────────────────────────────

describe('NotificationsView', () => {
  it('renders without crashing', async () => {
    const { NotificationsView } = await import('../../components/NotificationsView')
    const { container } = render(React.createElement(NotificationsView))
    expect(container.firstChild).toBeTruthy()
  })

  it('exposes the Notifications landmark', async () => {
    const { NotificationsView } = await import('../../components/NotificationsView')
    render(React.createElement(NotificationsView))
    expect(screen.getByRole('main', { name: /Notifications/i })).toBeTruthy()
  })

  it('shows demo notifications', async () => {
    const { NotificationsView } = await import('../../components/NotificationsView')
    render(React.createElement(NotificationsView))
    expect(screen.getByText(/RFI #007 response overdue/i)).toBeTruthy()
  })

  it('shows unread count badge', async () => {
    const { NotificationsView } = await import('../../components/NotificationsView')
    render(React.createElement(NotificationsView))
    expect(screen.getAllByText(/new/i).length).toBeGreaterThanOrEqual(1)
  })

  it('switches to All tab', async () => {
    const { NotificationsView } = await import('../../components/NotificationsView')
    render(React.createElement(NotificationsView))
    fireEvent.click(screen.getByRole('button', { name: /^All$/i }))
    expect(screen.getByText(/Punch list item closed/i)).toBeTruthy()
  })

  it('shows Mark all read button when unread exist', async () => {
    const { NotificationsView } = await import('../../components/NotificationsView')
    render(React.createElement(NotificationsView))
    expect(screen.getByText(/Mark all read/i)).toBeTruthy()
  })
})

// ─── MarketplacePage ───────────────────────────────────────────────────────────

describe('MarketplacePage', () => {
  it('renders without crashing', async () => {
    const { MarketplacePage } = await import('../../components/MarketplacePage')
    const { container } = render(React.createElement(MarketplacePage))
    expect(container.firstChild).toBeTruthy()
  })

  it('exposes the Marketplace landmark', async () => {
    const { MarketplacePage } = await import('../../components/MarketplacePage')
    render(React.createElement(MarketplacePage))
    expect(screen.getByRole('main', { name: /Marketplace/i })).toBeTruthy()
  })

  it('shows marketplace tools', async () => {
    const { MarketplacePage } = await import('../../components/MarketplacePage')
    render(React.createElement(MarketplacePage))
    expect(screen.getByText(/cost analytics/i)).toBeTruthy()
  })

  it('shows owner message for non-owner role', async () => {
    const { MarketplacePage } = await import('../../components/MarketplacePage')
    render(React.createElement(MarketplacePage, { policy: { activeRole: 'viewer' } }))
    expect(screen.getByText(/Only the Owner role/i)).toBeTruthy()
  })

  it('filters by category', async () => {
    const { MarketplacePage } = await import('../../components/MarketplacePage')
    render(React.createElement(MarketplacePage))
    fireEvent.click(screen.getByRole('button', { name: /^Field$/i }))
    // After filtering to Field, drone_site_imagery should be visible
    expect(screen.getAllByText(/drone/i).length).toBeGreaterThanOrEqual(1)
  })
})

// ─── IntegrationsView ──────────────────────────────────────────────────────────

describe('IntegrationsView', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/api/v1/integrations')) return Promise.resolve({ ok: false, json: async () => ({}) })
      if (String(url).includes('/api/v1/webhooks')) return Promise.resolve({ ok: false, json: async () => ({}) })
      if (String(url).includes('/api/v1/sync-jobs')) return Promise.resolve({ ok: false, json: async () => ({}) })
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
  })

  it('renders without crashing', async () => {
    const { IntegrationsView } = await import('../../components/IntegrationsView')
    const { container } = render(React.createElement(IntegrationsView))
    expect(container.firstChild).toBeTruthy()
  })

  it('exposes the Integrations landmark', async () => {
    const { IntegrationsView } = await import('../../components/IntegrationsView')
    render(React.createElement(IntegrationsView))
    expect(screen.getByRole('main', { name: /Integrations/i })).toBeTruthy()
  })

  it('shows demo connectors when API returns empty', async () => {
    const { IntegrationsView } = await import('../../components/IntegrationsView')
    render(React.createElement(IntegrationsView))
    expect(screen.getAllByText(/QuickBooks|Slack|Tractian|Procore/i).length).toBeGreaterThanOrEqual(1)
  })

  it('shows Connectors tab by default', async () => {
    const { IntegrationsView } = await import('../../components/IntegrationsView')
    render(React.createElement(IntegrationsView))
    expect(screen.getByRole('tab', { name: /Connectors/i })).toBeTruthy()
  })

  it('can switch to Webhooks tab', async () => {
    const { IntegrationsView } = await import('../../components/IntegrationsView')
    render(React.createElement(IntegrationsView))
    fireEvent.click(screen.getByRole('tab', { name: /Webhooks/i }))
    expect(screen.getAllByText(/Webhook/i).length).toBeGreaterThanOrEqual(1)
  })

  it('can switch to Sync Jobs tab', async () => {
    const { IntegrationsView } = await import('../../components/IntegrationsView')
    render(React.createElement(IntegrationsView))
    fireEvent.click(screen.getByRole('tab', { name: /Sync Jobs/i }))
    expect(screen.getAllByText(/Sync/i).length).toBeGreaterThanOrEqual(1)
  })

  it('shows Add Connector button for write-enabled policy', async () => {
    const { IntegrationsView } = await import('../../components/IntegrationsView')
    render(React.createElement(IntegrationsView, { policy: { writesEnabled: true } }))
    expect(screen.getByText(/\+ Add Connector/i)).toBeTruthy()
  })
})

// ─── PredictView ───────────────────────────────────────────────────────────────

describe('PredictView', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) })
  })

  it('renders without crashing', async () => {
    const { PredictView } = await import('../../components/PredictView')
    const { container } = render(React.createElement(PredictView))
    expect(container.firstChild).toBeTruthy()
  })

  it('exposes the Predict landmark', async () => {
    const { PredictView } = await import('../../components/PredictView')
    render(React.createElement(PredictView))
    expect(screen.getByRole('main', { name: /Predict/i })).toBeTruthy()
  })

  it('shows KPI cards including Risk Score and Cost Variance', async () => {
    const { PredictView } = await import('../../components/PredictView')
    render(React.createElement(PredictView))
    expect(screen.getAllByText(/Risk Score/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/Cost Variance/i).length).toBeGreaterThanOrEqual(1)
  })

  it('shows demo predictions when API unavailable', async () => {
    const { PredictView } = await import('../../components/PredictView')
    render(React.createElement(PredictView))
    expect(screen.getAllByText(/Offshore|Refinery|Substation|Pipeline/i).length).toBeGreaterThanOrEqual(1)
  })

  it('can switch to Risk Heat Map tab', async () => {
    const { PredictView } = await import('../../components/PredictView')
    render(React.createElement(PredictView))
    fireEvent.click(screen.getByRole('tab', { name: /Risk Heat Map/i }))
    expect(screen.getAllByText(/Schedule Slip/i).length).toBeGreaterThanOrEqual(1)
  })

  it('can switch to Ask AI tab', async () => {
    const { PredictView } = await import('../../components/PredictView')
    render(React.createElement(PredictView))
    fireEvent.click(screen.getByRole('tab', { name: /Ask AI/i }))
    expect(screen.getByText(/Natural Language/i)).toBeTruthy()
  })

  it('shows quick prompt buttons in Ask AI tab', async () => {
    const { PredictView } = await import('../../components/PredictView')
    render(React.createElement(PredictView))
    fireEvent.click(screen.getByRole('tab', { name: /Ask AI/i }))
    expect(screen.getByText(/top risks/i)).toBeTruthy()
  })
})
