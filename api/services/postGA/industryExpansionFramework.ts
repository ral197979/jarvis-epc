// Denver Engineering — Industry Expansion Framework (Post-GA)
// Manages industry playbooks and vertical templates for operational expansion

import { pool } from '../../db/pool'
import { IndustryPlaybook, VerticalTemplate, Industry } from './postGATypes'

// ─── Mappers ─────────────────────────────────────────────────────────────────

function _mapIndustryPlaybook(row: Record<string, unknown>): IndustryPlaybook {
  return {
    id: row.id as string,
    industry: row.industry as Industry,
    version: row.version as string,
    templateCount: Number(row.template_count),
    workflowCount: Number(row.workflow_count),
    complianceFrameworks: row.compliance_frameworks as string[],
    certificationStatus: row.certification_status as IndustryPlaybook['certificationStatus'],
    deploymentCount: Number(row.deployment_count),
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  }
}

function _mapVerticalTemplate(row: Record<string, unknown>): VerticalTemplate {
  return {
    id: row.id as string,
    industry: row.industry as Industry,
    templateName: row.template_name as string,
    templateType: row.template_type as VerticalTemplate['templateType'],
    replayCompatible: row.replay_compatible as boolean,
    governanceValidated: row.governance_validated as boolean,
    usageCount: Number(row.usage_count),
    createdAt: new Date(row.created_at as string),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function isPlaybookCertified(playbook: IndustryPlaybook): boolean {
  return playbook.certificationStatus === 'certified'
}

export function isTemplateDeployable(template: VerticalTemplate): boolean {
  return template.replayCompatible && template.governanceValidated
}

export function computePlaybookReadiness(playbook: IndustryPlaybook): number {
  const certScore = playbook.certificationStatus === 'certified' ? 40
    : playbook.certificationStatus === 'review' ? 25
    : playbook.certificationStatus === 'draft' ? 10
    : 0
  const contentScore = Math.min(30, playbook.templateCount * 3)
  const workflowScore = Math.min(20, playbook.workflowCount * 2)
  const complianceScore = Math.min(10, playbook.complianceFrameworks.length * 5)
  return Math.min(100, certScore + contentScore + workflowScore + complianceScore)
}

export function getDeployableTemplates(templates: VerticalTemplate[]): VerticalTemplate[] {
  return templates.filter(t => isTemplateDeployable(t))
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function registerPlaybook(
  industry: Industry,
  version: string,
  templateCount: number,
  workflowCount: number,
  complianceFrameworks: string[],
): Promise<IndustryPlaybook> {
  const result = await pool.query(
    `INSERT INTO pga_industry_playbooks
       (industry, version, template_count, workflow_count, compliance_frameworks,
        certification_status, deployment_count)
     VALUES ($1,$2,$3,$4,$5,'draft',0)
     ON CONFLICT (industry, version) DO UPDATE
       SET template_count=$3, workflow_count=$4, compliance_frameworks=$5, updated_at=NOW()
     RETURNING *`,
    [industry, version, templateCount, workflowCount, JSON.stringify(complianceFrameworks)],
  )
  return _mapIndustryPlaybook(result.rows[0])
}

export async function certifyPlaybook(playbookId: string): Promise<IndustryPlaybook> {
  const result = await pool.query(
    `UPDATE pga_industry_playbooks SET certification_status='certified', updated_at=NOW() WHERE id=$1 RETURNING *`,
    [playbookId],
  )
  if (!result.rows[0]) throw new Error(`IndustryPlaybook ${playbookId} not found`)
  return _mapIndustryPlaybook(result.rows[0])
}

export async function registerTemplate(
  industry: Industry,
  templateName: string,
  templateType: VerticalTemplate['templateType'],
  replayCompatible: boolean,
  governanceValidated: boolean,
): Promise<VerticalTemplate> {
  const result = await pool.query(
    `INSERT INTO pga_vertical_templates
       (industry, template_name, template_type, replay_compatible, governance_validated, usage_count)
     VALUES ($1,$2,$3,$4,$5,0)
     RETURNING *`,
    [industry, templateName, templateType, replayCompatible, governanceValidated],
  )
  return _mapVerticalTemplate(result.rows[0])
}

export async function getPlaybooksByIndustry(industry: Industry): Promise<IndustryPlaybook[]> {
  const result = await pool.query(
    `SELECT * FROM pga_industry_playbooks WHERE industry=$1 ORDER BY version DESC`,
    [industry],
  )
  return result.rows.map(_mapIndustryPlaybook)
}

export async function getTemplatesByIndustry(industry: Industry): Promise<VerticalTemplate[]> {
  const result = await pool.query(
    `SELECT * FROM pga_vertical_templates WHERE industry=$1 ORDER BY usage_count DESC`,
    [industry],
  )
  return result.rows.map(_mapVerticalTemplate)
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  isPlaybookCertified,
  isTemplateDeployable,
  computePlaybookReadiness,
  getDeployableTemplates,
  _mapIndustryPlaybook,
  _mapVerticalTemplate,
}
