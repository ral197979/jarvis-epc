/**
 * JARVIS EPC — SubPanelGView  ·  General Sub-Panel
 */
import React from 'react'
import { DocumentsSubView } from './DocumentsSubView'
import type { PolicyConfig } from '../modules/biz/dispatch'
export interface SubPanelGViewProps { policy?: Partial<PolicyConfig>; biz?: Record<string,unknown>; project?: string }
export function SubPanelGView({ policy, biz: _b, project }: SubPanelGViewProps) {
  return <DocumentsSubView policy={policy} project={project} />
}
export default SubPanelGView
