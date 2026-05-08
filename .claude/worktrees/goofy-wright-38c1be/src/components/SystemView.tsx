/**
 * JARVIS EPC — SystemView  ·  System Overview
 */
import React from 'react'
import { HbAdminView } from './HbAdminView'
import type { PolicyConfig } from '../modules/biz/dispatch'
export interface SystemViewProps { policy?: Partial<PolicyConfig>; biz?: Record<string,unknown>; onToast?: (m: string, t: string) => void }
export function SystemView({ policy, biz: _b, onToast }: SystemViewProps) {
  return <HbAdminView policy={policy} onToast={onToast} />
}
export default SystemView
