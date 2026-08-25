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
export const ACCOUNTING_CONTRACT_VERSION = '1.1.0'
//
// 1.1.0 — the four decisions of 2026-08-25 close. The envelope gains a governed
// `currency` and `currencyBasis`, and every money-bearing document gains an
// explicit `tax` block that says UNKNOWN rather than omitting the subject. A
// provider written against 1.0.0 must notice both, which is why this is a minor
// bump and not a patch: the fields are additive, but treating a `tax` of
// `{ known: false }` as "no tax applies" would be a misreading with money in it.


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

/**
 * A money amount.
 *
 * Currency is carried, never assumed, and never converted. It is populated from
 * the document's GOVERNED currency (see `AccountingDocument.currency`) and is
 * null exactly when that is undeclared — in which case the document is not
 * emittable at all. Denver's own `projects.currency` / `purchase_orders.currency`
 * columns are never read here: they are `DEFAULT 'USD'`, so a value in one is
 * indistinguishable from a value nobody set.
 */
export interface AccountingAmount {
  /** Minor-unit-free decimal string, exactly as persisted. Never a float. */
  amount:   string
  currency: string | null
}

// ─── Tax ─────────────────────────────────────────────────────────────────────
//
// OWNER DECISION, 2026-08-25 (tax): EXPLICIT FACTS ONLY. Denver never infers
// tax. Unknown or absent tax stays unknown, and an adapter must REJECT if its
// provider requires tax data Denver does not own.
//
// Denver holds gross, retention and net on a payable invoice and a retention
// percentage on a receivable. It holds no tax code, no tax registration, no
// place-of-supply, no reverse-charge flag and no rate table. From those inputs
// there is no honest derivation of a tax amount — every route to one requires
// assuming a jurisdiction, a rate or a treatment that Denver has not been told.
//
// The failure mode this closes is silence. A payload that simply omits tax
// invites a provider to read it as "no tax applies", which for a construction
// invoice is a substantive and wrong assertion. So the subject is present and
// the answer is UNKNOWN, stated in the payload where a provider must handle it.

/** One tax fact Denver was explicitly told. Reserved: nothing produces one yet. */
export interface TaxFact {
  /** The provider's or jurisdiction's own code, verbatim. Denver never parses it. */
  code:   string
  /** Denver states an amount only when it was given one. Never computed. */
  amount: AccountingAmount | null
  /** Free text as supplied. Descriptive; not a rate Denver applies. */
  basis:  string | null
}

/**
 * Denver's tax position on a document.
 *
 * A discriminated union with no third arm, because there are only two truthful
 * states: Denver was told, or it was not. There is deliberately no
 * `{ known: true, lines: [] }` shortcut meaning "no tax" — asserting that no tax
 * applies is a tax determination, and Denver does not make those.
 */
export type TaxTreatment =
  | { known: true;  facts: readonly TaxFact[] }
  | { known: false; reason: string }

/** The reason every Denver document currently carries. Stated once, verbatim. */
export const TAX_UNKNOWN_REASON =
  'Denver holds no tax model: no tax code, registration, place of supply or rate. '
  + 'It has not been told the tax treatment of this document and will not derive one. '
  + 'Absent is not zero — a provider that requires tax must reject this document.'

/** The tax block Denver emits today, on every money-bearing document. */
export const TAX_UNKNOWN: TaxTreatment = { known: false, reason: TAX_UNKNOWN_REASON }

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
  /**
   * Stable across retries, so a provider can dedupe.
   *
   * IDENTITY DECISION, 2026-08-25: this and `denverId` ARE the identity of the
   * crossing. Nothing a provider returns may take that role — see
   * `AccountingAck.externalUrl`.
   */
  idempotencyKey: string
  occurredAt:  string | null
  party:       AccountingParty | null
  /**
   * The governed ISO-4217 currency every amount in `detail` is denominated in.
   *
   * Null means UNDECLARED, and an undeclared money-bearing document is refused
   * before it reaches the outbox. It is never 'USD' by omission.
   */
  currency:      string | null
  /** How that currency was established. Only ever told, or not told. */
  currencyBasis: 'declared' | 'undeclared'
  /**
   * Denver's tax position. Present on every money-bearing document and always
   * `{ known: false }` today — the subject is stated, the answer is unknown.
   * Null only for a document that carries no money at all (a vendor master).
   */
  tax:         TaxTreatment | null
  /** Type-specific body — see the builders. */
  detail:      Record<string, unknown>
}

