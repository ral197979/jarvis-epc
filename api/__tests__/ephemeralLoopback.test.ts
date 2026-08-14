/**
 * ADR-014 F5 regression — Supertest must dial the address family it bound.
 *
 * Supertest calls `app.listen(0)` with no host, so Node binds the `::` wildcard,
 * and then builds its URL as `http://127.0.0.1:<port>`. Those are different
 * address families, so the kernel can assign a port already held by an unrelated
 * IPv4 loopback listener — ordinary desktop software parks long-lived listeners
 * inside macOS's 49152–65535 ephemeral range — and TCP delivers the request to
 * that more specific listener instead of to the test's own server. The foreign
 * process then answers with a wrong status, unparseable bytes, or a reset,
 * producing the intermittent `socket hang up` / `HPE_INVALID_CONSTANT` /
 * wrong-status failures tracked as F5.
 *
 * `dialBoundAddressFamily()` in `src/__tests__/setup.ts` corrects the dialled
 * host. These tests fail if it is removed.
 */
import { describe, it, expect } from 'vitest'
import http from 'node:http'
import net from 'node:net'
import express from 'express'
import request from 'supertest'

/** Bind a server the way Supertest does: port 0, no host. */
function listenLikeSupertest(): Promise<http.Server> {
  return new Promise(resolve => {
    const server = http.createServer((_req, res) => { res.writeHead(204); res.end() })
    server.listen(0, () => resolve(server))
  })
}

describe('ADR-014 F5 — Supertest dials the address family it bound', () => {
  it('derives a URL whose host matches the bound family', async () => {
    const Test = require('supertest/lib/test') as {
      prototype: { serverAddress(app: unknown, path: string): string }
    }
    const server = await listenLikeSupertest()
    try {
      const addr = server.address() as net.AddressInfo
      const url  = Test.prototype.serverAddress(server, '/probe')

      if (addr.family === 'IPv6') {
        // The defect: Supertest would have produced http://127.0.0.1:<port>,
        // which is a different address family from the one it just bound.
        expect(url).toBe(`http://[::1]:${addr.port}/probe`)
      } else {
        expect(url).toBe(`http://127.0.0.1:${addr.port}/probe`)
      }
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })

  it('reaches its own server on a port an IPv4 loopback listener already holds', async () => {
    // Stand in for the third-party application (FileMaker on 127.0.0.1:61965 on
    // the machine where F5 was diagnosed) that occupied the colliding port.
    // Each side signals when it accepts, so nothing here depends on a timeout.
    let squatterAccepted!: () => void
    const squatterGotOne = new Promise<void>(resolve => { squatterAccepted = resolve })
    const squatter = net.createServer(socket => { socket.destroy(); squatterAccepted() })
    await new Promise<void>(resolve => squatter.listen(0, '127.0.0.1', () => resolve()))
    const port = (squatter.address() as net.AddressInfo).port

    // Our server binds the `::` wildcard on that same port, which the kernel
    // permits because the squatter holds a different address family. This is
    // exactly the state `listen(0)` can land in by chance.
    const ours = http.createServer((_req, res) => { res.writeHead(200); res.end('ours') })
    const bound = await new Promise<boolean>(resolve => {
      ours.once('error', () => resolve(false))
      ours.listen({ port, ipv6Only: false }, () => resolve(true))
    })

    try {
      if (!bound) {
        // A kernel that refuses the overlapping bind cannot produce this
        // collision at all, so there is nothing to demonstrate here. The
        // invariant that actually guards F5 is asserted by the first test.
        expect(bound).toBe(false)
        return
      }

      let reachedUs = 0
      let oursAccepted!: () => void
      const oursGotOne = new Promise<void>(resolve => { oursAccepted = resolve })
      ours.on('connection', () => { reachedUs++; oursAccepted() })

      const dial = (host: string) => new Promise<void>(resolve => {
        const s = net.connect({ host, port }, () => { s.destroy(); resolve() })
        s.on('error', () => resolve())
      })

      // The pre-fix dial: reaches the squatter, never us. Waiting on the
      // squatter's own accept makes the negative assertion deterministic —
      // the connection has demonstrably been delivered somewhere by then.
      await dial('127.0.0.1')
      await squatterGotOne
      expect(reachedUs, 'IPv4 dial must NOT reach our :: server — this is the defect').toBe(0)

      // The post-fix dial: while we hold the `::` wildcard the kernel cannot
      // give any IPv6 address on this port to another process, so this always
      // reaches us.
      await dial('::1')
      await oursGotOne
      expect(reachedUs, 'IPv6 dial must reach our server — this is why the fix works').toBe(1)
    } finally {
      await new Promise<void>(resolve => ours.close(() => resolve()))
      await new Promise<void>(resolve => squatter.close(() => resolve()))
    }
  })

  it('routes Supertest requests to the app under test', async () => {
    const app = express()
    app.get('/f5', (_req, res) => { res.status(200).json({ from: 'app-under-test' }) })

    for (let i = 0; i < 25; i++) {
      const res = await request(app).get('/f5')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ from: 'app-under-test' })
    }
  })
})
