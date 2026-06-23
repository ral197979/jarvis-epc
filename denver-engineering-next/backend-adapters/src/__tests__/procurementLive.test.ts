import { describe, it, expect } from 'vitest'
import { mapPurchaseOrder, mapVendor, type RawPurchaseOrder, type RawVendor } from '../live/procurementLive'

const rawPo: RawPurchaseOrder = {
  id: 'uuid-po1',
  po_number: 'PO-4510-14',
  title: 'Gas Turbine Generators (2x)',
  status: 'delayed',
  currency: 'USD',
  total_amount: 48_200_000,
  required_date: '2024-12-01',
  vendor_name: 'Siemens Energy',
  metadata: null,
}

describe('mapPurchaseOrder (live → UI)', () => {
  it('maps po_number, vendor, title and formats value', () => {
    const po = mapPurchaseOrder(rawPo)
    expect(po.id).toBe('PO-4510-14')
    expect(po.vendor).toBe('Siemens Energy')
    expect(po.description).toMatch(/Gas Turbine/)
    expect(po.value).toBe('$48.2M')
    expect(po.status).toBe('Delayed')
  })

  it('derives expediting from status', () => {
    expect(mapPurchaseOrder({ ...rawPo, status: 'delayed' }).expediting).toBe('Delayed')
    expect(mapPurchaseOrder({ ...rawPo, status: 'approved' }).expediting).toBe('On Track')
    expect(mapPurchaseOrder({ ...rawPo, status: 'dispatched' }).expediting).toBe('Dispatched')
  })

  it('handles string-typed total_amount from the pg driver', () => {
    expect(mapPurchaseOrder({ ...rawPo, total_amount: '6400000', currency: 'USD' } as RawPurchaseOrder).value).toBe('$6.4M')
  })
})

const rawVendor: RawVendor = {
  id: 'uuid-v1',
  code: 'V-SIEM',
  name: 'Siemens',
  rating: 4.1,
  metadata: { avg_lead_time_days: 280 },
}

describe('mapVendor (live → UI)', () => {
  it('maps name and reads lead time from metadata', () => {
    const v = mapVendor(rawVendor)
    expect(v.id).toBe('V-SIEM')
    expect(v.name).toBe('Siemens')
    expect(v.avgLeadTimeDays).toBe(280)
  })

  it('approximates on-time % from the 0–5 rating', () => {
    expect(mapVendor({ ...rawVendor, rating: 5 }).onTimePct).toBe(100)
    expect(mapVendor({ ...rawVendor, rating: 4 }).onTimePct).toBe(80)
    expect(mapVendor({ ...rawVendor, rating: null }).onTimePct).toBe(0)
  })
})
