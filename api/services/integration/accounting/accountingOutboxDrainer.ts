/**
 * Denver Engineering — draining the accounting outbox
 * ─────────────────────────────────────────────────────────────────────────────
 * The transport. It claims an accounting job, resolves the adapter for its
 * provider through the registry, sends the neutral document, and records what
 * came back. It knows no provider's object model, auth scheme or error
 * vocabulary — which is what lets BillBox be added as a registration rather
 * than as a change here.
 *
 * NO PROVIDER ADAPTER EXISTS YET, ON PURPOSE. BillBox has not published its
 * receiving contract. This slice stops at a working, exercised transport so
 * that when the contract arrives it is implemented against a boundary that
 * already holds, rather than the boundary being shaped around whatever BillBox
 * turns out to want.
 *
 * The distinction the whole file turns on
 * ───────────────────────────────────────
 * REJECTED is the provider saying the document is wrong. It is TERMINAL: a
 * human must fix the fact in Denver and emit again. Retrying it would fail
 * identically forever while looking like an outage.
 *
 * FAILED is transport. It is RETRIED with backoff, and dead-letters when the
 * outbox's attempts run out.
 *
 * Collapsing the two either buries a data error inside a retry loop where
 * nobody reads it, or shows a user a network blip as though their invoice were
 * malformed. Everything below sorts one outcome into one of those two piles.
 *
 * What it never does
 * ──────────────────
 * It writes `integration_jobs` and `integration_connectors` and nothing else.
 * An acknowledgement — settled or not — does not advance
 * `pay_applications.status` or any other Denver lifecycle. Denver owns that,
 * and external settlement stays integration evidence until a reconciliation
 * control is deliberately designed. See ACCOUNTING_SETTLED_DECISIONS.
 */
import { pool } from '../../../db/pool'
import { completeIntegrationJob, failIntegrationJob } from '../connectorFramework'
import {
  ACCOUNTING_DOCUMENT_TYPES, ACCOUNTING_PROVIDERS, ACCOUNTING_CONTRACT_VERSION,
  isMoneyBearing, unmetRequirement,
  type AccountingDocument, type AccountingAck, type AccountingProviderId,
  type AccountingProviderAdapter,
} from './accountingContract'
import { getAccountingAdapter } from './accountingAdapterRegistry'

/** How many jobs one drain pass will take. Bounded so a pass cannot run away. */
export const DRAIN_BATCH = 20

/**
 * Why a job ended the way it did.
 *
 * Reported per job so an operator sees the shape of a bad batch — twenty
 * `adapter_not_registered` is a deployment gap, twenty `provider_rejected` is a
 * data problem — without reading twenty job rows.
 */
export type DrainDisposition =
  /** The provider accepted the document. Terminal, success. */
  | 'accepted'
  /** The provider refused the document. Terminal, needs a human in Denver. */
  | 'provider_rejected'
  /** Refused before sending: the provider requires data Denver does not own. */
  | 'requirement_unmet'
  /** Refused before sending: this provider does not handle this document type. */
  | 'unsupported_type'
  /** Refused before sending: the adapter speaks a different contract version. */
  | 'contract_mismatch'
  /** Refused before sending: the envelope lost its governed currency. */
  | 'currency_missing'
  /** Transport, or the adapter threw. Retried with backoff. */
  | 'transport_failed'
  /** No adapter deployed for this provider yet. Retried — a deployment gap. */
  | 'adapter_not_registered'
  /** The job payload is not a document this transport can read. Terminal. */
  | 'malformed_payload'

/** A disposition that ends the job. Anything else goes back for retry. */
const TERMINAL: readonly DrainDisposition[] = [
  'accepted', 'provider_rejected', 'requirement_unmet',
  'unsupported_type', 'contract_mismatch', 'currency_missing', 'malformed_payload',
]

export interface DrainOutcome {
  jobId:       string
  tenantId:    string
  provider:    string
  documentType: string | null
  denverId:    string | null
  disposition: DrainDisposition
  /** Human-readable, and the text stored on the job. */
  detail:      string
  /** The provider's id for the document, when it created one. */
  externalId:  string | null
}

export interface DrainReport {
  claimed:   number
  accepted:  number
  /** Terminal refusals of every kind — the batch's data problems. */
  rejected:  number
  /** Retryable outcomes — the batch's transport problems. */
  retrying:  number
  outcomes:  DrainOutcome[]
}

/** The job row the claim returns. */
interface ClaimedJob {
  id:            string
  tenant_id:     string
  connector_id:  string
  payload:       Record<string, unknown>
  attempts:      number
  connector_type: string
}

const DOCUMENT_TYPES = new Set<string>(ACCOUNTING_DOCUMENT_TYPES)
const PROVIDERS = new Set<string>(ACCOUNTING_PROVIDERS)