/**
 * Document types that carry money and therefore require a governed currency.
 *
 * A vendor master record is the exception: it names a party and moves nothing,
 * so demanding a currency for it would block master-data sync on a governance
 * step that has no bearing on it.
 */
export const MONEY_BEARING_DOCUMENT_TYPES: readonly AccountingDocumentType[] = [
  'payable_invoice', 'receivable_application', 'commitment',
]

/** True when this type needs a declared currency before it may emit. */
export function isMoneyBearing(type: AccountingDocumentType): boolean {
  return MONEY_BEARING_DOCUMENT_TYPES.includes(type)
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
  /**
   * The provider's own id for the document it created.
   *
   * Useful, and NOT identity. Denver correlates on its own `denverId` and
   * `idempotencyKey`; this is recorded so an operator can find the document in
   * the other system, and so a support question has an answer.
   */
  externalId:  string | null
  /**
   * A human-facing deep link, if the provider offers one.
   *
   * DURABLE-LINK DECISION, 2026-08-25: Denver's immutable source identity is
   * authoritative. A deep link MAY accompany it but must never be the identity
   * or the idempotency key.
   *
   * The reason is that a URL is not an identifier — it is a rendering of one,
   * owned by the other system and changed at its convenience. Providers move
   * hosts, re-slug routes and retire tenants; a link that keys deduplication
   * would re-send a document the day a URL scheme changed, and would silently
   * merge two documents the day two URLs collided. Denver therefore stores this
   * for a human to click and keys nothing on it. `buildIdempotencyKey` reads
   * only Denver-owned facts, which is what makes that promise checkable rather
   * than aspirational.
   */
  externalUrl: string | null
  /** Free-text, shown to a human when `rejected`. */
  message:     string | null
  /**
   * Settlement STATUS only — never a receipt, an allocation, or a ledger entry.
   *
   * SETTLEMENT DECISION, 2026-08-25: an acknowledgement MUST NOT mutate
   * `pay_applications.status`, or any other Denver lifecycle. Denver owns that
   * lifecycle. External settlement is INTEGRATION EVIDENCE — it lives on the
   * outbox job's result and is read back through the status route — and it stays
   * evidence until a separate reconciliation control is deliberately designed.
   *
   * Why the obvious shortcut is refused: `pay_applications` has a `paid` state,
   * and a settled acknowledgement looks like exactly the event that should set
   * it. But `paid` in Denver means Denver's own approver marked it paid, with an
   * actor and an audit trail. Letting an external system write that state would
   * make the two indistinguishable after the fact, and would hand any provider —
   * or anything that can forge a callback from one — the ability to advance a
   * Denver commercial document. It would also be one-way: Denver has no
   * corresponding control to reverse the transition when a provider retracts a
   * settlement, so a mistaken `settled: true` would be unrecoverable through the
   * boundary that caused it.
   *
   * Reconciliation is a real requirement and is deliberately NOT solved here.
   * When it is designed it needs its own authority, its own audit record, its own
   * reversal path, and a rule for disagreement between the two systems. None of
   * those exist yet, so the honest position is that Denver shows the evidence and
   * a human decides.
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
  /**
   * Facts this provider cannot post without.
   *
   * Declared rather than discovered, so the transport can refuse a document
   * BEFORE sending it and say exactly what was missing. This is how the tax
   * decision is enforced generically: a provider that needs tax declares
   * `'tax'`, and Denver — which never has it — gets a terminal rejection naming
   * the reason instead of a provider inventing a treatment, or Denver
   * fabricating one to get the send to succeed.
   *
   * Omit for a provider that requires nothing beyond the envelope.
   */
  readonly requires?: readonly AccountingDataRequirement[]
  /** Types this provider can accept. A provider may support a subset. */
  supports(type: AccountingDocumentType): boolean
  send(doc: AccountingDocument): Promise<AccountingAck>
}

