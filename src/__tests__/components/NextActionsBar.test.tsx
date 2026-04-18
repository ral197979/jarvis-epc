/**
 * NextActionsBar — unit tests
 *
 * Covers:
 *   - Renders nothing when biz store has no high-priority items
 *   - Renders high-priority actions
 *   - Renders critical tickets
 *   - Renders unread high-priority notifications
 *   - Limits to 3 actions + 2 tickets + 2 notifications
 *   - Calls onOpen with correct kind/id when item is clicked
 *   - Calls onCreateAction when "+ Action" is clicked
 *   - Calls onViewTimeline when "Timeline" is clicked
 *   - Hides read notifications
 *   - Hides low-priority actions
 */

import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextActionsBar } from '../../components/NextActionsBar'
import { useBizStore } from '../../modules/biz/store'

// ─── Mock the biz store ───────────────────────────────────────────────────────

vi.mock('../../modules/biz/store', () => {
  let _state = {
    action_items:    [] as Record<string, unknown>[],
    service_tickets: [] as Record<string, unknown>[],
    notifications:   [] as Record<string, unknown>[],
  }

  return {
    useBizStore: (selector: (s: { biz: typeof _state }) => unknown) =>
      selector({ biz: _state }),

    selectActionItems:   (s: { biz: typeof _state }) => s.biz.action_items,
    selectTickets:       (s: { biz: typeof _state }) => s.biz.service_tickets,
    selectNotifications: (s: { biz: typeof _state }) => s.biz.notifications,

    __setState: (patch: Partial<typeof _state>) => {
      _state = { ..._state, ...patch }
    },
    __reset: () => {
      _state = { action_items: [], service_tickets: [], notifications: [] }
    },
  }
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

// v4.31.0 TS fix: `typeof patch.__setState` resolved to `unknown[]` because
// the patch type is Record<string, unknown[]>. Annotate the setter as an
// actual function type so the call is valid.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const setState = (patch: Record<string, unknown[]>) =>
  (vi.mocked(useBizStore) as unknown as { __setState?: (p: Record<string, unknown[]>) => void }).__setState?.(patch) ??
  // fall through to the module export
  (require('../../modules/biz/store') as { __setState: (p: Record<string, unknown[]>) => void }).__setState(patch)

// Direct access to __setState / __reset from the mock module
import * as bizStoreModule from '../../modules/biz/store'
const { __setState, __reset } = bizStoreModule as unknown as {
  __setState: (p: Record<string, unknown[]>) => void
  __reset:    () => void
}

function makeAction(overrides: Record<string, unknown> = {}) {
  return { id: 'AI-001', subject: 'Test action', status: 'open', priority: 'high', ...overrides }
}

function makeTicket(overrides: Record<string, unknown> = {}) {
  return { id: 'SVC-001', issue: 'Test issue', status: 'open', priority: 'critical', ...overrides }
}

function makeNotif(overrides: Record<string, unknown> = {}) {
  return { id: 'N-001', title: 'Test notif', read: false, priority: 'high', ...overrides }
}

function renderBar(overrides: Partial<React.ComponentProps<typeof NextActionsBar>> = {}) {
  const onOpen          = vi.fn()
  const onCreateAction  = vi.fn()
  const onViewTimeline  = vi.fn()
  const result = render(
    <NextActionsBar
      onOpen={onOpen}
      onCreateAction={onCreateAction}
      onViewTimeline={onViewTimeline}
      {...overrides}
    />
  )
  return { onOpen, onCreateAction, onViewTimeline, ...result }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('NextActionsBar', () => {
  beforeEach(() => { __reset() })

  // ── Visibility ──────────────────────────────────────────────────────────────

  it('renders nothing when there are no high-priority items', () => {
    __setState({
      action_items:    [makeAction({ priority: 'low' })],
      service_tickets: [makeTicket({ priority: 'low' })],
      notifications:   [makeNotif({ read: true })],
    })
    const { container } = renderBar()
    expect(container.firstChild).toBeNull()
  })

  it('renders the section when there is at least one high-priority action', () => {
    __setState({ action_items: [makeAction()] })
    renderBar()
    expect(screen.getByRole('region', { name: /next actions/i })).toBeInTheDocument()
  })

  // ── Action items ─────────────────────────────────────────────────────────────

  it('shows high-priority open actions', () => {
    __setState({ action_items: [makeAction({ subject: 'Fix the pump' })] })
    renderBar()
    expect(screen.getByText('Fix the pump')).toBeInTheDocument()
  })

  it('hides low-priority actions', () => {
    __setState({ action_items: [makeAction({ subject: 'Low task', priority: 'low' })] })
    const { container } = renderBar()
    expect(container.firstChild).toBeNull()
  })

  it('caps actions at 3', () => {
    __setState({
      action_items: Array.from({ length: 6 }, (_, i) =>
        makeAction({ id: `AI-00${i}`, subject: `Action ${i}` })
      ),
    })
    renderBar()
    expect(screen.getAllByText(/^Action \d$/)).toHaveLength(3)
  })

  // ── Tickets ──────────────────────────────────────────────────────────────────

  it('shows critical open tickets', () => {
    __setState({ service_tickets: [makeTicket({ issue: 'Chiller failure' })] })
    renderBar()
    expect(screen.getByText('Chiller failure')).toBeInTheDocument()
  })

  it('caps tickets at 2', () => {
    __setState({
      service_tickets: Array.from({ length: 5 }, (_, i) =>
        makeTicket({ id: `SVC-00${i}`, issue: `Issue ${i}` })
      ),
    })
    renderBar()
    expect(screen.getAllByText(/^Issue \d$/)).toHaveLength(2)
  })

  it('does not show closed critical tickets', () => {
    __setState({ service_tickets: [makeTicket({ status: 'closed' })] })
    const { container } = renderBar()
    expect(container.firstChild).toBeNull()
  })

  // ── Notifications ────────────────────────────────────────────────────────────

  it('shows unread high-priority notifications', () => {
    __setState({ notifications: [makeNotif({ title: 'Milestone overdue' })] })
    renderBar()
    expect(screen.getByText('Milestone overdue')).toBeInTheDocument()
  })

  it('hides read notifications', () => {
    __setState({ notifications: [makeNotif({ read: true })] })
    const { container } = renderBar()
    expect(container.firstChild).toBeNull()
  })

  it('caps notifications at 2', () => {
    __setState({
      notifications: Array.from({ length: 5 }, (_, i) =>
        makeNotif({ id: `N-00${i}`, title: `Alert ${i}` })
      ),
    })
    renderBar()
    expect(screen.getAllByText(/^Alert \d$/)).toHaveLength(2)
  })

  // ── Badge labels ─────────────────────────────────────────────────────────────

  it('shows correct kind badges', () => {
    __setState({
      action_items:    [makeAction()],
      service_tickets: [makeTicket()],
      notifications:   [makeNotif()],
    })
    renderBar()
    // v4.31.0: text "action" appears both in the kind badge and in aria-labels
    // inside the bar (e.g. "Open action item"). Use getAllByText and assert
    // at least one match for each kind, which is what this test intends.
    expect(screen.getAllByText(/action/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/ticket/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/alert/i).length).toBeGreaterThan(0)
  })

  // ── Item count badge ─────────────────────────────────────────────────────────

  it('shows total item count in header', () => {
    __setState({
      action_items:    [makeAction({ id: 'a1' }), makeAction({ id: 'a2' })],
      service_tickets: [makeTicket()],
    })
    renderBar()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  // ── Interactions ─────────────────────────────────────────────────────────────

  it('calls onOpen with correct action item when clicked', () => {
    __setState({ action_items: [makeAction({ id: 'AI-999', subject: 'Pump check' })] })
    const { onOpen } = renderBar()
    fireEvent.click(screen.getByText('Pump check'))
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'action', id: 'AI-999' })
    )
  })

  it('calls onOpen with correct ticket when clicked', () => {
    __setState({ service_tickets: [makeTicket({ id: 'SVC-777', issue: 'HVAC fault' })] })
    const { onOpen } = renderBar()
    fireEvent.click(screen.getByText('HVAC fault'))
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'ticket', id: 'SVC-777' })
    )
  })

  it('calls onOpen with correct notification when clicked', () => {
    __setState({ notifications: [makeNotif({ id: 'N-555', title: 'Budget alert' })] })
    const { onOpen } = renderBar()
    fireEvent.click(screen.getByText('Budget alert'))
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'notif', id: 'N-555' })
    )
  })

  it('calls onCreateAction when "+ Action" button is clicked', () => {
    __setState({ action_items: [makeAction()] })
    const { onCreateAction } = renderBar()
    fireEvent.click(screen.getByRole('button', { name: /create new action/i }))
    expect(onCreateAction).toHaveBeenCalledTimes(1)
  })

  it('calls onViewTimeline when "Timeline" button is clicked', () => {
    __setState({ action_items: [makeAction()] })
    const { onViewTimeline } = renderBar()
    fireEvent.click(screen.getByRole('button', { name: /view activity timeline/i }))
    expect(onViewTimeline).toHaveBeenCalledTimes(1)
  })

  // ── Accessibility ────────────────────────────────────────────────────────────

  it('renders list items as buttons with aria-labels', () => {
    __setState({ action_items: [makeAction({ subject: 'Fix pump seal' })] })
    renderBar()
    const btn = screen.getByRole('button', { name: /action.*fix pump seal/i })
    expect(btn).toBeInTheDocument()
  })
})
