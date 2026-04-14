/**
 * JARVIS EPC — DashboardMainView  ·  Operations Dashboard
 */
import React from 'react'
import { HubView } from './HubView'
import type { PolicyConfig } from '../modules/biz/dispatch'
export interface DashboardMainViewProps { policy?: Partial<PolicyConfig>; biz?: Record<string,unknown>; onNavigate?: (t: string) => void }
export function DashboardMainView({ policy, biz: _b, onNavigate }: DashboardMainViewProps) {
  return <HubView policy={policy} onNavigate={onNavigate} />
}
export default DashboardMainView