/**
 * A fact a provider may require before it can post a document.
 *
 * Kept small and concrete. Each one is checkable against the envelope alone, so
 * the transport can evaluate it without knowing anything about the provider —
 * which is what keeps the boundary neutral.
 */
export const ACCOUNTING_DATA_REQUIREMENTS = ['tax', 'currency', 'party', 'project'] as const
export type AccountingDataRequirement = typeof ACCOUNTING_DATA_REQUIREMENTS[number]

/**
 * Whether the envelope satisfies one declared requirement.
 *
 * Returns the reason it does not, or null when it does. Pure, so the transport's
 * refusal and the contract endpoint's description cannot drift apart.
 *
 * `tax` is never satisfiable today, by design: `TAX_UNKNOWN` is what Denver
 * emits, and a provider that requires tax is telling Denver it needs data Denver
 * does not own. The correct outcome is a terminal rejection a human can read —
 * not a retry, because no amount of retrying will produce a fact Denver has
 * never held.
 */
export function unmetRequirement(
  doc: AccountingDocument, requirement: AccountingDataRequirement,
): string | null {
  switch (requirement) {
    case 'tax':
      return doc.tax?.known === true ? null
        : `Provider requires tax data. ${doc.tax?.known === false ? doc.tax.reason : TAX_UNKNOWN_REASON}`
    case 'currency':
      return doc.currencyBasis === 'declared' && doc.currency
        ? null
        : 'Provider requires a currency. No governed ISO-4217 currency is declared for this project.'
    case 'party':
      return doc.party ? null
        : 'Provider requires a named party on the document. Denver holds none for this document type.'
    case 'project':
      return doc.projectId ? null
        : 'Provider requires a project reference. This document has none.'
  }
}

/**
 * Product decisions this boundary cannot make for itself.
 *
 * Recorded here rather than guessed at, and surfaced through the contract
 * endpoint so they are visible to whoever wires a provider up.
 */
export const ACCOUNTING_OPEN_DECISIONS: readonly { id: string; question: string; blocks: string }[] = [
  {
    id: 'settlement-reconciliation',
    question:
      'The settlement decision fixed what Denver does NOT do: an acknowledgement never advances a Denver lifecycle, and external settlement stays integration evidence. What it deliberately did not design is the control that would eventually let the two systems agree — who may act on a reported settlement, what audit record that produces, how it is reversed when a provider retracts, and which system wins when they disagree. Until that is designed, a settled acknowledgement is something a human reads, not something Denver acts on.',
    blocks: 'nothing today — the boundary works without it, and closing it early would grant an external system authority over a Denver commercial document',
  },
  {
    id: 'provider-receiving-contract',
    question:
      'No accounting provider has published a receiving contract, so no adapter is deployed and the transport has nothing to send through it. What each provider requires — which document types it accepts, whether it needs tax, and what it returns as an acknowledgement — is the provider\'s decision to publish, not Denver\'s to assume. The registry and the `requires` declaration exist so that answer can be implemented without reopening the boundary.',
    blocks: 'actual transmission to any provider; emission, the outbox and the transport are complete and exercised without it',
  },
]

/**
 * Decisions this boundary USED to defer, and the answers it now holds to.
 *
 * They live next to the open ones and are published through the contract
 * endpoint for the same reason: an integrator needs to know what Denver has
 * settled just as much as what it has not, and a decision recorded only in a
 * commit message is a decision nobody downstream can read.
 *
 * Each `enforcedBy` names the code that makes the decision real. A decision
 * without one is a preference.
 */
