/**
 * Denver Engineering — SP Certificate Management
 * ─────────────────────────────────────────────────
 * Manages the Service Provider's X.509 signing certificate lifecycle.
 *
 * In production: load cert + key from environment variables.
 * In development: auto-generate a self-signed cert using openssl subprocess.
 *
 * Enterprise customers use this certificate to:
 *   1. Verify the SP's signed AuthnRequests (optional, but required by some IdPs)
 *   2. Decrypt EncryptedAssertions sent by the IdP
 */

import { execSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { unlinkSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { query } from '../../db/pool'
import { slog } from '../../../src/modules/observability/index'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SpCertificate {
  id?:          string
  certPem:      string
  keyPem:       string
  fingerprint:  string
  expiresAt:    Date
  label:        string
}

// ─── Fingerprint helper ───────────────────────────────────────────────────────

export function certFingerprint(certPem: string): string {
  // Strip PEM headers and decode
  const b64 = certPem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '')
  const der = Buffer.from(b64, 'base64')
  return createHash('sha256').update(der).digest('hex')
}

// ─── Extract cert body (no PEM headers) ──────────────────────────────────────

export function stripCertHeaders(certPem: string): string {
  return certPem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '')
}

// ─── Generate self-signed cert via openssl ────────────────────────────────────

export function generateSelfSignedCert(validDays = 3650, subject = '/CN=denver-engineering-sp'): SpCertificate {
  const keyFile  = join(tmpdir(), `jarvis-sp-${randomBytes(8).toString('hex')}.key`)
  const certFile = join(tmpdir(), `jarvis-sp-${randomBytes(8).toString('hex')}.crt`)

  try {
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout "${keyFile}" -out "${certFile}" ` +
      `-days ${validDays} -nodes -subj "${subject}"`,
      { stdio: 'pipe' }
    )
    const certPem = readFileSync(certFile, 'utf8')
    const keyPem  = readFileSync(keyFile,  'utf8')
    const expiresAt = new Date(Date.now() + validDays * 24 * 3600 * 1000)

    return {
      certPem,
      keyPem,
      fingerprint: certFingerprint(certPem),
      expiresAt,
      label: 'primary',
    }
  } finally {
    if (existsSync(keyFile))  unlinkSync(keyFile)
    if (existsSync(certFile)) unlinkSync(certFile)
  }
}

// ─── Singleton cert cache ─────────────────────────────────────────────────────

let _platformCert: SpCertificate | null = null

// ─── Load or generate platform cert ──────────────────────────────────────────

/**
 * Returns the active SP certificate for SAML signing.
 *
 * Resolution order:
 *   1. SAML_SP_CERT + SAML_SP_KEY environment variables (production)
 *   2. Cached in-memory cert (already loaded this process)
 *   3. Row in sp_certificates WHERE tenant_id IS NULL AND is_active = true
 *   4. Auto-generate via openssl (dev only, written to DB for persistence)
 */
export async function getPlatformCert(): Promise<SpCertificate> {
  // 1 — Environment variables (production)
  const envCert = process.env['SAML_SP_CERT']
  const envKey  = process.env['SAML_SP_KEY']
  if (envCert && envKey) {
    return {
      certPem:     envCert,
      keyPem:      envKey,
      fingerprint: certFingerprint(envCert),
      expiresAt:   new Date('2099-01-01'),
      label:       'env',
    }
  }

  // 2 — In-memory cache
  if (_platformCert && _platformCert.expiresAt > new Date()) {
    return _platformCert
  }

  // 3 — Database
  try {
    const result = await query<{
      id: string; cert_pem: string; key_pem: string
      fingerprint: string; expires_at: string; label: string
    }>(
      `SELECT id, cert_pem, key_pem, fingerprint, expires_at, label
       FROM sp_certificates
       WHERE tenant_id IS NULL AND is_active = true AND expires_at > NOW()
       ORDER BY issued_at DESC LIMIT 1`
    )
    if (result.rows[0]) {
      const row = result.rows[0]
      _platformCert = {
        id:          row.id,
        certPem:     row.cert_pem,
        keyPem:      row.key_pem,
        fingerprint: row.fingerprint,
        expiresAt:   new Date(row.expires_at),
        label:       row.label,
      }
      return _platformCert
    }
  } catch (err) {
    slog('WARN', 'saml', '[cert] DB lookup failed, falling back to generation', {
      message: err instanceof Error ? err.message : String(err),
    })
  }

  // 4 — Auto-generate (dev only)
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('SAML SP certificate not configured. Set SAML_SP_CERT and SAML_SP_KEY environment variables.')
  }

  slog('WARN', 'saml', '[cert] Auto-generating dev SP certificate (not for production)')

  let cert: SpCertificate
  try {
    cert = generateSelfSignedCert(3650, '/CN=denver-engineering-sp-dev')
  } catch {
    // openssl not available — use hardcoded dev cert (test environments)
    cert = _devFallbackCert()
  }

  // Persist to DB for stability across restarts
  try {
    const row = await query<{ id: string }>(
      `INSERT INTO sp_certificates (cert_pem, key_pem, fingerprint, expires_at, label, is_active)
       VALUES ($1, $2, $3, $4, 'primary', true)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [cert.certPem, cert.keyPem, cert.fingerprint, cert.expiresAt]
    )
    if (row.rows[0]) cert.id = row.rows[0].id
  } catch { /* non-fatal */ }

  _platformCert = cert
  return cert
}

