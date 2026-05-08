/**
 * Tests: ComingSoonView + surviving migrated stubs
 *
 * v4.31.0 update: P4 stub cleanup deleted 34 unreferenced letter-code stubs.
 * This test now covers only the views that still exist after cleanup — the
 * ones kept because they're used by live components (ContentRouter's live
 * map, sibling views like ConstructionView/PlannerView/FieldOperationsView,
 * or JarvisCore's live wrappers Ki/ji/Zi).
 *
 * The label/domain text assertions were retired in the baseline-triage pass
 * because most of these stubs evolved past the ComingSoonView placeholder
 * into fully functional components (KPI cards + tables + Zustand integration).
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

// Core ComingSoonView
import { ComingSoonView } from '../../components/ComingSoonView'

// Surviving stubs (either used by live views or promoted)
import { AoView }           from '../../components/AoView'
import { BiView }           from '../../components/BiView'
import { CtView }           from '../../components/CtView'
import { DashboardMainView } from '../../components/DashboardMainView'
import { EtView }           from '../../components/EtView'
import { FeView }           from '../../components/FeView'
import { JiView }           from '../../components/JiView'
import { JobsView }         from '../../components/JobsView'
import { LiView }           from '../../components/LiView'
import { LoView }           from '../../components/LoView'
import { ModalShellView }   from '../../components/ModalShellView'
import { ResourcesView }    from '../../components/ResourcesView'
import { SafetyMainView }   from '../../components/SafetyMainView'
import { SettingsView }     from '../../components/SettingsView'
import { WView }            from '../../components/WView'
import { WtView }           from '../../components/WtView'
import { YiView }           from '../../components/YiView'

// ─── ComingSoonView unit tests ─────────────────────────────────────────────

describe('ComingSoonView', () => {
  it('renders label and domain', () => {
    render(React.createElement(ComingSoonView, {
      label: 'Test View', domain: 'Engineering', viewId: 'tv',
    }))
    expect(screen.getByText('Test View')).toBeTruthy()
    expect(screen.getByText('Engineering')).toBeTruthy()
  })

  it('sets accessible aria-label combining label', () => {
    render(React.createElement(ComingSoonView, {
      label: 'My View', domain: 'Finance', viewId: 'mv',
    }))
    expect(screen.getByRole('main', { name: /My View.*Coming Soon/i })).toBeTruthy()
  })

  it('sets data-view attribute to viewId', () => {
    const { container } = render(React.createElement(ComingSoonView, {
      label: 'Zone Notes', domain: 'Construction', viewId: 'zn',
    }))
    expect(container.querySelector('[data-view="zn"]')).toBeTruthy()
  })

  it('shows "In Active Development" status pill', () => {
    render(React.createElement(ComingSoonView, {
      label: 'Any', domain: 'Procurement', viewId: 'any',
    }))
    expect(screen.getByText('In Active Development')).toBeTruthy()
  })

  it('renders custom context message when provided', () => {
    render(React.createElement(ComingSoonView, {
      label: 'X', domain: 'Y', viewId: 'x', context: 'Custom message here',
    }))
    expect(screen.getByText('Custom message here')).toBeTruthy()
  })

  it('renders fallback context message when not provided', () => {
    render(React.createElement(ComingSoonView, {
      label: 'X', domain: 'Y', viewId: 'x',
    }))
    expect(screen.getByText(/being extracted from the core/i)).toBeTruthy()
  })
})

// ─── Surviving-stub smoke tests ─────────────────────────────────────────────

const STUBS: Array<[string, React.ComponentType<Record<string, unknown>>]> = [
  ['AoView',           AoView as React.ComponentType<Record<string, unknown>>],
  ['BiView',           BiView as React.ComponentType<Record<string, unknown>>],
  ['CtView',           CtView as React.ComponentType<Record<string, unknown>>],
  ['DashboardMainView',DashboardMainView as React.ComponentType<Record<string, unknown>>],
  ['EtView',           EtView as React.ComponentType<Record<string, unknown>>],
  ['FeView',           FeView as React.ComponentType<Record<string, unknown>>],
  ['JiView',           JiView as React.ComponentType<Record<string, unknown>>],
  ['JobsView',         JobsView as React.ComponentType<Record<string, unknown>>],
  ['LiView',           LiView as React.ComponentType<Record<string, unknown>>],
  ['LoView',           LoView as React.ComponentType<Record<string, unknown>>],
  ['ModalShellView',   ModalShellView as React.ComponentType<Record<string, unknown>>],
  ['ResourcesView',    ResourcesView as React.ComponentType<Record<string, unknown>>],
  ['SafetyMainView',   SafetyMainView as React.ComponentType<Record<string, unknown>>],
  ['SettingsView',     SettingsView as React.ComponentType<Record<string, unknown>>],
  ['WView',            WView as React.ComponentType<Record<string, unknown>>],
  ['WtView',           WtView as React.ComponentType<Record<string, unknown>>],
  ['YiView',           YiView as React.ComponentType<Record<string, unknown>>],
]

describe('Surviving stubs — smoke tests', () => {
  for (const [name, Component] of STUBS) {
    it(`${name}: renders without crash`, () => {
      const { container } = render(React.createElement(Component, {}))
      expect(container.firstChild).toBeTruthy()
    })

    it(`${name}: has an accessible landmark`, () => {
      // v4.31.0 update: some stubs render `role="dialog"` (ModalShellView) or
      // nest other landmarks (SafetyMainView wraps SafetyView → two `role="main"`).
      // Assert that AT LEAST ONE landmark role is present rather than requiring
      // exactly one `role="main"`.
      render(React.createElement(Component, {}))
      const mains     = screen.queryAllByRole('main')
      const dialogs   = screen.queryAllByRole('dialog')
      const regions   = screen.queryAllByRole('region')
      const landmarks = mains.length + dialogs.length + regions.length
      expect(landmarks).toBeGreaterThanOrEqual(1)
    })
  }
})
