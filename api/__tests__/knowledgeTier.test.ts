/**
 * Tests: api/services/knowledgeTier.ts
 * Pure string-matching classifier — no mocks.
 */

import { describe, it, expect } from 'vitest'
import { classifySource, TIER_WEIGHT, __tierTables } from '../services/knowledgeTier'

describe('classifySource — OEM wins', () => {
  it('detects common HVAC / water / PLC brands as oem', () => {
    for (const [title] of [
      ['Carrier 30XA Startup Manual'],
      ['DAIKIN EWWD-FZ Installation and Operation Manual.pdf'],
      ['Yaskawa P1000 Quick Start Guide'],
      ['Grundfos CR pump service bulletin'],
      ['Allen-Bradley PanelView 800 user manual'],
      ['Siemens SIMATIC TIA Portal config'],
    ] as const) {
      expect(classifySource(title)).toBe('oem')
    }
  })

  it('case-insensitive', () => {
    expect(classifySource('CARRIER 30XA STARTUP')).toBe('oem')
    expect(classifySource('daikin ewwd manual')).toBe('oem')
  })

  it('brand present even alongside record cues still wins oem', () => {
    // A Daikin maintenance record — OEM content dominates.
    expect(classifySource('Daikin chiller maintenance record 2023')).toBe('oem')
  })
})

describe('classifySource — record vs form', () => {
  it('commissioning / start-up narratives → record', () => {
    expect(classifySource('Monrovia Booster Start-Up Report')).toBe('record')
    expect(classifySource('Functional Test Report - RO Skid')).toBe('record')
    expect(classifySource('Daily log 2024-03-14')).toBe('record')
  })

  it('forms / templates / datasheets → form', () => {
    expect(classifySource('Booster Pump Form blank')).toBe('form')
    expect(classifySource('Pre-functional checklist template')).toBe('form')
    expect(classifySource('Datasheet — valve spec')).toBe('form')
    expect(classifySource('IO List')).toBe('form')
  })

  it('form classification beats record when both cues are present', () => {
    // "pre-functional checklist" has both "pre-functional" (record cue)
    // AND "checklist" (form cue) — should be form, because it's a blank
    // to be filled, not a narrative.
    expect(classifySource('Pre-functional Checklist for chiller')).toBe('form')
  })
})

describe('classifySource — other / fallback', () => {
  it('unknown documents fall through to other', () => {
    expect(classifySource('Random white paper on hydrogen economy')).toBe('other')
    expect(classifySource('EPA dechlorination guide')).toBe('other')
  })

  it('handles empty / null titles gracefully', () => {
    expect(classifySource('')).toBe('other')
    expect(classifySource(null as unknown as string)).toBe('other')
  })

  it('explicit kind=form from caller wins over title heuristic', () => {
    // Even if the title looks like an OEM doc, if the caller says
    // kind='form' that's a stronger signal.
    expect(classifySource('Carrier form — oil change', 'form')).toBe('form')
  })
})

describe('TIER_WEIGHT ordering', () => {
  it('OEM > record > other > form', () => {
    expect(TIER_WEIGHT.oem).toBeGreaterThan(TIER_WEIGHT.record)
    expect(TIER_WEIGHT.record).toBeGreaterThan(TIER_WEIGHT.other)
    expect(TIER_WEIGHT.other).toBeGreaterThan(TIER_WEIGHT.form)
  })

  it('all weights are positive', () => {
    for (const k of ['oem','record','form','other'] as const) {
      expect(TIER_WEIGHT[k]).toBeGreaterThan(0)
    }
  })
})

describe('tier tables — sanity', () => {
  it('all manufacturer names are lowercase (classifier assumes this)', () => {
    for (const b of __tierTables.OEM_BRANDS) {
      expect(b).toBe(b.toLowerCase())
    }
  })

  it('no cue overlaps (record vs form) that would bite us', () => {
    const rec = new Set(__tierTables.RECORD_CUES)
    for (const f of __tierTables.FORM_CUES) expect(rec.has(f)).toBe(false)
  })
})