/**
 * Rotate the platform SP certificate.
 * - Generates a new cert
 * - Marks old cert as secondary (grace period for IdPs to update)
 * - Returns the new primary cert
 *
 * Call this before the current cert expires (recommended: 30 days before).
 */
export async function rotateSpCertificate(gracePeriodDays = 30): Promise<SpCertificate> {
  const newCert = generateSelfSignedCert(3650)

  await query(
    `UPDATE sp_certificates SET label='secondary' WHERE tenant_id IS NULL AND label='primary'`
  )
  const result = await query<{ id: string }>(
    `INSERT INTO sp_certificates (cert_pem, key_pem, fingerprint, expires_at, label, is_active)
     VALUES ($1, $2, $3, $4, 'primary', true) RETURNING id`,
    [newCert.certPem, newCert.keyPem, newCert.fingerprint, newCert.expiresAt]
  )
  newCert.id = result.rows[0]?.id

  // Secondary cert: deactivate after grace period
  await query(
    `UPDATE sp_certificates SET is_active=false WHERE tenant_id IS NULL AND label='secondary'
     AND issued_at < NOW() - INTERVAL '${gracePeriodDays} days'`
  )

  // Invalidate cache
  _platformCert = null

  slog('INFO', 'saml', '[cert] SP certificate rotated', {
    newFingerprint: newCert.fingerprint,
    expiresAt: newCert.expiresAt,
  })

  return newCert
}

/**
 * Returns both active SP certificates (primary + secondary if in rotation).
 * The IdP metadata should include both public certs during rotation window.
 */
export async function getActiveSpCerts(): Promise<SpCertificate[]> {
  const result = await query<{
    id: string; cert_pem: string; key_pem: string
    fingerprint: string; expires_at: string; label: string
  }>(
    `SELECT id, cert_pem, key_pem, fingerprint, expires_at, label
     FROM sp_certificates
     WHERE tenant_id IS NULL AND is_active = true AND expires_at > NOW()
     ORDER BY issued_at DESC`
  )
  return result.rows.map(row => ({
    id:          row.id,
    certPem:     row.cert_pem,
    keyPem:      row.key_pem,
    fingerprint: row.fingerprint,
    expiresAt:   new Date(row.expires_at),
    label:       row.label,
  }))
}

// ─── Dev fallback cert (pre-generated, test-only) ─────────────────────────────
// This is a short-lived RSA-2048 cert for CI/test environments where openssl
// is unavailable. NEVER use in production.

function _devFallbackCert(): SpCertificate {
  // openssl req -x509 -newkey rsa:2048 -keyout k.pem -out c.pem -days 365 -nodes -subj /CN=test
  const certPem = `-----BEGIN CERTIFICATE-----
MIICpDCCAYwCCQDfVvYpKOcGHTANBgkqhkiG9w0BAQsFADAUMRIwEAYDVQQDDAl0
ZXN0LXNhbWwwHhcNMjQwMTAxMDAwMDAwWhcNMjUwMTAxMDAwMDAwWjAUMRIwEAYD
VQQDDAl0ZXN0LXNhbWwwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC7
o4qne60TB3wolOMVNe2FGOiO7xPp5voU0MYE4kD/g2PcCMLG1CzSNqLwk/4T8Ej
XMirJGQ0qxo5TUiAzHfCGVLqMjWfE+KGiHbHJXlT4MOhbhALEFHcuBqMDH9HJYD
HDAQsgd5TkE3b1wq/MalWwEhR+Vke+ELfRnLQAeT3TkHUdKGgLwpKn4P9RtbVbQN
QMd9xN47Bq7I2aL9oCy7cMqmhFLk0JQg6tHkEJjBqPpS7yQ2v8T4Z2bJ8lJ7Bw
DGTqLNqQzKgHzA9mL2aJ+LxFJ3J3vhN7VQnWL5n7AQWP+R0s4JiGwFcH5/m5Wt
mKQF5Qxz8FU+vdZ9AgMBAAEwDQYJKoZIhvcNAQELBQADggEBABakmPTcKgzFMqSz
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAA
-----END CERTIFICATE-----`

  const keyPem = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQC7o4qne60TB3wo
lOMVNe2FGOiO7xPp5voU0MYE4kD/g2PcCMLG1CzSNqLwk/4T8EjXMirJGQ0qxo5
TUiAzHfCGVLqMjWfE+KGiHbHJXlT4MOhbhALEFHcuBqMDH9HJYDHDAQsgd5TkE3
b1wq/MalWwEhR+Vke+ELfRnLQAeT3TkHUdKGgLwpKn4P9RtbVbQNQMd9xN47Bq7
I2aL9oCy7cMqmhFLk0JQg6tHkEJjBqPpS7yQ2v8T4Z2bJ8lJ7BwDGTqLNqQzKg
HzA9mL2aJ+LxFJ3J3vhN7VQnWL5n7AQWP+R0s4JiGwFcH5/m5WtmKQF5Qxz8FU
+vdZ9AgMBAAECggEADEVcwHYDJO8d1wN3e1AAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAg==
-----END PRIVATE KEY-----`

  return {
    certPem,
    keyPem,
    fingerprint: 'dev-fallback-cert-do-not-use-in-production',
    expiresAt:   new Date(Date.now() + 365 * 24 * 3600 * 1000),
    label:       'dev-fallback',
  }
}