export const ACCOUNTING_SETTLED_DECISIONS: readonly {
  id: string; decision: string; rationale: string; enforcedBy: string; decidedOn: string
}[] = [
  {
    id: 'customer-entity',
    decidedOn: '2026-08-25',
    decision:
      'Denver does not get a customer master. It keeps a per-project, per-provider MAPPING to an external customer id (migration 088), and a receivable refuses to emit when the mapping for the target provider is absent.',
    rationale:
      '`projects.client_name` is free text and never an identifier, so there was nothing for an accounting system to match on. The two honest options were to build a customer master — which moves the boundary and makes Denver own party data it has no workflow to maintain — or to reference the master the accounting system already owns. The mapping holds an opaque external id and a descriptive label and nothing else; the moment an address, payment term or tax registration appears on it, Denver has started keeping a customer master after all.',
    enforcedBy: 'accounting_party_links (migration 088, one row per project per provider); REQUIRES_CUSTOMER_MAPPING gates receivable emission; resolvePartyLink never consults client_name, and the emission suite asserts it is never used as a fallback.',
  },
  {
    id: 'emission-trigger',
    decidedOn: '2026-08-25',
    decision:
      'Only an APPROVED document emits, for every document type. `submitted` does not emit, and `paid` does not emit.',
    rationale:
      '`submitted` is workflow — a person has finished preparing a document, not authorised it into the books — so emitting on it would put unapproved figures into an accounting system and rely on a later correction. `paid` is settlement rather than a second accounting document: the receivable already exists, and emitting again would duplicate it for money the accounting system already knows about. Settlement arrives back through the acknowledgement boundary instead.',
    enforcedBy: 'EMITTING_STATE pins `approved` for all four types; NON_EMITTING_STATE_REASON gives each refused state its own reason; emitAccountingDocument refuses before the outbox, and the emission suite asserts every non-approved state queues nothing.',
  },
  {
    id: 'tax-treatment',
    decidedOn: '2026-08-25',
    decision:
      'Explicit facts only. Denver never infers tax. Unknown or absent tax stays unknown and is stated as such in the payload, and an adapter must reject a document if its provider requires tax data Denver does not own.',
    rationale:
      'Denver holds gross, retention and net, and no tax model at all — no code, registration, place of supply or rate. Every derivation from those inputs requires assuming a jurisdiction or treatment nobody told Denver. Omitting the subject would be worse than stating it: a provider would read silence as "no tax applies", which for a construction invoice is a substantive and wrong assertion.',
    enforcedBy: 'TAX_UNKNOWN on every money-bearing document; unmetRequirement(\'tax\') turns a provider that needs it into a terminal rejection naming the reason.',
  },
  {
    id: 'durable-document-link',
    decidedOn: '2026-08-25',
    decision:
      'Denver\'s immutable source identity is authoritative. A human-facing deep link may accompany it, but must never be the identity or the idempotency key.',
    rationale:
      'A URL is a rendering of an identifier, not an identifier: it is owned by the other system and changed at its convenience. Keying on one would re-send a document the day a provider re-slugged a route, and would merge two documents the day two URLs collided. Denver\'s own id and idempotency key are facts it controls and can therefore stand behind.',
    enforcedBy: 'buildIdempotencyKey reads only Denver-owned facts; AccountingAck.externalUrl is recorded on the job result and used for display alone.',
  },
  {
    id: 'currency-policy',
    decidedOn: '2026-08-25',
    decision:
      'An explicit, governed ISO-4217 currency is required. There is no USD fallback, no provider default and no tenant default. A money-bearing document whose project has no declaration is blocked from emission with a named reason.',
    rationale:
      'Denver\'s existing currency columns are all DEFAULT \'USD\', so a stored \'USD\' is indistinguishable from a value nobody set. Reading one would be inferring a fallback while claiming to have been told. Refusing is recoverable in one governance step; a receivable posted in the wrong currency is a misstatement in someone else\'s books.',
    enforcedBy: 'accounting_currency_declarations (migration 089, no DEFAULT, no backfill); emission refuses with \'currency_not_declared\'; the transport re-checks before send.',
  },
  {
    id: 'settlement-lifecycle',
    decidedOn: '2026-08-25',
    decision:
      'An acknowledgement must not mutate pay_applications.status or any other Denver lifecycle. Denver owns that lifecycle. External settlement remains integration evidence until a separate reconciliation control is deliberately designed.',
    rationale:
      'Denver\'s `paid` means a Denver approver marked it paid, with an actor and an audit trail. Letting a provider write that state would make the two indistinguishable afterwards, hand anything that can forge a callback the power to advance a commercial document, and be one-way — Denver has no control to reverse the transition when a provider retracts a settlement. Reconciliation needs its own authority, audit record, reversal path and disagreement rule; none exist yet.',
    enforcedBy: 'recordAcknowledgement and the outbox transport write only integration_jobs and integration_connectors; ACK_FORBIDDEN_WRITE_TABLES pins the rule and the drainer suite asserts it against the SQL actually executed.',
  },
]

