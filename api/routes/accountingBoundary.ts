/**
 * Denver Engineering — the accounting boundary, read surface
 * ─────────────────────────────────────────────────────────────────────────────
 *   GET  /api/v1/integrations/accounting/contract
 *   GET  /api/v1/integrations/accounting/outbound/:type/:id
 *   GET  /api/v1/integrations/accounting/party/:projectId/:provider
 *   PUT  /api/v1/integrations/accounting/party/:projectId/:provider
 *   GET  /api/v1/integrations/accounting/currency/:projectId
 *   PUT  /api/v1/integrations/accounting/currency/:projectId
 *   POST /api/v1/integrations/accounting/emit/:type/:id
 *   GET  /api/v1/integrations/accounting/status/:type/:id
 *
 * The emission path exists as of the owner decisions of 2026-08-25: only an
 * APPROVED document may emit, and a receivable additionally requires a mapped
 * external customer. Emission itself adds no persistence — it enqueues onto
 * `integration_jobs` (migration 044), which already provides idempotency,
 * retry, backoff and dead-lettering.
 *
 * Still absent, deliberately: any route that posts a journal, records a
 * receipt, or reads a ledger back. Denver has none of those and the boundary
 * exists to keep it that way.
 *
 * Authorization is two-dimensional on purpose. Record scope is applied against
 * the resource that actually backs the document, so a caller cannot project a
 * payable out of a project they cannot open. A platform administrator with
 * integration rights but no project reach gets 404 — the boundary is not a way
 * around ADR-014.
 *
 * The functional half is split by what the call DOES. Reading a projection is
 * `cost.view`, because the payload carries commercial figures a cost reader may
 * already see. PUSHING one is not a cost capability at all: it is an external
 * act, and it requires the dedicated `accounting.*.emit` capability for that
 * document type. Emission previously required `cost.approve`, which bound the
 * authority to send money into someone else's books to the authority to approve
 * change orders inside Denver — two things that had to be delegable apart. All
 * of the new capabilities are Owner-only, exactly as `cost.approve` was, so no
 * principal gains or loses anything at this commit.
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import { requireCapability } from '../authz/requireCapability'
import { authorizeRecordScope, requireProjectScope } from '../authz/recordScope'
import { resolveCurrentUser } from '../authz/currentUser'
import {
  ACCOUNTING_CONTRACT_VERSION, ACCOUNTING_PROVIDERS, ACCOUNTING_DOCUMENT_TYPES,
  ACCOUNTING_ACK_STATES, ACCOUNTING_OPEN_DECISIONS, ACCOUNTING_SETTLED_DECISIONS,
  DOCUMENT_SOURCE_RESOURCE, EMITTING_STATE, REQUIRES_CUSTOMER_MAPPING,
  MONEY_BEARING_DOCUMENT_TYPES, ACCOUNTING_DATA_REQUIREMENTS,
  TAX_UNKNOWN_REASON,
  type AccountingDocumentType, type AccountingProviderId,
} from '../services/integration/accounting/accountingContract'
import {
  resolveDeclaredCurrency, declareCurrency, isGovernedCurrency,
} from '../services/integration/accounting/accountingCurrency'
import { registeredAccountingProviders } from '../services/integration/accounting/accountingAdapterRegistry'
import { buildAccountingDocument } from '../services/integration/accounting/accountingProjection'
import {
  emitAccountingDocument, documentIntegrationStatus,
  resolvePartyLink, upsertPartyLink,
} from '../services/integration/accounting/accountingEmission'

type AuthTenantReq = Request & AuthenticatedRequest & TenantRequest

export const accountingBoundaryRouter = Router()
accountingBoundaryRouter.use(requireAuth as never)
accountingBoundaryRouter.use(requireTenant() as never)

const TYPES = new Set<string>(ACCOUNTING_DOCUMENT_TYPES)
const PROVIDERS = new Set<string>(ACCOUNTING_PROVIDERS)

/**
 * The contract itself, so an integrator can read the boundary without reading
 * the source. `notInScope` is part of the payload rather than a comment: it is
 * the half of the contract that says what Denver will never send or store.
 */