/**
 * Claim due accounting jobs, across tenants, for one worker.
 *
 * `FOR UPDATE ... SKIP LOCKED` so two workers never take the same job. The
 * claim is NOT tenant-scoped, because a worker serves every tenant — but that
 * is the only cross-tenant step in the file. Everything after it uses the
 * claimed row's OWN `tenant_id`, so a job belonging to tenant A is completed,
 * failed and reported against tenant A, and the worker never carries a tenant
 * from one job to the next.
 *
 * It is filtered to accounting jobs rather than reusing the framework's general
 * claim, which would take a Slack or CMMS job, increment its attempts, and then
 * have to put it back — with the attempt already spent.
 */
export async function claimAccountingJobs(
  workerId: string, limit: number = DRAIN_BATCH,
): Promise<ClaimedJob[]> {
  if (!pool) return []
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query<ClaimedJob>(`
      SELECT j.id, j.tenant_id, j.connector_id, j.payload, j.attempts,
             c.connector_type
        FROM integration_jobs j
        JOIN integration_connectors c ON c.id = j.connector_id
       WHERE j.status = 'pending'
         AND j.job_type = 'push'
         AND j.next_attempt_at <= now()
         AND j.attempts < j.max_attempts
         AND j.payload -> 'document' ->> 'type' = ANY($1)
       ORDER BY j.created_at ASC
       LIMIT $2
       FOR UPDATE OF j SKIP LOCKED
    `, [[...DOCUMENT_TYPES], limit])

    if (rows.length > 0) {
      await client.query(`
        UPDATE integration_jobs
           SET status = 'running', claimed_by = $1, claimed_at = now(),
            attempts = attempts + 1
        WHERE id = ANY($2)
      `, [workerId, rows.map(r => r.id)])
    }
    await client.query('COMMIT')
    // The in-memory copy must agree with the row, or a backoff computed from it
    // would be one rung short.
    return rows.map(r => ({ ...r, attempts: r.attempts + 1 }))
  } catch (err) {
    try { await client.query('ROLLBACK') } catch { /* the connection is going back anyway */ }
    throw err
  } finally {
    client.release()
  }
}

/** Narrow a job payload to a document, or explain why it is not one. */
function readDocument(payload: Record<string, unknown>): AccountingDocument | null {
  const doc = payload['document']
  if (!doc || typeof doc !== 'object') return null
  const d = doc as Record<string, unknown>
  if (typeof d['type'] !== 'string' || !DOCUMENT_TYPES.has(d['type'])) return null
  if (typeof d['denverId'] !== 'string' || typeof d['idempotencyKey'] !== 'string') return null
  return doc as unknown as AccountingDocument
}

/**
 * Everything that must hold before a document is handed to an adapter.
 *
 * All of it is decided from the envelope and the adapter's DECLARATIONS —
 * never by asking the provider — so a refusal here costs no call and names its
 * own reason. Returns null when the document may be sent.
 */
function preflight(
  doc: AccountingDocument, adapter: AccountingProviderAdapter,
): { disposition: DrainDisposition; detail: string } | null {
  if (adapter.contractVersion !== doc.contractVersion) {
    return {
      disposition: 'contract_mismatch',
      detail: `The ${adapter.id} adapter speaks contract ${adapter.contractVersion}; this document is ${doc.contractVersion}. Sending it would rely on the two happening to agree about fields neither has checked.`,
    }
  }
  if (!adapter.supports(doc.type)) {
    return {
      disposition: 'unsupported_type',
      detail: `The ${adapter.id} adapter does not accept '${doc.type}'.`,
    }
  }
  // Re-checked here even though emission already refused it. The envelope is
  // persisted JSON that has sat in a queue, and the currency decision is the
  // kind that must hold at the moment of transmission, not only at the moment
  // of intent. It costs one comparison.
  if (isMoneyBearing(doc.type) && (doc.currencyBasis !== 'declared' || !doc.currency)) {
    return {
      disposition: 'currency_missing',
      detail: 'This money-bearing document carries no governed ISO-4217 currency. Denver does not default to USD and will not let a provider assume one.',
    }
  }
  for (const requirement of adapter.requires ?? []) {
    const unmet = unmetRequirement(doc, requirement)
    if (unmet) {
      // Terminal, not retryable: no amount of retrying produces a fact Denver
      // has never held. This is the tax decision in force — a provider that
      // needs tax gets a rejection naming the reason, and Denver neither
      // fabricates a treatment nor lets the provider infer one.
      return { disposition: 'requirement_unmet', detail: unmet }
    }
  }
  return null
}

/** Complete a job with a terminal acknowledgement Denver composed itself. */
async function recordTerminal(
  job: ClaimedJob, disposition: DrainDisposition, detail: string, externalId: string | null,
): Promise<void> {
  await completeIntegrationJob(job.id, job.tenant_id, {
    contractVersion: ACCOUNTING_CONTRACT_VERSION,
    state: disposition === 'accepted' ? 'accepted' : 'rejected',
    disposition,
    externalId,
    externalUrl: null,
    message: detail,
    settlement: null,
    receivedAt: new Date().toISOString(),
  })
}