/**
 * Tables an acknowledgement path must never write.
 *
 * The settlement decision in executable form. These are the lifecycle-bearing
 * tables behind the document types this boundary emits — the ones an
 * acknowledgement is most tempting to advance, and the ones it must not.
 */
export const ACK_FORBIDDEN_WRITE_TABLES: readonly string[] = [
  'pay_applications', 'pay_application_lines',
  'subcontract_invoices', 'subcontracts',
  'purchase_orders', 'vendors', 'projects',
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
  /** Money-bearing, but nobody has declared the project's ISO-4217 currency. */
  | 'currency_not_declared'

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

// ─── Who may push a fact across this boundary ────────────────────────────────
//
// Emission used to require `cost.approve`. That was wrong in a way that only
// showed up on the day someone tried to delegate it.
//
// `cost.approve` is DENVER-INTERNAL commercial authority: approve a change
// order, an estimate, an invoice, a pay application. Emission is an EXTERNAL
// act — it puts a figure into books Denver does not own and cannot retract
// from. Binding the two meant they could never be separated: granting a
// controller the authority to push receivables to the accounting system would
// have silently granted the authority to approve change orders inside Denver.
//
// They are split by DIRECTION OF MONEY rather than pooled into one
// `accounting.emit`, because pushing a receivable and pushing a payable are not
// one authority either, and a later delegation of one must not carry the other.
//
// HOLDERS ARE UNCHANGED. Every capability below is granted to `owner` alone,
// exactly as `cost.approve` was, so this commit narrows nothing and broadens
// nothing. It makes the semantics correct so a future delegation can be made
// without collateral authority — which is the whole point of doing it before
// any provider adapter exists to make delegation attractive.

/**
 * The capability required to emit each document type.
 *
 * This is the DECLARED register, not the live guard. The routes name their
 * capability as a string literal at registration, because the ADR-014 endpoint
 * census reads route source to prove every mutation is guarded and cannot see a
 * value resolved at runtime. So the two are kept in step by assertion rather
 * than by reference: `accountingEmission.test.ts` requires each route's literal
 * to equal the entry here, and a change to either side that is not made to both
 * fails the build.
 */
export const EMISSION_CAPABILITY: Record<AccountingDocumentType, string> = {
  receivable_application: 'accounting.receivables.emit',
  payable_invoice:        'accounting.payables.emit',
  commitment:             'accounting.commitments.emit',
  vendor:                 'accounting.masterdata.emit',
}

/**
 * The capability required to choose which external customer a project's
 * receivables post against.
 *
 * Deliberately the same capability as receivable emission, not a fifth one. The
 * mapping exists for one purpose — to make AR emission possible — and holding
 * emission authority without it would be authority that cannot be exercised.
 * Splitting them would produce a grant that looks complete and is not.
 *
 * Declared here and asserted against the route's literal, for the census reason
 * given on EMISSION_CAPABILITY.
 *
 * It is emphatically NOT `cost.approve` any more: choosing the billing customer
 * is a precondition of pushing money into someone's books, not an internal
 * commercial approval, and leaving it behind would have defeated the whole
 * separation — a delegate could emit receivables but not map the customer that
 * makes emission legal, so `cost.approve` would still have had to be granted.
 */
export const PARTY_MAPPING_CAPABILITY = 'accounting.receivables.emit'

/**
 * The capability required to declare a project's currency.
 *
 * Separate from emission on purpose. The declaration governs what every future
 * emission for that project MEANS; authority to send one document must not
 * carry authority to redenominate the project's money.
 *
 * Declared here and asserted against the route's literal, for the census reason
 * given on EMISSION_CAPABILITY.
 */
export const CURRENCY_DECLARATION_CAPABILITY = 'accounting.currency.declare'
