/**
 * Denver Engineering — the governed currency of a project's money
 * ─────────────────────────────────────────────────────────────────────────────
 * OWNER DECISION, 2026-08-25: emission requires an EXPLICIT, GOVERNED ISO-4217
 * currency. No USD fallback, no provider default, no tenant default. A
 * money-bearing document whose project has no declaration is refused with a
 * named reason rather than sent under an assumption.
 *
 * Why Denver's existing currency columns are not consulted
 * ───────────────────────────────────────────────────────
 * `projects.currency`, `contracts.currency` and `purchase_orders.currency` are
 * all `DEFAULT 'USD'`. A row reading 'USD' is therefore indistinguishable from
 * a row nobody ever set. Reading one and calling the result "the currency"
 * would be inferring a fallback while claiming to have been told — which is the
 * precise failure this decision closes. Those columns stay exactly where they
 * are for Denver's own display and reporting; the boundary does not read them.
 *
 * What this module does NOT do
 * ────────────────────────────
 * It records WHICH currency, and nothing else. There is no rate here, no
 * conversion, no revaluation, no reporting-currency translation and no
 * book-currency comparison. All of those are accounting operations and belong
 * to the accounting system. Denver's only job is to state, truthfully, the
 * currency its own figures are denominated in — and to refuse when it has not
 * been told.
 */
import { tenantQuery } from '../../../db/pool'

/**
 * ISO-4217 alphabetic codes valid for denominating a payable amount.
 *
 * Deliberately the *payment* subset. ISO-4217 also assigns codes to
 * fund/settlement units (CHE, CHW, CLF, COU, MXV, USN, UYI, UYW, XSU, XUA,
 * XDR) and to precious metals (XAU, XAG, XPD, XPT). None of those denominates
 * an invoice, and accepting one would let a document be declared in a unit no
 * accounting system can post a receivable in. A code outside this set is
 * refused rather than passed through for the provider to discover.
 *
 * This is reference data, not policy. It changes when ISO-4217 changes.
 */
export const ISO_4217_CURRENCIES: ReadonlySet<string> = new Set([
  'AED','AFN','ALL','AMD','ANG','AOA','ARS','AUD','AWG','AZN',
  'BAM','BBD','BDT','BGN','BHD','BIF','BMD','BND','BOB','BRL','BSD','BTN','BWP','BYN','BZD',
  'CAD','CDF','CHF','CLP','CNY','COP','CRC','CUP','CVE','CZK',
  'DJF','DKK','DOP','DZD','EGP','ERN','ETB','EUR',
  'FJD','FKP','GBP','GEL','GHS','GIP','GMD','GNF','GTQ','GYD',
  'HKD','HNL','HTG','HUF','IDR','ILS','INR','IQD','IRR','ISK',
  'JMD','JOD','JPY','KES','KGS','KHR','KMF','KPW','KRW','KWD','KYD','KZT',
  'LAK','LBP','LKR','LRD','LSL','LYD',
  'MAD','MDL','MGA','MKD','MMK','MNT','MOP','MRU','MUR','MVR','MWK','MXN','MYR','MZN',
  'NAD','NGN','NIO','NOK','NPR','NZD','OMR',
  'PAB','PEN','PGK','PHP','PKR','PLN','PYG','QAR','RON','RSD','RUB','RWF',
  'SAR','SBD','SCR','SDG','SEK','SGD','SHP','SLE','SOS','SRD','SSP','STN','SVC','SYP','SZL',
  'THB','TJS','TMT','TND','TOP','TRY','TTD','TWD','TZS',
  'UAH','UGX','USD','UYU','UZS','VED','VES','VND','VUV',
  'WST','XAF','XCD','XCG','XOF','XPF','YER','ZAR','ZMW','ZWG',
])

/** True only for a code this boundary will let a project be denominated in. */
export function isGovernedCurrency(value: unknown): value is string {
  return typeof value === 'string' && ISO_4217_CURRENCIES.has(value)
}

/**
 * How a document's currency was established.
 *
 * There are exactly two states and no third. `declared` means a named human
 * recorded it; `undeclared` means nobody has. There is no `defaulted`,
 * `inherited` or `assumed`, because introducing one would be introducing the
 * fallback the decision forbids.
 */
export type CurrencyBasis = 'declared' | 'undeclared'

export interface CurrencyDeclaration {
  currency:   string
  declaredBy: string | null
  declaredAt: string
  note:       string | null
}

/**
 * The declared currency for a project, or null.
 *
 * Null is a real answer, not an error: it is what makes the emission refusal
 * possible. Nothing in this function reaches for a substitute.
 */
export async function resolveDeclaredCurrency(
  tenantId: string, projectId: string,
): Promise<CurrencyDeclaration | null> {
  const res = await tenantQuery<{
    currency: string; declared_by: string | null; declared_at: string; note: string | null
  }>(tenantId, `
    SELECT currency, declared_by, declared_at::text, note
      FROM accounting_currency_declarations
     WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
       AND project_id = $1
  `, [projectId])
  const r = res.rows[0]
  if (!r) return null
  // A stored code that is no longer governed is treated as UNDECLARED rather
  // than passed through. ISO-4217 retires codes; a project declared in a
  // withdrawn one has not been truthfully declared today, and emitting it would
  // be asserting a denomination nobody can settle in.
  if (!isGovernedCurrency(r.currency)) return null
  return {
    currency: r.currency,
    declaredBy: r.declared_by,
    declaredAt: r.declared_at,
    note: r.note,
  }
}

/**
 * Declare, or re-declare, the currency for one project.
 *
 * Upsert on the natural key, because a project has exactly one denomination and
 * a second row would make every amount on it ambiguous. Re-declaration is
 * allowed and audited by `declared_by` — it is a governance act, not a repair,
 * and the caller's capability (`accounting.currency.declare`) is what gates it.
 *
 * Re-declaring does NOT retroactively restate documents already emitted. Those
 * crossed the boundary carrying the currency in force at the time, and the
 * accounting system holds them; changing what Denver would send next is not the
 * same as changing what it already sent, and Denver has no authority to do the
 * second.
 */
export async function declareCurrency(
  tenantId: string, projectId: string, currency: string,
  userId: string | null, note: string | null,
): Promise<CurrencyDeclaration> {
  if (!isGovernedCurrency(currency)) {
    throw new Error(`'${currency}' is not an ISO-4217 currency this boundary will accept.`)
  }
  const res = await tenantQuery<{
    currency: string; declared_by: string | null; declared_at: string; note: string | null
  }>(tenantId, `
    INSERT INTO accounting_currency_declarations
      (tenant_id, project_id, currency, declared_by, note)
    VALUES (current_setting('app.current_tenant_id', true)::uuid, $1, $2, $3, $4)
    ON CONFLICT (tenant_id, project_id) DO UPDATE
      SET currency    = EXCLUDED.currency,
          declared_by = EXCLUDED.declared_by,
          declared_at = NOW(),
          note        = EXCLUDED.note,
          updated_at  = NOW()
    RETURNING currency, declared_by, declared_at::text, note
  `, [projectId, currency, userId, note])
  const r = res.rows[0]!
  return { currency: r.currency, declaredBy: r.declared_by, declaredAt: r.declared_at, note: r.note }
}
