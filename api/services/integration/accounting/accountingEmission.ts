/**
 * Denver Engineering — emitting an approved commercial fact to an accounting provider
 * ─────────────────────────────────────────────────────────────────────────────
 * The whole slice, in one sentence: an APPROVED document, with a VALIDATED
 * customer mapping, becomes an IDEMPOTENT outbox job addressed to a
 * PROVIDER-NEUTRAL adapter, whose acknowledgement is the only thing Denver
 * records about what happened to it.
 *
 * Nothing here computes an accounting figure, and nothing here writes to a
 * ledger — because Denver has none. The outbox is `integration_jobs`
 * (migration 044), which already gives idempotency, retry, backoff and
 * dead-lettering, so this module adds no persistence of its own beyond the
 * party mapping in migration 088.
 *
 * Two owner decisions are enforced here rather than described:
 *
 *   ONLY APPROVED DOCUMENTS EMIT. `submitted` is workflow. `paid` is
 *   settlement, not a second document.
 *
 *   AR REFUSES WITHOUT A MAPPING. `projects.client_name` is free text and is
 *   never used as a fallback: a receivable posted against a guessed customer is
 *   worse than one not posted at all.
 */
import { tenantQuery } from '../../../db/pool'
import { enqueueIntegrationJob, completeIntegrationJob, failIntegrationJob } from '../connectorFramework'
import {
  EMITTING_STATE, NON_EMITTING_STATE_REASON, REQUIRES_CUSTOMER_MAPPING,
  ACCOUNTING_CONTRACT_VERSION, isMoneyBearing,
  type AccountingDocumentType, type AccountingProviderId,
  type EmissionOutcome, type AccountingDocument, type AccountingAck,
} from './accountingContract'
import { buildAccountingDocument } from './accountingProjection'

/** The external customer id a project bills to, in one provider's system. */
export interface PartyLink {
  externalCustomerId: string
  externalCustomerLabel: string | null
}

/**
 * Resolve the mapped customer for a project.
 *
 * Returns null when no mapping exists — never a guess. `client_name` is not
 * consulted here or anywhere in the emission path.
 */
export async function resolvePartyLink(
  tenantId: string, projectId: string, provider: AccountingProviderId,
): Promise<PartyLink | null> {
  const res = await tenantQuery<{ external_customer_id: string; external_customer_label: string | null }>(tenantId, `
    SELECT external_customer_id, external_customer_label
      FROM accounting_party_links
     WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
       AND project_id = $1
       AND provider = $2
  `, [projectId, provider])
  const r = res.rows[0]
  return r ? { externalCustomerId: r.external_customer_id, externalCustomerLabel: r.external_customer_label } : null
}

/**
 * Create or replace the mapping for one project and provider.
 *
 * Upsert on the natural key, because one project bills to exactly one customer
 * per accounting system; a second row would make the emission target ambiguous
 * and an ambiguous receivable must not be posted. Re-mapping is deliberately
 * allowed and audited by `linked_by` — a project's billing entity genuinely
 * does change.
 */
export async function upsertPartyLink(
  tenantId: string, projectId: string, provider: AccountingProviderId,
  link: PartyLink, userId: string | null,
): Promise<PartyLink & { projectId: string; provider: string }> {
  const res = await tenantQuery<{ external_customer_id: string; external_customer_label: string | null }>(tenantId, `
    INSERT INTO accounting_party_links
      (tenant_id, project_id, provider, external_customer_id, external_customer_label, linked_by)
    VALUES (current_setting('app.current_tenant_id', true)::uuid, $1, $2, $3, $4, $5)
    ON CONFLICT (tenant_id, project_id, provider) DO UPDATE
      SET external_customer_id    = EXCLUDED.external_customer_id,
          external_customer_label = EXCLUDED.external_customer_label,
          linked_by               = EXCLUDED.linked_by,
          updated_at              = NOW()
    RETURNING external_customer_id, external_customer_label
  `, [projectId, provider, link.externalCustomerId, link.externalCustomerLabel, userId])
  const r = res.rows[0]!
  return {
    projectId, provider,
    externalCustomerId: r.external_customer_id,
    externalCustomerLabel: r.external_customer_label,
  }
}

