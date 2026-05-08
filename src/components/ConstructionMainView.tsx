/**
 * Denver Engineering — ConstructionMainView  ·  Construction Main Dashboard
 */
import React from 'react'
import { WView } from './WView'
import type { PolicyConfig } from '../modules/biz/dispatch'
export interface ConstructionMainViewProps { policy?: Partial<PolicyConfig>; biz?: Record<string,unknown>; onNavigate?: (t: string) => void }
export function ConstructionMainView({ policy, biz: _b, onNavigate }: ConstructionMainViewProps) {
  return <WView policy={policy} onNavigate={onNavigate} />
}
export default ConstructionMainView
