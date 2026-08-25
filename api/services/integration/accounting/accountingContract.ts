/**
 * Denver Engineering — the accounting boundary
 * ─────────────────────────────────────────────────────────────────────────────
 * Denver is a project-delivery system. It owns COMMERCIAL FACTS — what was
 * committed to a vendor, what a subcontractor billed, what was applied for from
 * a client — and it is deliberately NOT an accounting system.
 *
 * This module is the contract across that line. It defines what Denver would
 * hand to an accounting system and what it needs back, in provider-neutral
 * terms, so BillBox can be added alongside the existing QuickBooks connector
 * without either becoming the shape of the boundary.
 *
 * What Denver will never hold
 * ───────────────────────────
 * This list is the point of the file, not a caveat on it. None of the following
 * exists in Denver, and adding any of it means the boundary has moved:
 *
 *   · a general ledger, chart of accounts, or journal of any kind
 *   · double-entry postings, debits, credits, or trial balances
 *   · an AR or AP ledger, ageing, or allocation of receipts to invoices
 *   · a payment ledger, remittance matching, or bank reconciliation
 *   · tax determination, currency revaluation, or period close
 *
 * Denver records the OPERATIONAL fact and its own lifecycle state. The
 * accounting system decides what that means in money terms. When a payment is
 * reported back, Denver stores it as a STATUS on its own document — never as a
 * receipt in a ledger it does not have.
 *
 * Why there are no new tables
 * ───────────────────────────
 * `integration_jobs` (migration 044) is already an idempotent outbox: it has a
 * jsonb `payload`, a jsonb `result`, retry/backoff, dead-lettering, and
 * `UNIQUE(tenant_id, idempotency_key)`. An outbound document is that payload
 * and an acknowledgement is that result, so the crossing is already durable and
 * exactly-once without inventing a schema to hold it. See ACCOUNTING_OPEN_
 * DECISIONS for the case that would justify a durable per-document link.
 */

/** Bumped when the neutral payload shape changes in a way a provider must notice. */
export const ACCOUNTING_CONTRACT_VERSION = '1.0.0'

/**
 * Providers that may sit behind this contract.
 *
 * Neutral by construction: the payloads below carry Denver's own vocabulary,
 * not QuickBooks' and not BillBox's. Mapping to a provider's object model is
 * the adapter's job, so adding BillBox is a new adapter and not a change here.
 */
export const ACCOUNTING_PROVIDERS = ['quickbooks', 'billbox'] as const
export type AccountingProviderId = typeof ACCOUNTING_PROVIDERS[number]

/**
 * The documents Denver can currently emit.
 *
 * Every one is backed by a table Denver actually writes — verified 2026-08-25.
 * Types are deliberately absent for facts Denver does not own: there is no
 * `customer` document because Denver has no customer entity (see
 * ACCOUNTING_OPEN_DECISIONS), and no `payment` document because recording a
 * payment is the accounting system's job, not Denver's.
 */
export const ACCOUNTING_DOCUMENT_TYPES = [
  /** A vendor master record, so a payable can name a party. */
  'vendor',
  /** A subcontractor's invoice: money Denver owes. Accounts payable. */
  'payable_invoice',
  /** A payment application to a client: money Denver is owed. Receivable. */
  'receivable_application',
  /** A purchase order or subcontract: a commitment, for encumbrance reporting. */
  'commitment',
] as const
export type AccountingDocumentType = typeof ACCOUNTING_DOCUMENT_TYPES[number]

/** Which Denver resource backs each document type, for scope resolution. */
export const DOCUMENT_SOURCE_RESOURCE: Record<AccountingDocumentType, string> = {
  vendor:                 'vendors',
  payable_invoice:        'subcontract_invoices',
  receivable_application: 'pay_applications',
  commitment:             'purchase_orders',
}

// ─── Outbound: what Denver sends ─────────────────────────────────────────────

/**
 * A party Denver knows about. Denver does not classify a party as a customer or
 * a supplier in accounting terms — it knows it has a VENDOR it buys from, and
 * that is all it asserts.
 */
export interface AccountingParty {
  denverId:   string
  name:       string
  externalCode: string | null
  email:      string | null
  country:    string | null
}