/**
 * Process one claimed job.
 *
 * Every path ends in exactly one of `completeIntegrationJob` (terminal) or
 * `failIntegrationJob` (retry). A job that fell through both would sit in
 * `running` forever, which is the one outcome an outbox must not have.
 */
export async function drainOne(job: ClaimedJob): Promise<DrainOutcome> {
  const tenantId = job.tenant_id
  const provider = String(job.payload['provider'] ?? job.connector_type)
  const base = { jobId: job.id, tenantId, provider, externalId: null as string | null }

  const doc = readDocument(job.payload)
  if (!doc || !PROVIDERS.has(provider)) {
    const detail = doc
      ? `'${provider}' is not an accounting provider this boundary knows.`
      : 'The job payload does not carry a readable accounting document.'
    // Terminal: a payload that cannot be read will not become readable.
    await recordTerminal(job, 'malformed_payload', detail, null)
    return { ...base, documentType: doc?.type ?? null, denverId: doc?.denverId ?? null,
             disposition: 'malformed_payload', detail }
  }

  const identified = { ...base, documentType: doc.type, denverId: doc.denverId }

  const adapter = getAccountingAdapter(provider as AccountingProviderId)
  if (!adapter) {
    // A deployment gap, not a bad document. Retried, and dead-lettered by the
    // outbox's ordinary attempt limit if the adapter never ships.
    const detail = `No adapter is deployed for '${provider}'. The document is unchanged and will send once one is registered.`
    await failIntegrationJob(job.id, tenantId, detail)
    return { ...identified, disposition: 'adapter_not_registered', detail }
  }

  const refusal = preflight(doc, adapter)
  if (refusal) {
    await recordTerminal(job, refusal.disposition, refusal.detail, null)
    return { ...identified, disposition: refusal.disposition, detail: refusal.detail }
  }

  let ack: AccountingAck
  try {
    ack = await adapter.send(doc)
  } catch (err) {
    // A thrown adapter is transport by definition: it never reached a verdict.
    // Reading it as a rejection would dead-letter a document over a DNS blip.
    const detail = err instanceof Error ? err.message : String(err)
    await failIntegrationJob(job.id, tenantId, detail)
    return { ...identified, disposition: 'transport_failed', detail }
  }

  if (ack.state === 'failed') {
    const detail = ack.message ?? 'The provider reported a transport failure.'
    await failIntegrationJob(job.id, tenantId, detail)
    return { ...identified, disposition: 'transport_failed', detail }
  }

  // `accepted` and `rejected` both close the job. The acknowledgement is
  // recorded verbatim — including settlement, which is EVIDENCE and does not
  // touch any Denver lifecycle.
  await completeIntegrationJob(job.id, tenantId, {
    contractVersion: ack.contractVersion,
    state: ack.state,
    disposition: ack.state === 'accepted' ? 'accepted' : 'provider_rejected',
    externalId: ack.externalId,
    // Recorded for a human to click. Never Denver's identity for this document
    // and never part of any key — see ACCOUNTING_SETTLED_DECISIONS.
    externalUrl: ack.externalUrl,
    message: ack.message,
    settlement: ack.settlement ?? null,
    receivedAt: ack.receivedAt,
  })

  return {
    ...identified,
    disposition: ack.state === 'accepted' ? 'accepted' : 'provider_rejected',
    detail: ack.message ?? (ack.state === 'accepted' ? 'Accepted.' : 'Rejected by the provider.'),
    externalId: ack.externalId,
  }
}

/**
 * One drain pass.
 *
 * Jobs are processed sequentially. Concurrency here would buy little — the
 * batch is bounded and providers rate-limit anyway — and would make a partial
 * failure much harder to read, which matters more for a boundary whose whole
 * job is to be legible after the fact.
 *
 * One job's failure never stops the pass: the loop catches so a single provider
 * outage cannot strand nineteen unrelated documents behind it.
 */
export async function drainAccountingOutbox(
  workerId: string, limit: number = DRAIN_BATCH,
): Promise<DrainReport> {
  const jobs = await claimAccountingJobs(workerId, limit)
  const outcomes: DrainOutcome[] = []

  for (const job of jobs) {
    try {
      outcomes.push(await drainOne(job))
    } catch (err) {
      // drainOne throwing means the RECORDING failed, not the send. The job
      // stays 'running' and is reclaimed by the stale sweep rather than being
      // silently lost, so the pass reports it and moves on.
      const detail = err instanceof Error ? err.message : String(err)
      outcomes.push({
        jobId: job.id, tenantId: job.tenant_id, provider: job.connector_type,
        documentType: null, denverId: null,
        disposition: 'transport_failed', detail, externalId: null,
      })
    }
  }

  return {
    claimed: outcomes.length,
    accepted: outcomes.filter(o => o.disposition === 'accepted').length,
    rejected: outcomes.filter(o => o.disposition !== 'accepted' && TERMINAL.includes(o.disposition)).length,
    retrying: outcomes.filter(o => !TERMINAL.includes(o.disposition)).length,
    outcomes,
  }
}

export const __drainerInternals = { readDocument, preflight, TERMINAL }
