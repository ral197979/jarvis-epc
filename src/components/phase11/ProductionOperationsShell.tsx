// Denver Engineering — Production Operations Shell (Phase 11)
// Top-level GA operations shell with tabs for all Phase 11 operational views

import React, { useState } from 'react'
import { GALaunchDashboard } from './GALaunchDashboard'
import { ReadinessScoreMatrix } from './ReadinessScoreMatrix'
import { DeploymentWaveTracker } from './DeploymentWaveTracker'
import { PilotLaunchCenter } from './PilotLaunchCenter'
import { CustomerActivationBoard } from './CustomerActivationBoard'
import { SupportCommandCenter } from './SupportCommandCenter'
import { IncidentClusterViewer } from './IncidentClusterViewer'

type TabKey =
  | 'ga_launch'
  | 'readiness'
  | 'waves'
  | 'pilots'
  | 'activation'
  | 'support'
  | 'clusters'

interface Tab {
  key: TabKey
  label: string
  icon: string
}

const TABS: Tab[] = [
  { key: 'ga_launch', label: 'GA Launch', icon: '🚀' },
  { key: 'readiness', label: 'Readiness', icon: '📊' },
  { key: 'waves', label: 'Waves', icon: '🌊' },
  { key: 'pilots', label: 'Pilots', icon: '✈' },
  { key: 'activation', label: 'Activation', icon: '⚡' },
  { key: 'support', label: 'Support', icon: '🎯' },
  { key: 'clusters', label: 'Clusters', icon: '🔴' },
]

interface ProductionOperationsShellProps {
  environment?: string
  defaultTab?: TabKey
}

export function ProductionOperationsShell({
  environment = 'production',
  defaultTab = 'ga_launch',
}: ProductionOperationsShellProps) {
  const [activeTab, setActiveTab] = useState<TabKey>(defaultTab)

  const renderTab = () => {
    switch (activeTab) {
      case 'ga_launch':
        return <GALaunchDashboard environment={environment} />
      case 'readiness':
        return <ReadinessScoreMatrix environment={environment} allowEdit />
      case 'waves':
        return <DeploymentWaveTracker />
      case 'pilots':
        return <PilotLaunchCenter />
      case 'activation':
        return <CustomerActivationBoard />
      case 'support':
        return <SupportCommandCenter />
      case 'clusters':
        return <IncidentClusterViewer />
      default:
        return null
    }
  }

  return (
    <div style={{
      background: '#0a0f1e', minHeight: '100vh', fontFamily: 'sans-serif',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        background: '#0f172a', borderBottom: '1px solid #1e293b',
        padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 20 }}>🏭</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: '#e2e8f0' }}>
              Denver Engineering — GA Operations
            </div>
            <div style={{ fontSize: 11, color: '#64748b' }}>
              {environment} · v11.0.0
            </div>
          </div>
        </div>
        <div style={{
          background: '#22c55e20', border: '1px solid #22c55e44', borderRadius: 6,
          padding: '4px 10px', fontSize: 11, color: '#22c55e', fontWeight: 600,
        }}>
          LIVE
        </div>
      </div>

      {/* Tab Bar */}
      <div style={{
        background: '#0f172a', borderBottom: '1px solid #1e293b',
        padding: '0 24px', display: 'flex', gap: 2,
      }}>
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '12px 16px', background: 'transparent', border: 'none',
              cursor: 'pointer', fontSize: 13, fontWeight: activeTab === tab.key ? 700 : 400,
              color: activeTab === tab.key ? '#e2e8f0' : '#64748b',
              borderBottom: `2px solid ${activeTab === tab.key ? '#3b82f6' : 'transparent'}`,
              display: 'flex', alignItems: 'center', gap: 6,
              transition: 'color 0.15s',
            }}
          >
            <span>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {renderTab()}
      </div>
    </div>
  )
}