/** A money amount. Currency is carried, never assumed, and never converted. */
export interface AccountingAmount {
  /** Minor-unit-free decimal string, exactly as persisted. Never a float. */
  amount:   string
  currency: string | null
}

/**
 * The neutral envelope.
 *
 * `sourceState` is Denver's OWN lifecycle value, passed through verbatim rather
 * than mapped to an accounting status. A provider decides whether `submitted`
 * means postable; Denver does not pretend to know.
 */
export interface AccountingDocument {
  contractVersion: string
  type:        AccountingDocumentType
  /** Denver's primary key. The accounting system's id is NOT stored here. */
  denverId:    string
  tenantId:    string
  /** Null only where the source fact genuinely has no project. */
  projectId:   string | null
  projectCode: string | null
  /** Denver's own lifecycle state, verbatim. */
  sourceState: string
  /** Stable across retries, so a provider can dedupe. */
  idempotencyKey: string
  occurredAt:  string | null
  party:       AccountingParty | null
  /** Type-specific body — see the builders. */
  detail:      Record<string, unknown>
}

// ─── Inbound: what Denver needs back ─────────────────────────────────────────

/**
 * The outcome states Denver can act on.
 *
 * `rejected` is separate from `failed`: a rejection is the accounting system
 * saying the document is wrong, which a human must fix in Denver, while a
 * failure is transport and is retried. Collapsing them would either retry a
 * document that will never be accepted, or surface a network blip to a user as
 * a data error.
 */
export const ACCOUNTING_ACK_STATES = ['accepted', 'rejected', 'failed'] as const
export type AccountingAckState = typeof ACCOUNTING_ACK_STATES[number]

/**
 * What a provider must return.
 *
 * Deliberately narrow. Denver needs to know whether the fact landed, how to
 * find it in the other system, and whether money has moved — NOT what it was
 * posted to. `postedAccount`, journal ids and ledger lines are absent on
 * purpose: accepting them would start an accounting model inside Denver.
 */
export interface AccountingAck {
  contractVersion: string
  state:       AccountingAckState
  /** The provider's own id, so a user can be linked out to it. */
  externalId:  string | null
  externalUrl: string | null
  /** Free-text, shown to a human when `rejected`. */
  message:     string | null
  /**
   * Settlement STATUS only — never a receipt, an allocation, or a ledger entry.
   * Denver stores this against its own document so a project manager can see
   * that a bill was paid; it does not reconcile it.
   */
  settlement?: {
    settled: boolean
    settledAt: string | null
    amount: AccountingAmount | null
  }
  receivedAt: string
}

/**
 * The adapter every provider implements.
 *
 * One method, because the boundary is one-way with an acknowledgement: Denver
 * pushes a fact and learns what happened to it. There is deliberately no `pull`
 * — importing an accounting system's ledger into Denver is the thing this
 * contract exists to prevent.
 */
export interface AccountingProviderAdapter {
  readonly id: AccountingProviderId
  readonly contractVersion: string
  /** Types this provider can accept. A provider may support a subset. */
  supports(type: AccountingDocumentType): boolean
  send(doc: AccountingDocument): Promise<AccountingAck>
}

/**
 * Product decisions this boundary cannot make for itself.
 *
 * Recorded here rather than guessed at, and surfaced through the contract
 * endpoint so they are visible to whoever wires a provider up.
 */
