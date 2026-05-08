/**
 * JARVIS EPC — OverviewView  ·  System Overview
 */
import React from 'react'
import { HubView } from './HubView'
import type { PolicyConfig } from '../modules/biz/dispatch'
export interface OverviewViewProps { policy?: Partial<PolicyConfig>; biz?: Record<string,unknown>; onNavigate?: (t: string) => void }
export function OverviewView({ policy, biz: _b, onNavigate }: OverviewViewProps) {
  return <HubView policy={policy} onNavigate={onNavigate} />
}
export default OverviewView
