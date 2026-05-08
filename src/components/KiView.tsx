/**
 * Denver Engineering — KiView  ·  KPI Intelligence Dashboard
 */
import React from 'react'
import { YiView } from './YiView'
import type { PolicyConfig } from '../modules/biz/dispatch'
export interface KiViewProps { policy?: Partial<PolicyConfig>; biz?: Record<string,unknown> }
export function KiView({ policy, biz: _b }: KiViewProps) {
  return <YiView policy={policy} />
}
export default KiView
