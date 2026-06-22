/**
 * Denver Engineering — SSRF Guard (AUD-004 / AUD-005 remediation)
 * ──────────────────────────────────────────────────────────────
 * Central validation for outbound, user-controllable URLs (webhooks, MCP
 * http_fetch, integration connectivity tests, SAML metadata).
 *
 * Blocks the classic SSRF targets:
 *   - non-http(s) schemes (file:, gopher:, ftp:, etc.)
 *   - loopback / private / link-local / CGNAT IP literals (incl. the cloud
 *     metadata endpoint 169.254.169.254 and IPv6 equivalents)
 *   - localhost and well-known internal hostnames
 *   - DNS names that RESOLVE to any of the above (best-effort, defeats the
 *     simple DNS-to-internal-IP trick; full DNS-rebinding defence requires
 *     pinning the resolved IP through to the socket — see note below)
 *
 * The synchronous core (`classifyUrl`) is dependency-free and fully unit
 * testable without network access. `assertSafeUrl` additionally performs DNS
 * resolution when the host is a name rather than a literal IP.
 */

import { lookup } from 'node:dns/promises'
import net from 'node:net'

export class SsrfBlockedError extends Error {
  readonly code = 'ssrf_blocked'
  constructor(message: string) {
    super(message)
    this.name = 'SsrfBlockedError'
  }
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata',
])

/** Is an IPv4 literal in a private / reserved / loopback / link-local range? */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some(p => Number.isNaN(p) || p < 0 || p > 255)) return false
  const [a, b] = parts as [number, number, number, number]
  if (a === 0) return true                       // 0.0.0.0/8 "this host"
  if (a === 10) return true                      // 10.0.0.0/8 private
  if (a === 127) return true                     // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true        // 169.254.0.0/16 link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true        // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 CGNAT
  if (a >= 224) return true                       // 224.0.0.0/4 multicast + 240/4 reserved
  return false
}

/** Is an IPv6 literal loopback / unique-local / link-local / unspecified? */
function isPrivateIPv6(ip: string): boolean {
  const addr = ip.toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  if (addr === '::1' || addr === '::') return true            // loopback / unspecified
  if (addr.startsWith('fc') || addr.startsWith('fd')) return true // fc00::/7 unique-local
  if (addr.startsWith('fe8') || addr.startsWith('fe9') ||
      addr.startsWith('fea') || addr.startsWith('feb')) return true // fe80::/10 link-local
  // IPv4-mapped IPv6 (::ffff:169.254.169.254 etc.) — extract the tail and re-check
  const mapped = addr.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped && mapped[1]) return isPrivateIPv4(mapped[1])
  return false
}

/** True when the given IP literal is unsafe (private/reserved/loopback/link-local). */
export function isPrivateIp(ip: string): boolean {
  const v = net.isIP(ip)
  if (v === 4) return isPrivateIPv4(ip)
  if (v === 6) return isPrivateIPv6(ip)
  return false
}

export interface UrlClassification {
  ok: boolean
  reason?: string
  /** parsed hostname (lower-cased) when the URL parsed successfully */
  hostname?: string
  /** true when the hostname is a literal IP (no DNS lookup needed) */
  isIpLiteral?: boolean
}

/**
 * Synchronous, network-free classification of a URL string.
 * Catches malformed URLs, disallowed schemes, blocked hostnames and
 * private/loopback/link-local IP *literals* (the cloud-metadata attack).
 * Hostnames that are DNS names pass here and must be resolved by assertSafeUrl.
 */
export function classifyUrl(raw: string): UrlClassification {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, reason: 'malformed_url' }
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return { ok: false, reason: `scheme_not_allowed:${url.protocol}` }
  }

  const host = url.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '')

  if (!host) return { ok: false, reason: 'empty_host' }
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost') || host.endsWith('.internal')) {
    return { ok: false, reason: `blocked_hostname:${host}`, hostname: host }
  }

  const ipVersion = net.isIP(host)
  if (ipVersion !== 0) {
    if (isPrivateIp(host)) {
      return { ok: false, reason: `private_ip:${host}`, hostname: host, isIpLiteral: true }
    }
    return { ok: true, hostname: host, isIpLiteral: true }
  }

  // DNS name — passes the sync gate; assertSafeUrl resolves it.
  return { ok: true, hostname: host, isIpLiteral: false }
}

/**
 * Full async validation: runs classifyUrl, then (for DNS names) resolves the
 * host and rejects if ANY resolved address is private/reserved.
 * Throws SsrfBlockedError when the URL must not be fetched.
 */
export async function assertSafeUrl(raw: string): Promise<void> {
  const c = classifyUrl(raw)
  if (!c.ok) throw new SsrfBlockedError(`Blocked outbound URL (${c.reason})`)
  if (c.isIpLiteral || !c.hostname) return

  let addrs: { address: string }[]
  try {
    addrs = await lookup(c.hostname, { all: true })
  } catch {
    throw new SsrfBlockedError(`DNS resolution failed for ${c.hostname}`)
  }
  for (const a of addrs) {
    if (isPrivateIp(a.address)) {
      throw new SsrfBlockedError(`Host ${c.hostname} resolves to private IP ${a.address}`)
    }
  }
}

/** Boolean convenience wrapper around assertSafeUrl (no throw). */
export async function isSafeUrl(raw: string): Promise<boolean> {
  try { await assertSafeUrl(raw); return true } catch { return false }
}
