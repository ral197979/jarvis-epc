/**
 * JARVIS EPC — Project Templates tests
 * Locks the v1 project-template matrix and the instantiation contract.
 */

import { describe, it, expect } from 'vitest'
import {
  PROJECT_TEMPLATES,
  listProjectTemplates,
  getProjectTemplate,
  resolveProjectTemplateKey,
  instantiateProjectTemplate,
} from '../../modules/commissioning/projectTemplates'
import { generateMatrixRows } from '../../modules/commissioning/rules'

describe('projectTemplates — registry', () => {
  it('exposes all v1 project types', () => {
    const keys = Object.keys(PROJECT_TEMPLATES).sort()
    expect(keys).toEqual([
      'commercial_building',
      'data_center',
      'hospital',
      'industrial_plant',
      'pwtp',
      'utility_plant',
      'wwtp',
    ])
  })

  it('every template has at least one system', () => {
    for (const t of listProjectTemplates()) {
      expect(t.systems.length, `${t.key} must have systems`).toBeGreaterThan(0)
    }
  })

  it('PWTP includes RO skid, dosing, UV and chlorination', () => {
    const pwtp = getProjectTemplate('pwtp')!
    const types = pwtp.systems.map(s => s.assetType)
    expect(types).toContain('ro skid')
    expect(types).toContain('dosing skid')
    expect(types).toContain('uv system')
    expect(types).toContain('chlorination system')
  })

  it('WWTP includes blower, mixer, clarifier, dosing and lift station', () => {
    const wwtp = getProjectTemplate('wwtp')!
    const types = wwtp.systems.map(s => s.assetType)
    expect(types).toContain('blower')
    expect(types).toContain('mixer')
    expect(types).toContain('clarifier')
    expect(types).toContain('dosing skid')
    expect(types).toContain('lift station')
  })

  it('Commercial Building includes AHU, chiller, pump, fire alarm and generator', () => {
    const cb = getProjectTemplate('commercial_building')!
    const types = cb.systems.map(s => s.assetType)
    expect(types).toContain('ahu')
    expect(types).toContain('chiller')
    expect(types).toContain('pump')
    expect(types).toContain('generator')
  })
})

describe('projectTemplates — resolveProjectTemplateKey', () => {
  it.each([
    ['wwtp',                'wwtp'],
    ['Wastewater plant',    'wwtp'],
    ['pwtp',                'pwtp'],
    ['Potable water',       'pwtp'],
    ['Commercial Building', 'commercial_building'],
    ['data center',         'data_center'],
    ['hospital',            'hospital'],
    ['utility plant',       'utility_plant'],
    ['industrial',          'industrial_plant'],
  ])('%s → %s', (input, expected) => {
    expect(resolveProjectTemplateKey(input)).toBe(expected)
  })

  it('returns undefined for unrelated input', () => {
    expect(resolveProjectTemplateKey('something else')).toBeUndefined()
    expect(resolveProjectTemplateKey('')).toBeUndefined()
  })
})

describe('projectTemplates — instantiateProjectTemplate', () => {
  it('produces one CxAsset per slot by default', () => {
    const tpl = PROJECT_TEMPLATES.pwtp
    const { system, assets } = instantiateProjectTemplate('pwtp', 'My PWTP')
    expect(assets).toHaveLength(tpl.systems.length)
    expect(system.name).toBe('My PWTP')
    expect(system.type).toBe('pwtp')
    for (const a of assets) {
      expect(a.systemId).toBe(system.id)
      expect(a.tag).toMatch(/001$/)
    }
  })

  it('respects a selection subset', () => {
    const selection = new Set(['Aeration Blowers', 'Clarifier'])
    const { assets } = instantiateProjectTemplate('wwtp', 'WWTP-A', selection)
    expect(assets).toHaveLength(2)
    expect(assets.map(a => a.type).sort()).toEqual(['blower', 'clarifier'])
  })

  it('falls back to template label when projectName is empty', () => {
    const { system } = instantiateProjectTemplate('hospital', '   ')
    expect(system.name).toBe('Hospital')
  })

  it('produced assets feed cleanly into generateMatrixRows', () => {
    const { system, assets } = instantiateProjectTemplate('commercial_building', 'HQ')
    const rows = generateMatrixRows(system.id, assets)
    expect(rows.length).toBeGreaterThan(0)
    // Every row should reference one of our asset tags
    const tagSet = new Set(assets.map(a => a.tag))
    for (const r of rows) {
      expect(tagSet.has(r.assetTag)).toBe(true)
    }
  })
})
