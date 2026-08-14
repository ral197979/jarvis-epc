/**
 * Denver Engineering — test harness: dial the interface the test server bound
 * ─────────────────────────────────────────────────────────────────────────────
 * Fixes the intermittent API-test failure tracked as ADR-014 F5, which surfaced
 * as `Error: socket hang up`, `HPE_INVALID_CONSTANT` parse errors, and tests
 * receiving a status from a handler that never ran.
 *
 * THE DEFECT
 *
 * Supertest creates one throwaway HTTP server per request, calls `app.listen(0)`
 * with **no host** — so Node binds the IPv6 wildcard `::` in dual-stack mode —
 * and then builds the request URL with a hard-coded **IPv4 literal**:
 *
 *     if (!addr) this._server = app.listen(0);                  // test.js:63
 *     return protocol + '://127.0.0.1:' + port + path;          // test.js:67
 *
 * The server binds one address family and the client dials another. macOS draws
 * ephemeral ports from 49152–65535, and ordinary desktop software (FileMaker,
 * JVMs, Docker, updaters…) parks long-lived listeners on specific IPv4 loopback
 * ports inside that range. Since `127.0.0.1:P` and `::` are different address
 * families, `listen(0)` is happily assigned a port already occupied on
 * 127.0.0.1 — and TCP routes the connection to the **more specific** IPv4
 * listener, i.e. the unrelated application. Measured on the machine where F5 was
 * diagnosed, with FileMaker holding 127.0.0.1:61965:
 *
 *     listen({port: 61965})                  -> BOUND, family=IPv6, address=::
 *     connect 127.0.0.1:61965                -> connected; our server saw 0 connections
 *     connect [::1]:61965                    -> connected; our server saw it
 *
 * The foreign process answers our HTTP request with whatever it speaks, so the
 * test observes a wrong status, unparseable bytes, or a reset connection —
 * intermittently, and only when the kernel's advancing ephemeral counter lands
 * on one of the few occupied ports. Hence the failures arriving in bursts and
 * then disappearing for dozens of runs.
 *
 * THE FIX
 *
 * Dial the address family the server actually bound. When Node binds the `::`
 * wildcard, no other process can hold any IPv6 address on that port — the kernel
 * refuses a conflicting bind within the same family — so `[::1]:P` is guaranteed
 * to reach our own server. The collision is not made less likely; it is made
 * impossible.
 *
 * Why not bind `127.0.0.1` instead: `listen(0, host)` resolves the host through
 * `dns.lookup` and therefore completes asynchronously, so `server.address()` is
 * still `null` when Supertest reads it on the next line. That approach breaks
 * Supertest outright (`TypeError: Cannot read properties of null (reading
 * 'port')`), which the accompanying regression test demonstrates.
 *
 * Scope: only the URL Supertest derives from a server it just bound. Request
 * semantics, agents, timeouts and assertions are untouched.
 */
import type { AddressInfo } from 'node:net'

const PATCHED = Symbol.for('denver.test.supertestDialBoundFamily')

interface SupertestTestProto {
  serverAddress(app: { address(): AddressInfo | string | null }, path: string): string
  [key: symbol]: unknown
}

/**
 * Make Supertest dial the address family its ephemeral server bound.
 * Idempotent, and a no-op if Supertest is not installed or its shape changed.
 */
export function dialBoundAddressFamily(): void {
  let proto: SupertestTestProto
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    proto = (require('supertest/lib/test') as { prototype: SupertestTestProto }).prototype
  } catch {
    return // Supertest absent (jsdom-only workers) — nothing to correct.
  }
  if (!proto || typeof proto.serverAddress !== 'function' || proto[PATCHED]) return
  proto[PATCHED] = true

  const original = proto.serverAddress

  proto.serverAddress = function patchedServerAddress(app, path) {
    const url = original.call(this, app, path)
    try {
      const addr = app.address()
      // Only rewrite the host when the server bound an IPv6 wildcard/loopback
      // while Supertest hard-coded the IPv4 literal. Everything else is left
      // exactly as Supertest computed it.
      if (addr && typeof addr === 'object' && addr.family === 'IPv6') {
        return url.replace('://127.0.0.1:', '://[::1]:')
      }
    } catch {
      /* fall through to Supertest's own URL */
    }
    return url
  }
}