accountingBoundaryRouter.get('/contract', requireCapability('platform.integrations') as never, (_req: Request, res: Response) => {
  res.json({
    data: {
      contractVersion: ACCOUNTING_CONTRACT_VERSION,
      providers: ACCOUNTING_PROVIDERS,
      documentTypes: ACCOUNTING_DOCUMENT_TYPES,
      sourceResources: DOCUMENT_SOURCE_RESOURCE,
      acknowledgement: {
        states: ACCOUNTING_ACK_STATES,
        required: ['state', 'receivedAt', 'contractVersion'],
        optional: ['externalId', 'externalUrl', 'message', 'settlement'],
        note: 'Settlement is a STATUS on Denver\'s own document. Denver holds no receipt, allocation or ledger entry.',
      },
      notInScope: [
        'general ledger', 'chart of accounts', 'journal entries',
        'double-entry postings', 'AR/AP ledger or ageing',
        'payment ledger, remittance matching, bank reconciliation',
        'tax determination', 'currency revaluation', 'period close',
      ],
      emissionPolicy: {
        emittingState: EMITTING_STATE,
        requiresCustomerMapping: REQUIRES_CUSTOMER_MAPPING,
        note: 'Only an approved document emits. `submitted` is workflow, not accounting authorization, and `paid` is settlement rather than a second document — it arrives through the acknowledgement boundary.',
      },
      currencyPolicy: {
        required: MONEY_BEARING_DOCUMENT_TYPES,
        basis: ['declared', 'undeclared'],
        note: 'An explicit governed ISO-4217 declaration, or emission is refused with `currency_not_declared`. There is no USD fallback, no provider default and no tenant default.',
      },
      taxPolicy: {
        known: false,
        reason: TAX_UNKNOWN_REASON,
        note: 'Denver states the subject and answers UNKNOWN. A provider that declares the `tax` requirement gets a terminal rejection rather than an inferred treatment.',
      },
      identityPolicy: {
        authoritative: ['denverId', 'idempotencyKey'],
        presentationalOnly: ['externalId', 'externalUrl'],
        note: 'Denver\'s immutable source identity is authoritative. A provider deep link may accompany it and is never the identity or the idempotency key.',
      },
      adapterRequirements: ACCOUNTING_DATA_REQUIREMENTS,
      // What can actually be transmitted right now, as opposed to what the
      // contract describes. These differ today and saying so is the point: the
      // transport is complete and no provider adapter is deployed, because no
      // provider has published a receiving contract to implement.
      transport: {
        registeredProviders: registeredAccountingProviders(),
        note: 'A document addressed to a provider with no deployed adapter stays queued and retries; it is not rejected.',
      },
      settledDecisions: ACCOUNTING_SETTLED_DECISIONS,
      openDecisions: ACCOUNTING_OPEN_DECISIONS,
    },
  })
})

/**
 * The exact neutral payload Denver would send for one record.
 *
 * Read-only and side-effect free: nothing is enqueued, nothing is marked sent.
 * This is how a mapping is verified against real data before a provider is
 * enabled.
 */
accountingBoundaryRouter.get('/outbound/:type/:id', requireCapability('cost.view') as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const type = String(req.params.type)

  if (!TYPES.has(type)) {
    res.status(400).json({ error: 'unknown_document_type', allowed: [...TYPES] })
    return
  }
  const docType = type as AccountingDocumentType

  try {
    const principal = await resolveCurrentUser(req as never)
    if (!principal) { res.status(401).json({ error: 'unauthenticated' }); return }

    // Record scope against the resource that BACKS this document type, not
    // against the boundary. `vendors` has no project parent and no policy, so
    // it is not scope-resolvable — it is tenant master data reached through the
    // tenant predicate on the query alone, and the capability guard above.
    const resource = DOCUMENT_SOURCE_RESOURCE[docType]
    if (resource !== 'vendors') {
      if (await authorizeRecordScope(principal, resource, String(req.params.id)) === 'REFUSE') {
        res.status(404).json({ error: 'not_found' })
        return
      }
    }

    const doc = await buildAccountingDocument(docType, r.tenantId!, String(req.params.id))
    if (!doc) { res.status(404).json({ error: 'not_found' }); return }
    res.json({ data: doc })
  } catch (err) {
    res.status(500).json({ error: 'Failed to build accounting document', detail: (err as Error).message })
  }
})