/**
 * The connector row that represents a provider for this tenant.
 *
 * ONLY an `active` connector may receive an emission, and that is a
 * fail-closed choice rather than a strict reading of the enum.
 *
 * `connector_status` is (active, inactive, error, configuring, paused) and it
 * DEFAULTS to `configuring` — a freshly created connector has been described
 * but not switched on. An earlier form of this query said `status <> 'disabled'`,
 * a value the enum does not contain: PostgreSQL rejected the comparison outright,
 * so every emission raised `invalid input value for enum connector_status` and
 * surfaced as a 500. The mocked suite could not see it, because a mock returns a
 * row without evaluating the predicate. The live path is what found it.
 *
 * Listing the one permitted state, rather than excluding the bad ones, is what
 * stops that recurring: a new status added to the enum tomorrow is refused by
 * default instead of silently becoming emittable.
 */
async function resolveConnectorId(tenantId: string, provider: AccountingProviderId): Promise<string | null> {
  const res = await tenantQuery<{ id: string }>(tenantId, `
    SELECT id FROM integration_connectors
     WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
       AND connector_type = $1
       AND status = 'active'
     ORDER BY created_at ASC
     LIMIT 1
  `, [provider])
  return res.rows[0]?.id ?? null
}

/**
 * Emit one document, if every precondition holds.
 *
 * The caller has already proved capability and project reach; this decides
 * whether the FACT is emittable, which is a different question and the one the
 * owner decisions govern.
 */
export async function emitAccountingDocument(
  tenantId: string,
  type: AccountingDocumentType,
  denverId: string,
  provider: AccountingProviderId,
): Promise<EmissionOutcome> {
  const doc = await buildAccountingDocument(type, tenantId, denverId)
  if (!doc) {
    return { emitted: false, reason: 'not_found', detail: 'No such document in this tenant.' }
  }

  // ── 1. Approved, and only approved ──
  const required = EMITTING_STATE[type]
  if (doc.sourceState !== required) {
    return {
      emitted: false,
      reason: 'not_approved',
      sourceState: doc.sourceState,
      detail: NON_EMITTING_STATE_REASON[doc.sourceState]
        ?? `Only a document in '${required}' may be emitted; this one is '${doc.sourceState}'.`,
    }
  }

  // ── 2. A governed currency, for anything carrying money ──
  //
  // Checked BEFORE the customer mapping, deliberately. Currency applies to
  // every money-bearing type and governs what every amount on the document
  // MEANS; the mapping applies to receivables alone and only decides who is
  // billed. Reporting the narrower problem first would send someone to map a
  // customer for a document that still could not be emitted afterwards.
  //
  // OWNER DECISION, 2026-08-25: an explicit ISO-4217 declaration or nothing.
  // No USD fallback, no provider default, no tenant default. Denver's own
  // `projects.currency` and `purchase_orders.currency` are `DEFAULT 'USD'`, so
  // a value in either is indistinguishable from one nobody set — reading it
  // would be inferring a fallback and reporting it as a fact.
  //
  // Refusing is recoverable in one governance step. A receivable posted in the
  // wrong currency is a misstatement in someone else's books, and Denver has no
  // way to retract it.
  if (isMoneyBearing(type) && doc.currencyBasis !== 'declared') {
    return {
      emitted: false, reason: 'currency_not_declared',
      detail: doc.projectId
        ? 'No ISO-4217 currency is declared for this project. Declare one before emitting; Denver will not default to USD or let the provider assume.'
        : 'This money-bearing document has no project, so no currency declaration can be resolved.',
      sourceState: doc.sourceState,
    }
  }

  // ── 3. A validated customer mapping, for receivables ──
  let party: PartyLink | null = null
  if (REQUIRES_CUSTOMER_MAPPING.includes(type)) {
    if (!doc.projectId) {
      return {
        emitted: false, reason: 'customer_mapping_missing',
        detail: 'This receivable has no project, so no customer mapping can be resolved.',
      }
    }
    party = await resolvePartyLink(tenantId, doc.projectId, provider)
    if (!party) {
      return {
        emitted: false, reason: 'customer_mapping_missing',
        detail: `No ${provider} customer is mapped for this project. Map one before emitting; the project's client name is descriptive text and is never used as an identifier.`,
      }
    }
  }

  // ── 4. A configured provider ──
  const connectorId = await resolveConnectorId(tenantId, provider)
  if (!connectorId) {
    return {
      emitted: false, reason: 'provider_not_configured',
      detail: `No ACTIVE ${provider} connector exists for this tenant. A connector that is still configuring, paused, inactive or in error does not receive emissions.`,
    }
  }

  // ── 5. The outbox ──
  // The resolved external id travels WITH the document, so the adapter never
  // has to look a customer up and cannot substitute a different one.
  const payload: Record<string, unknown> = {
    contractVersion: ACCOUNTING_CONTRACT_VERSION,
    provider,
    document: doc satisfies AccountingDocument,
    externalCustomerId: party?.externalCustomerId ?? null,
  }

  const jobId = await enqueueIntegrationJob(tenantId, connectorId, 'push', payload, doc.idempotencyKey)
  if (!jobId) {
    // ON CONFLICT DO NOTHING on (tenant_id, idempotency_key): this exact
    // document in this exact state is already queued or done. That is the
    // outbox working, not a failure.
    return {
      emitted: false, reason: 'already_emitted',
      detail: 'This document has already been emitted in its current state.',
      sourceState: doc.sourceState,
    }
  }

  return {
    emitted: true, jobId, provider,
    idempotencyKey: doc.idempotencyKey,
    documentType: type, denverId,
  }
}

