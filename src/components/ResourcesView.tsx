/**
 * Denver Engineering — ResourcesView  ·  Resources Overview
 */
import React from 'react'
import { LiView }  from './LiView'
import type { PolicyConfig } from '../modules/biz/dispatch'
export interface ResourcesViewProps { policy?: Partial<PolicyConfig>; biz?: Record<string,unknown>; onToast?: (m: string, t: string) => void }
export function ResourcesView({ policy, biz: _b, onToast }: ResourcesViewProps) {
  return <LiView policy={policy} onToast={onToast} />
}
export default ResourcesView