// ─── External customer mapping ───────────────────────────────────────────────
//
// A mapping, not a customer master: an external identifier and a descriptive
// label, nothing else.
//
// Writing it requires `accounting.receivables.emit` — the same capability as AR
// emission, deliberately. The mapping exists for exactly one purpose, to make a
// receivable emittable, so holding emission authority without it would be
// authority that cannot be exercised. It is no longer `cost.approve`: getting
// this wrong bills the wrong company, which is an act at the boundary rather
// than an internal commercial approval, and leaving it behind would have
// defeated the separation — a delegate could emit receivables but not map the
// customer that makes emission legal, so `cost.approve` would still have had to
// come with it.

accountingBoundaryRouter.get('/party/:projectId/:provider', requireCapability('cost.view') as never, requireProjectScope() as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const provider = String(req.params.provider)
  if (!PROVIDERS.has(provider)) { res.status(400).json({ error: 'unknown_provider', allowed: [...PROVIDERS] }); return }
  try {
    const link = await resolvePartyLink(r.tenantId!, String(req.params.projectId), provider as AccountingProviderId)
    res.json({ data: { projectId: req.params.projectId, provider, link } })
  } catch (err) {
    res.status(500).json({ error: 'Failed to read party mapping', detail: (err as Error).message })
  }
})

accountingBoundaryRouter.put('/party/:projectId/:provider', requireCapability('accounting.receivables.emit') as never, requireProjectScope() as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const provider = String(req.params.provider)
  const b = req.body as { external_customer_id?: unknown; external_customer_label?: unknown }
  if (!PROVIDERS.has(provider)) { res.status(400).json({ error: 'unknown_provider', allowed: [...PROVIDERS] }); return }
  if (typeof b.external_customer_id !== 'string' || !b.external_customer_id.trim()) {
    res.status(400).json({ error: 'external_customer_id_required' }); return
  }
  try {
    const link = await upsertPartyLink(r.tenantId!, String(req.params.projectId), provider as AccountingProviderId, {
      externalCustomerId: b.external_customer_id.trim(),
      externalCustomerLabel: typeof b.external_customer_label === 'string' ? b.external_customer_label : null,
    }, r.auth?.sub ?? null)
    res.json({ data: link })
  } catch (err) {
    res.status(500).json({ error: 'Failed to map party', detail: (err as Error).message })
  }
})

// ─── Emission ────────────────────────────────────────────────────────────────
//
// Emitting is the act of putting a figure into books Denver does not own, so it
// carries its own capability per document type rather than borrowing
// `cost.approve`. The route proves capability and project reach; the service
// decides whether the FACT is emittable, which is the separate question the
// owner decisions govern.

/**
 * The emission decision, once. It is reached only after the caller has proved
 * BOTH capability and record scope at the route.
 */
async function emitAfterGuards(
  docType: AccountingDocumentType, req: Request, res: Response,
): Promise<void> {
  const r = req as AuthTenantReq
  const provider = String((req.body as { provider?: unknown }).provider ?? '')
  if (!PROVIDERS.has(provider)) { res.status(400).json({ error: 'unknown_provider', allowed: [...PROVIDERS] }); return }

  const outcome = await emitAccountingDocument(r.tenantId!, docType, String(req.params.id), provider as AccountingProviderId)
  if (outcome.emitted) { res.status(202).json({ data: outcome }); return }

  // A refusal is not an error: the document is real and the caller is
  // authorized, but the FACT is not emittable. 409 says "not in this state"
  // rather than 400, which would suggest a malformed request.
  const status = outcome.reason === 'not_found' ? 404 : 409
  res.status(status).json({ error: outcome.reason, detail: outcome.detail, sourceState: outcome.sourceState })
}

