/**
 * Tests: modules/eventBus
 * Coverage: publish, subscribe, unsubscribe, getLog, clear,
 *           wildcard routing, error isolation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { jip, tt, JIP_CHANNELS, JIP_ACTIONS } from '../../modules/eventBus'

beforeEach(() => {
  jip.clear()
})

describe('jip.publish', () => {
  it('returns a message envelope with correct shape', () => {
    const msg = jip.publish('auth', 'login', { userId: '123' })
    expect(msg.jip).toBe('1.0')
    expect(msg.channel).toBe('auth')
    expect(msg.action).toBe('login')
    expect(msg.payload).toEqual({ userId: '123' })
    expect(msg.ts).toBeTypeOf('number')
    expect(msg.id).toMatch(/^jip-\d+$/)
  })

  it('assigns incrementing IDs', () => {
    const m1 = jip.publish('a', 'b')
    const m2 = jip.publish('a', 'b')
    const id1 = parseInt(m1.id.replace('jip-', ''))
    const id2 = parseInt(m2.id.replace('jip-', ''))
    expect(id2).toBe(id1 + 1)
  })

  it('uses "shell" as default source', () => {
    const msg = jip.publish('data', 'write')
    expect(msg.source).toBe('shell')
  })

  it('accepts custom source', () => {
    const msg = jip.publish('data', 'write', {}, 'persistence-module')
    expect(msg.source).toBe('persistence-module')
  })

  it('defaults payload to empty object when not provided', () => {
    const msg = jip.publish('test', 'event')
    expect(msg.payload).toEqual({})
  })
})

describe('jip.subscribe — exact match', () => {
  it('calls handler when matching channel:action published', () => {
    const handler = vi.fn()
    jip.subscribe('auth', 'login', handler)
    jip.publish('auth', 'login', { ok: true })
    expect(handler).toHaveBeenCalledOnce()
    expect(handler.mock.calls[0][0].payload).toEqual({ ok: true })
  })

  it('does not call handler for different action', () => {
    const handler = vi.fn()
    jip.subscribe('auth', 'login', handler)
    jip.publish('auth', 'logout')
    expect(handler).not.toHaveBeenCalled()
  })

  it('does not call handler for different channel', () => {
    const handler = vi.fn()
    jip.subscribe('auth', 'login', handler)
    jip.publish('data', 'login')
    expect(handler).not.toHaveBeenCalled()
  })

  it('calls multiple handlers subscribed to the same key', () => {
    const h1 = vi.fn()
    const h2 = vi.fn()
    jip.subscribe('auth', 'login', h1)
    jip.subscribe('auth', 'login', h2)
    jip.publish('auth', 'login')
    expect(h1).toHaveBeenCalledOnce()
    expect(h2).toHaveBeenCalledOnce()
  })
})

describe('jip.subscribe — unsubscribe', () => {
  it('returns an unsubscribe function', () => {
    const unsub = jip.subscribe('auth', 'login', vi.fn())
    expect(unsub).toBeTypeOf('function')
  })

  it('stops calling handler after unsubscribe', () => {
    const handler = vi.fn()
    const unsub = jip.subscribe('auth', 'login', handler)
    jip.publish('auth', 'login')
    unsub()
    jip.publish('auth', 'login')
    expect(handler).toHaveBeenCalledOnce()
  })

  it('other handlers not affected by unsubscribe', () => {
    const h1 = vi.fn()
    const h2 = vi.fn()
    jip.subscribe('auth', 'login', h1)
    const unsub = jip.subscribe('auth', 'login', h2)
    unsub()
    jip.publish('auth', 'login')
    expect(h1).toHaveBeenCalledOnce()
    expect(h2).not.toHaveBeenCalled()
  })
})

describe('jip.subscribe — wildcards', () => {
  it('channel wildcard (channel:*) receives all actions on that channel', () => {
    const handler = vi.fn()
    jip.subscribe('auth', '*', handler)
    jip.publish('auth', 'login')
    jip.publish('auth', 'logout')
    jip.publish('auth', 'refresh')
    expect(handler).toHaveBeenCalledTimes(3)
  })

  it('channel wildcard does not receive events from other channels', () => {
    const handler = vi.fn()
    jip.subscribe('auth', '*', handler)
    jip.publish('data', 'write')
    expect(handler).not.toHaveBeenCalled()
  })

  it('global wildcard (*:*) receives all events', () => {
    const handler = vi.fn()
    jip.subscribe('*', '*', handler)
    jip.publish('auth', 'login')
    jip.publish('data', 'write')
    jip.publish('mcp', 'connect')
    expect(handler).toHaveBeenCalledTimes(3)
  })
})

describe('jip.getLog', () => {
  it('returns empty array initially', () => {
    expect(jip.getLog()).toEqual([])
  })

  it('captures published messages', () => {
    jip.publish('auth', 'login')
    jip.publish('data', 'write')
    expect(jip.getLog()).toHaveLength(2)
  })

  it('returns a copy — mutations do not affect internal log', () => {
    jip.publish('test', 'event')
    const log = jip.getLog()
    log.push({ jip: '1.0', id: 'injected', source: 'test', channel: 'x', action: 'y', payload: {}, ts: 0 })
    expect(jip.getLog()).toHaveLength(1)
  })

  it('caps log at 200 entries', () => {
    for (let i = 0; i < 250; i++) jip.publish('test', 'flood')
    expect(jip.getLog().length).toBeLessThanOrEqual(200)
  })
})

describe('jip.clear', () => {
  it('clears all subscribers', () => {
    const handler = vi.fn()
    jip.subscribe('auth', 'login', handler)
    jip.clear()
    jip.publish('auth', 'login')
    expect(handler).not.toHaveBeenCalled()
  })

  it('clears the message log', () => {
    jip.publish('test', 'event')
    jip.clear()
    expect(jip.getLog()).toEqual([])
  })

  it('resets the sequence counter', () => {
    jip.publish('a', 'b')
    jip.clear()
    const msg = jip.publish('a', 'b')
    expect(msg.id).toBe('jip-1')
  })
})

describe('Error isolation', () => {
  it('does not throw if a subscriber throws', () => {
    jip.subscribe('test', 'error', () => { throw new Error('Handler blew up') })
    expect(() => jip.publish('test', 'error')).not.toThrow()
  })

  it('still calls other subscribers even if one throws', () => {
    const good = vi.fn()
    jip.subscribe('test', 'error', () => { throw new Error('boom') })
    jip.subscribe('test', 'error', good)
    jip.publish('test', 'error')
    expect(good).toHaveBeenCalledOnce()
  })
})

describe('JIP_CHANNELS and JIP_ACTIONS constants', () => {
  it('exports well-known channel names', () => {
    expect(JIP_CHANNELS.AUTH).toBe('auth')
    expect(JIP_CHANNELS.DATA).toBe('data')
    expect(JIP_CHANNELS.JARVIS).toBe('jarvis')
  })

  it('exports well-known action names', () => {
    expect(JIP_ACTIONS.TOKEN_EXPIRED).toBe('token_expired')
    expect(JIP_ACTIONS.SESSION_TIMEOUT).toBe('session_timeout')
  })
})

describe('Legacy alias', () => {
  it('tt is the same object as jip', () => {
    expect(tt).toBe(jip)
  })
})

// ─── Track E: eventBus subscribe unsubscribe edge cases (lines 102/106) ────────
describe('jip.subscribe — unsubscribe edge cases', () => {
  beforeEach(() => { jip.clear() })

  it('unsubscribe returned function removes handler cleanly', () => {
    const handler = vi.fn()
    const unsub = jip.subscribe('test', 'ping', handler)
    unsub()
    jip.publish('test', 'ping', {})
    expect(handler).not.toHaveBeenCalled()
  })

  it('unsubscribe is safe to call when _subscribers[key] was cleared', () => {
    const handler = vi.fn()
    const unsub = jip.subscribe('cleared', 'action', handler)
    // Clear all subscribers (simulates clear() call)
    jip.clear()
    // Calling unsub after clear should not throw
    expect(() => unsub()).not.toThrow()
  })

  it('unsubscribe after second subscribe to same key still works', () => {
    const h1 = vi.fn()
    const h2 = vi.fn()
    const unsub1 = jip.subscribe('multi', 'event', h1)
    jip.subscribe('multi', 'event', h2)
    unsub1()
    jip.publish('multi', 'event', { value: 1 })
    expect(h1).not.toHaveBeenCalled()
    expect(h2).toHaveBeenCalledOnce()
  })

  it('subscribe with action=undefined falls through to wildcard key', () => {
    const handler = vi.fn()
    // action ?? '*' branch — passing undefined triggers the ?? fallback
    jip.subscribe('testchan', undefined as unknown as string, handler)
    jip.publish('testchan', 'anything', { x: 1 })
    // The channel wildcard subscriber should fire
    expect(handler).toHaveBeenCalled()
  })

  it('unsubscribe called twice does not throw', () => {
    const handler = vi.fn()
    const unsub = jip.subscribe('double', 'unsub', handler)
    unsub()
    expect(() => unsub()).not.toThrow()
  })
})