// ─── Acknowledgement ─────────────────────────────────────────────────────────

/**
 * Record what the provider said.
 *
 * `accepted` and `rejected` both CLOSE the job: a rejection is the accounting
 * system saying the document is wrong, which a human must fix in Denver, and
 * retrying it would just fail again. Only `failed` — transport — goes back for
 * retry with the framework's existing backoff.
 *
 * Settlement is stored on the job result and surfaced through the status route.
 * It is deliberately NOT written onto `pay_applications.status`: letting an
 * external system drive a Denver lifecycle transition is a separate controls
 * decision, and it is recorded as an open question rather than assumed.
 */
export async function recordAcknowledgement(
  tenantId: string, jobId: string, ack: AccountingAck,
): Promise<void> {
  if (ack.state === 'failed') {
    // Argument order is (jobId, tenantId, error) — both are strings, so a
    // reversed call type-checks cleanly and silently updates nothing.
    await failIntegrationJob(jobId, tenantId, ack.message ?? 'Provider reported a transport failure')
    return
  }
  await completeIntegrationJob(jobId, tenantId, {
    contractVersion: ack.contractVersion,
    state: ack.state,
    externalId: ack.externalId,
    externalUrl: ack.externalUrl,
    message: ack.message,
    settlement: ack.settlement ?? null,
    receivedAt: ack.receivedAt,
  })
}

// ─── Visible status ──────────────────────────────────────────────────────────

export interface DocumentIntegrationStatus {
  documentType: AccountingDocumentType
  denverId: string
  /** Null when the document has never been emitted. */
  latest: {
    jobId: string
    provider: string
    jobStatus: string
    idempotencyKey: string | null
    attempts: number
    error: string | null
    createdAt: string
    completedAt: string | null
    ack: Record<string, unknown> | null
  } | null
  history: number
}

/**
 * What happened to this document at the boundary.
 *
 * Reads the outbox, which is the only place the crossing is recorded. There is
 * no separate link table — see ACCOUNTING_OPEN_DECISIONS.durable-document-link
 * for the case that would justify one.
 */
export async function documentIntegrationStatus(
  tenantId: string, type: AccountingDocumentType, denverId: string,
): Promise<DocumentIntegrationStatus> {
  const res = await tenantQuery<{
    id: string; connector_type: string; status: string; idempotency_key: string | null
    attempts: number; error: string | null; created_at: string; completed_at: string | null
    result: Record<string, unknown> | null
  }>(tenantId, `
    SELECT j.id, c.connector_type, j.status, j.idempotency_key,
           j.attempts, j.error, j.created_at::text, j.completed_at::text, j.result
      FROM integration_jobs j
      JOIN integration_connectors c ON c.id = j.connector_id
     WHERE j.tenant_id = current_setting('app.current_tenant_id', true)::uuid
       AND j.payload -> 'document' ->> 'type' = $1
       AND j.payload -> 'document' ->> 'denverId' = $2
     ORDER BY j.created_at DESC
  `, [type, denverId])

  const rows = res.rows
  const top = rows[0]
  return {
    documentType: type,
    denverId,
    latest: top ? {
      jobId: top.id,
      provider: top.connector_type,
      jobStatus: top.status,
      idempotencyKey: top.idempotency_key,
      attempts: top.attempts,
      error: top.error,
      createdAt: top.created_at,
      completedAt: top.completed_at,
      ack: top.result,
    } : null,
    history: rows.length,
  }
}