export const ACCOUNTING_OPEN_DECISIONS: readonly { id: string; question: string; blocks: string }[] = [
  {
    id: 'customer-entity',
    question:
      'Denver has no customer or client entity — `projects.client_name` is free text and there is no table. An accounting system cannot post a receivable without a customer record. Should Denver own a customer master, or should BillBox own it and Denver reference an external customer id per project?',
    blocks: 'receivable_application',
  },
  {
    id: 'emission-trigger',
    question:
      'Which lifecycle transition should emit each document? A payable invoice could be sent at `submitted` or only at `approved`; a pay application at `submitted`, `approved`, or `paid`. This is a controls decision about who authorises money leaving or entering the books, not an engineering one.',
    blocks: 'all document types',
  },
  {
    id: 'tax-treatment',
    question:
      'Denver stores gross, retention and net on a payable invoice but holds no tax model. Does the accounting system derive tax itself, or must Denver carry a tax code per line? Carrying one means Denver starts making tax determinations.',
    blocks: 'payable_invoice, receivable_application',
  },
  {
    id: 'durable-document-link',
    question:
      'Right now the external id lives in the `integration_jobs.result` of the latest accepted job. If a document must show its accounting link after job retention expires, a small link table is justified — but only then. Should job history be retained indefinitely, or should the link be promoted to its own row?',
    blocks: 'nothing today',
  },
  {
    id: 'currency-policy',
    question:
      'Denver persists a currency per contract and defaults to USD elsewhere. Multi-currency posting, revaluation and rate sourcing all belong to the accounting system — but Denver must know whether to refuse emitting a document whose currency differs from the accounting book currency, or to send it and let the provider reject it.',
    blocks: 'all money-bearing types',
  },
]

/** A stable key so a provider can dedupe a retried send. */
export function buildIdempotencyKey(
  type: AccountingDocumentType, denverId: string, sourceState: string,
): string {
  // The state is part of the key on purpose: the same document moving from
  // `submitted` to `approved` is a NEW fact the accounting system must see, and
  // a key without it would silently suppress the second send.
  return `accounting:${ACCOUNTING_CONTRACT_VERSION}:${type}:${denverId}:${sourceState}`
}

// ─── Emission policy ─────────────────────────────────────────────────────────
//
// OWNER DECISION, 2026-08-25: only APPROVED financial documents may emit.
//
// `submitted` is workflow — it means a person has finished preparing a document
// and passed it on. It is not accounting authorization, and treating it as such
// would put unapproved figures into the books and rely on a later correction.
// So emission is gated on the approval state and nothing earlier.
//
// `paid` deliberately does NOT emit. A payment is not a second accounting
// document: the receivable already exists, and settlement arrives back through
// the acknowledgement boundary as a STATUS. Emitting on `paid` would create a
// duplicate document in the accounting system for money it already knows about.

/** The single state at which each document type becomes emittable. */
export const EMITTING_STATE: Record<AccountingDocumentType, string> = {
  vendor:                 'approved',
  payable_invoice:        'approved',
  receivable_application: 'approved',
  commitment:             'approved',
}

/**
 * States that are explicitly NOT emittable, and why — so a refusal can say
 * something better than "wrong state".
 */
export const NON_EMITTING_STATE_REASON: Record<string, string> = {
  draft:       'A draft has not been prepared for approval.',
  submitted:   'Submitted is workflow, not accounting authorization. Approve the document first.',
  negotiation: 'Still under negotiation; no approved commitment exists.',
  rejected:    'A rejected document must not reach the accounting system.',
  cancelled:   'A cancelled document must not reach the accounting system.',
  paid:        'Settlement is not a new accounting document. The receivable already exists and its settlement arrives through the acknowledgement boundary.',
}

export type EmissionRefusalReason =
  /** The document is not in its approved state. */
  | 'not_approved'
  /** AR only: no external customer mapping for the target provider. */
  | 'customer_mapping_missing'
  /** No connector is configured for the target provider in this tenant. */
  | 'provider_not_configured'
  /** The document does not exist, or is not reachable by this caller. */
  | 'not_found'
  /** This exact document+state was already enqueued; the outbox deduped it. */
  | 'already_emitted'

export interface EmissionRefusal {
  emitted: false
  reason:  EmissionRefusalReason
  detail:  string
  /** Present when the refusal is a state problem, so a UI can say which. */
  sourceState?: string
}

export interface EmissionAccepted {
  emitted: true
  jobId:   string
  provider: AccountingProviderId
  idempotencyKey: string
  documentType: AccountingDocumentType
  denverId: string
}

export type EmissionOutcome = EmissionAccepted | EmissionRefusal

/**
 * Document types that require a mapped external customer before they may emit.
 *
 * Receivables only. A payable names a VENDOR, which Denver does own as master
 * data, so it carries its party in the document itself.
 */
export const REQUIRES_CUSTOMER_MAPPING: readonly AccountingDocumentType[] = ['receivable_application']
