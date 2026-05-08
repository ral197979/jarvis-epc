// Denver Engineering — Schema Mapping Engine (Phase 11)
// Define and validate field mappings from external sources to platform schema

import { pool } from '../../db/pool'
import { SchemaMappingRule } from './phase11Types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _mapRule(row: Record<string, unknown>): SchemaMappingRule {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    sourceField: row.source_field as string,
    targetField: row.target_field as string,
    transformation: row.transformation as string | null,
    required: Boolean(row.required),
    defaultValue: row.default_value as string | null,
    createdAt: new Date(row.created_at as string),
  }
}

// ─── Create Mapping Rule ──────────────────────────────────────────────────────

export async function createSchemaMappingRule(
  tenantId: string,
  sourceField: string,
  targetField: string,
  required: boolean,
  transformation: string | null = null,
  defaultValue: string | null = null
): Promise<SchemaMappingRule> {
  const result = await pool.query(
    `INSERT INTO schema_mapping_rules
       (tenant_id, source_field, target_field, transformation, required, default_value, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     RETURNING *`,
    [tenantId, sourceField, targetField, transformation, required, defaultValue]
  )
  return _mapRule(result.rows[0])
}

// ─── Get Mapping Rules ────────────────────────────────────────────────────────

export async function getSchemaMappingRules(tenantId: string): Promise<SchemaMappingRule[]> {
  const result = await pool.query(
    `SELECT * FROM schema_mapping_rules WHERE tenant_id = $1 ORDER BY required DESC, created_at ASC`,
    [tenantId]
  )
  return result.rows.map(_mapRule)
}

// ─── Delete Mapping Rule ──────────────────────────────────────────────────────

export async function deleteSchemaMappingRule(ruleId: string): Promise<void> {
  await pool.query(`DELETE FROM schema_mapping_rules WHERE id = $1`, [ruleId])
}

// ─── Apply Mapping to Row ─────────────────────────────────────────────────────

export function applyMappingToRow(
  sourceRow: Record<string, unknown>,
  rules: SchemaMappingRule[]
): { mapped: Record<string, unknown>; errors: string[] } {
  const mapped: Record<string, unknown> = {}
  const errors: string[] = []

  for (const rule of rules) {
    let value = sourceRow[rule.sourceField]

    if (value === undefined || value === null) {
      if (rule.defaultValue !== null) {
        value = rule.defaultValue
      } else if (rule.required) {
        errors.push(`Required field '${rule.sourceField}' is missing`)
        continue
      } else {
        continue
      }
    }

    if (rule.transformation) {
      value = applyTransformation(value as string, rule.transformation)
    }

    mapped[rule.targetField] = value
  }

  return { mapped, errors }
}

// ─── Apply Transformation ─────────────────────────────────────────────────────

export function applyTransformation(value: string, transformation: string): unknown {
  switch (transformation) {
    case 'to_uppercase': return String(value).toUpperCase()
    case 'to_lowercase': return String(value).toLowerCase()
    case 'to_number': return Number(value)
    case 'to_boolean': return value === 'true' || value === '1' || value === 'yes'
    case 'trim': return String(value).trim()
    case 'to_date': return new Date(value).toISOString()
    default: return value
  }
}

// ─── Validate Mapping Rules ───────────────────────────────────────────────────

export function validateMappingRules(
  rules: SchemaMappingRule[],
  sourceHeaders: string[]
): { valid: boolean; unmappedRequired: string[] } {
  const unmappedRequired: string[] = []

  for (const rule of rules) {
    if (rule.required && !sourceHeaders.includes(rule.sourceField) && rule.defaultValue === null) {
      unmappedRequired.push(rule.sourceField)
    }
  }

  return {
    valid: unmappedRequired.length === 0,
    unmappedRequired,
  }
}

// ─── Get Required Fields ──────────────────────────────────────────────────────

export function getRequiredFields(rules: SchemaMappingRule[]): string[] {
  return rules.filter(r => r.required).map(r => r.sourceField)
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  _mapRule,
  applyMappingToRow,
  applyTransformation,
  validateMappingRules,
  getRequiredFields,
}