// ─── The four emission routes ────────────────────────────────────────────────
//
// Each document type is a LITERAL path segment with a LITERAL capability, and
// each handler resolves record scope INLINE rather than through a shared guard
// helper. Both are deliberate, and neither is style.
//
// The ADR-014 endpoint census reads this file as source. It parses
// `requireCapability('...')` to prove a mutation is guarded, and it looks for a
// record-scope call inside the handler body to prove the object half is
// enforced. A capability resolved at runtime, or a scope check hidden behind a
// wrapper, is invisible to it — and an endpoint the census cannot read is one
// whose guard could be deleted with nothing failing. The repetition below is
// what makes both controls machine-checkable per route.
//
// The URLs are unchanged from the `:type` form. An unrecognised type now
// matches no route and gets a 404, which is the honest answer: there is no
// emission endpoint for a document type nobody has assigned an authority to.

/** Money IN. Not `cost.approve`, which would have carried change-order approval. */
accountingBoundaryRouter.post('/emit/receivable_application/:id', requireCapability('accounting.receivables.emit') as never, async (req: Request, res: Response) => {
  try {
    const principal = await resolveCurrentUser(req as never)
    if (!principal) { res.status(401).json({ error: 'unauthenticated' }); return }
    if (await authorizeRecordScope(principal, DOCUMENT_SOURCE_RESOURCE['receivable_application'], String(req.params.id)) === 'REFUSE') {
      res.status(404).json({ error: 'not_found' }); return
    }
    await emitAfterGuards('receivable_application', req, res)
  } catch (err) {
    res.status(500).json({ error: 'Failed to emit document', detail: (err as Error).message })
  }
})

/** Money OUT. Authorising Denver to be billed is not authorising Denver to bill. */
accountingBoundaryRouter.post('/emit/payable_invoice/:id', requireCapability('accounting.payables.emit') as never, async (req: Request, res: Response) => {
  try {
    const principal = await resolveCurrentUser(req as never)
    if (!principal) { res.status(401).json({ error: 'unauthenticated' }); return }
    if (await authorizeRecordScope(principal, DOCUMENT_SOURCE_RESOURCE['payable_invoice'], String(req.params.id)) === 'REFUSE') {
      res.status(404).json({ error: 'not_found' }); return
    }
    await emitAfterGuards('payable_invoice', req, res)
  } catch (err) {
    res.status(500).json({ error: 'Failed to emit document', detail: (err as Error).message })
  }
})

/** An encumbrance: it commits future money rather than moving it. */
accountingBoundaryRouter.post('/emit/commitment/:id', requireCapability('accounting.commitments.emit') as never, async (req: Request, res: Response) => {
  try {
    const principal = await resolveCurrentUser(req as never)
    if (!principal) { res.status(401).json({ error: 'unauthenticated' }); return }
    if (await authorizeRecordScope(principal, DOCUMENT_SOURCE_RESOURCE['commitment'], String(req.params.id)) === 'REFUSE') {
      res.status(404).json({ error: 'not_found' }); return
    }
    await emitAfterGuards('commitment', req, res)
  } catch (err) {
    res.status(500).json({ error: 'Failed to emit document', detail: (err as Error).message })
  }
})

/**
 * Master data. No money moves, so it carries neither money capability and no
 * currency requirement.
 *
 * No record scope: `vendors` has no project parent and no scope policy. It is
 * tenant master data, reached through the tenant predicate on the projection
 * query and the capability guard above — the same treatment the read routes
 * give it.
 */
