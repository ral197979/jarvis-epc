/**
 * Tests: ComingSoonView + migrated extraction stubs
 * Coverage: renders without crash, correct label/domain/viewId, accessibility role
 *
 * P2-B remediation — v4.23.0
 * Ensures every stub migrated from raw "Phase Nb" text to ComingSoonView
 * renders correctly and exposes accessible markup.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

// Core ComingSoonView
import { ComingSoonView } from '../../components/ComingSoonView'

// All migrated stubs
import { AeView }           from '../../components/AeView'
import { AoView }           from '../../components/AoView'
import { BiView }           from '../../components/BiView'
import { CtView }           from '../../components/CtView'
import { DashboardMainView } from '../../components/DashboardMainView'
import { DetailPanelView }  from '../../components/DetailPanelView'
import { DnView }           from '../../components/DnView'
import { DtView }           from '../../components/DtView'
import { EtView }           from '../../components/EtView'
import { FeView }           from '../../components/FeView'
import { FnView }           from '../../components/FnView'
import { HiView }           from '../../components/HiView'
import { HtView }           from '../../components/HtView'
import { IeView }           from '../../components/IeView'
import { InView }           from '../../components/InView'
import { JiView }           from '../../components/JiView'
import { JnSubView }        from '../../components/JnSubView'
import { JnView }           from '../../components/JnView'
import { JobsView }         from '../../components/JobsView'
import { KtView }           from '../../components/KtView'
import { LiView }           from '../../components/LiView'
import { LoView }           from '../../components/LoView'
import { ModalShellView }   from '../../components/ModalShellView'
import { NeView }           from '../../components/NeView'
import { PnView }           from '../../components/PnView'
import { QiView }           from '../../components/QiView'
import { ResourcesView }    from '../../components/ResourcesView'
import { RoView }           from '../../components/RoView'
import { RtView }           from '../../components/RtView'
import { SafetyMainView }   from '../../components/SafetyMainView'
import { SettingsView }     from '../../components/SettingsView'
import { SoView }           from '../../components/SoView'
import { StView }           from '../../components/StView'
import { SubPanelGView }    from '../../components/SubPanelGView'
import { SubPanelQView }    from '../../components/SubPanelQView'
import { SubPanelVView }    from '../../components/SubPanelVView'
import { UnView }           from '../../components/UnView'
import { WView }            from '../../components/WView'
import { WnView }           from '../../components/WnView'
import { WtView }           from '../../components/WtView'
import { XtView }           from '../../components/XtView'
import { YiView }           from '../../components/YiView'
import { ZeView }           from '../../components/ZeView'
import { ZnView }           from '../../components/ZnView'

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

// ─── Migrated stub smoke tests ─────────────────────────────────────────────

const STUBS: Array<[string, React.ComponentType<Record<string, unknown>>, string, string]> = [
  ['AeView',           AeView as React.ComponentType<Record<string, unknown>>,           'Architecture Export',   'Engineering'],
  ['AoView',           AoView as React.ComponentType<Record<string, unknown>>,           'Architecture Overview', 'Engineering'],
  ['BiView',           BiView as React.ComponentType<Record<string, unknown>>,           'Bid Items',             'Procurement'],
  ['CtView',           CtView as React.ComponentType<Record<string, unknown>>,           'Construction Tracking', 'Construction'],
  ['DashboardMainView',DashboardMainView as React.ComponentType<Record<string, unknown>>,'Dashboard',             'Operations'],
  ['DetailPanelView',  DetailPanelView as React.ComponentType<Record<string, unknown>>,  'Detail Panel',          'Operations'],
  ['DnView',           DnView as React.ComponentType<Record<string, unknown>>,           'Design Notes',          'Engineering'],
  ['DtView',           DtView as React.ComponentType<Record<string, unknown>>,           'Document Tracking',     'Documents'],
  ['EtView',           EtView as React.ComponentType<Record<string, unknown>>,           'Equipment Tracking',    'Construction'],
  ['FeView',           FeView as React.ComponentType<Record<string, unknown>>,           'Field Engineering',     'Engineering'],
  ['FnView',           FnView as React.ComponentType<Record<string, unknown>>,           'Finance Notes',         'Finance'],
  ['HiView',           HiView as React.ComponentType<Record<string, unknown>>,           'HSE Items',             'Safety'],
  ['HtView',           HtView as React.ComponentType<Record<string, unknown>>,           'HSE Tracking',          'Safety'],
  ['IeView',           IeView as React.ComponentType<Record<string, unknown>>,           'Inspection & Engineering','Quality'],
  ['InView',           InView as React.ComponentType<Record<string, unknown>>,           'Inspection Notes',      'Quality'],
  ['JiView',           JiView as React.ComponentType<Record<string, unknown>>,           'Job Items',             'Construction'],
  ['JnSubView',        JnSubView as React.ComponentType<Record<string, unknown>>,        'Job Notes Detail',      'Construction'],
  ['JnView',           JnView as React.ComponentType<Record<string, unknown>>,           'Job Notes',             'Construction'],
  ['JobsView',         JobsView as React.ComponentType<Record<string, unknown>>,         'Jobs',                  'Construction'],
  ['KtView',           KtView as React.ComponentType<Record<string, unknown>>,           'Knowledge Base',        'Operations'],
  ['LiView',           LiView as React.ComponentType<Record<string, unknown>>,           'Labour Items',          'Procurement'],
  ['LoView',           LoView as React.ComponentType<Record<string, unknown>>,           'Logistics Overview',    'Procurement'],
  ['ModalShellView',   ModalShellView as React.ComponentType<Record<string, unknown>>,   'Modal Shell',           'Operations'],
  ['NeView',           NeView as React.ComponentType<Record<string, unknown>>,           'Network Engineering',   'Engineering'],
  ['PnView',           PnView as React.ComponentType<Record<string, unknown>>,           'Procurement Notes',     'Procurement'],
  ['QiView',           QiView as React.ComponentType<Record<string, unknown>>,           'QA Items',              'Quality'],
  ['ResourcesView',    ResourcesView as React.ComponentType<Record<string, unknown>>,    'Resources',             'Operations'],
  ['RoView',           RoView as React.ComponentType<Record<string, unknown>>,           'Risk Overview',         'Risk'],
  ['RtView',           RtView as React.ComponentType<Record<string, unknown>>,           'Risk Tracking',         'Risk'],
  ['SafetyMainView',   SafetyMainView as React.ComponentType<Record<string, unknown>>,   'Safety Main',           'Safety'],
  ['SettingsView',     SettingsView as React.ComponentType<Record<string, unknown>>,     'Settings',              'Admin'],
  ['SoView',           SoView as React.ComponentType<Record<string, unknown>>,           'Schedule Overview',     'Planning'],
  ['StView',           StView as React.ComponentType<Record<string, unknown>>,           'Schedule Tracking',     'Planning'],
  ['SubPanelGView',    SubPanelGView as React.ComponentType<Record<string, unknown>>,    'Panel G',               'Operations'],
  ['SubPanelQView',    SubPanelQView as React.ComponentType<Record<string, unknown>>,    'Panel Q',               'Operations'],
  ['SubPanelVView',    SubPanelVView as React.ComponentType<Record<string, unknown>>,    'Panel V',               'Operations'],
  ['UnView',           UnView as React.ComponentType<Record<string, unknown>>,           'Unit Notes',            'Engineering'],
  ['WView',            WView as React.ComponentType<Record<string, unknown>>,            'Work Overview',         'Construction'],
  ['WnView',           WnView as React.ComponentType<Record<string, unknown>>,           'Work Notes',            'Construction'],
  ['WtView',           WtView as React.ComponentType<Record<string, unknown>>,           'Work Tracking',         'Construction'],
  ['XtView',           XtView as React.ComponentType<Record<string, unknown>>,           'External Tracking',     'Operations'],
  ['YiView',           YiView as React.ComponentType<Record<string, unknown>>,           'Yield & Performance',   'Finance'],
  ['ZeView',           ZeView as React.ComponentType<Record<string, unknown>>,           'Zone Engineering',      'Construction'],
  ['ZnView',           ZnView as React.ComponentType<Record<string, unknown>>,           'Zone Notes',            'Construction'],
]

describe('Migrated ComingSoon stubs — smoke tests', () => {
  for (const [name, Component, expectedLabel, expectedDomain] of STUBS) {
    it(`${name}: renders without crash`, () => {
      const { container } = render(React.createElement(Component, {}))
      expect(container.firstChild).toBeTruthy()
    })

    it(`${name}: renders correct label "${expectedLabel}"`, () => {
      render(React.createElement(Component, {}))
      expect(screen.getByText(expectedLabel)).toBeTruthy()
    })

    it(`${name}: renders correct domain "${expectedDomain}"`, () => {
      render(React.createElement(Component, {}))
      expect(screen.getByText(expectedDomain)).toBeTruthy()
    })

    it(`${name}: has accessible main role`, () => {
      render(React.createElement(Component, {}))
      expect(screen.getByRole('main')).toBeTruthy()
    })
  }
})