accountingBoundaryRouter.post('/emit/vendor/:id', requireCapability('accounting.masterdata.emit') as never, async (req: Request, res: Response) => {
  try {
    const principal = await resolveCurrentUser(req as never)
    if (!principal) { res.status(401).json({ error: 'unauthenticated' }); return }
    await emitAfterGuards('vendor', req, res)
  } catch (err) {
    res.status(500).json({ error: 'Failed to emit document', detail: (err as Error).message })
  }
})

// ─── Governed currency ───────────────────────────────────────────────────────
//
// The declaration a money-bearing document cannot be emitted without.
//
// It exists as a route because the alternative is a boundary that refuses
// everything forever: the owner decision forbids defaulting, so if nobody can
// declare, nothing can ever emit. The read is `cost.view` — knowing what
// currency a project's money is in is ordinary commercial reading. The write is
// `accounting.currency.declare`, separate from emission because it governs what
// every future emission for that project MEANS.

accountingBoundaryRouter.get('/currency/:projectId', requireCapability('cost.view') as never, requireProjectScope() as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    const declaration = await resolveDeclaredCurrency(r.tenantId!, String(req.params.projectId))
    res.json({
      data: {
        projectId: req.params.projectId,
        declaration,
        // Stated rather than implied. A client reading `declaration: null` must
        // not render 'USD' next to it, and this says why in the payload.
        basis: declaration ? 'declared' : 'undeclared',
        note: declaration ? null
          : 'No currency is declared. Money-bearing documents for this project cannot be emitted, and Denver will not assume USD.',
      },
    })
  } catch (err) {
    res.status(500).json({ error: 'Failed to read currency declaration', detail: (err as Error).message })
  }
})

accountingBoundaryRouter.put('/currency/:projectId', requireCapability('accounting.currency.declare') as never, requireProjectScope() as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const b = req.body as { currency?: unknown; note?: unknown }

  if (typeof b.currency !== 'string' || !b.currency.trim()) {
    res.status(400).json({ error: 'currency_required' }); return
  }
  // Case is normalised, membership is not inferred. An unrecognised code is
  // refused here rather than stored for a provider to discover, because a
  // project denominated in something nobody can settle in is not a declaration.
  const currency = b.currency.trim().toUpperCase()
  if (!isGovernedCurrency(currency)) {
    res.status(400).json({
      error: 'unknown_currency',
      detail: `'${currency}' is not an ISO-4217 currency this boundary accepts. Fund and precious-metal codes are excluded: they do not denominate an invoice.`,
    })
    return
  }

  try {
    const declaration = await declareCurrency(
      r.tenantId!, String(req.params.projectId), currency,
      r.auth?.sub ?? null, typeof b.note === 'string' ? b.note : null,
    )
    res.json({ data: { projectId: req.params.projectId, declaration, basis: 'declared' } })
  } catch (err) {
    res.status(500).json({ error: 'Failed to declare currency', detail: (err as Error).message })
  }
})

// ─── Visible integration status ──────────────────────────────────────────────

accountingBoundaryRouter.get('/status/:type/:id', requireCapability('cost.view') as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const type = String(req.params.type)
  if (!TYPES.has(type)) { res.status(400).json({ error: 'unknown_document_type', allowed: [...TYPES] }); return }
  const docType = type as AccountingDocumentType

  try {
    const principal = await resolveCurrentUser(req as never)
    if (!principal) { res.status(401).json({ error: 'unauthenticated' }); return }

    const resource = DOCUMENT_SOURCE_RESOURCE[docType]
    if (resource !== 'vendors') {
      if (await authorizeRecordScope(principal, resource, String(req.params.id)) === 'REFUSE') {
        res.status(404).json({ error: 'not_found' }); return
      }
    }
    res.json({ data: await documentIntegrationStatus(r.tenantId!, docType, String(req.params.id)) })
  } catch (err) {
    res.status(500).json({ error: 'Failed to read integration status', detail: (err as Error).message })
  }
})

export default accountingBoundaryRouter
