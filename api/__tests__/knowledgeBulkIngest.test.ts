/**
 * Tests: api/services/knowledgeBulkIngest.ts
 * Focus: path-allowlist guard + walker filter behavior.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { isPathAllowed, enumerateCandidates, __testHooks } from '../services/knowledgeBulkIngest'

// ─── Path allowlist ───────────────────────────────────────────────────────────

describe('isPathAllowed', () => {
  const PREV = process.env['KNOWLEDGE_INGEST_ROOTS']
  afterEach(() => {
    if (PREV === undefined) delete process.env['KNOWLEDGE_INGEST_ROOTS']
    else process.env['KNOWLEDGE_INGEST_ROOTS'] = PREV
  })

  it('allows any path when env var is unset (dev default)', () => {
    delete process.env['KNOWLEDGE_INGEST_ROOTS']
    expect(isPathAllowed('/Volumes/A/anything').ok).toBe(true)
    expect(isPathAllowed('/etc').ok).toBe(true)
  })

  it('allows paths under an allowlisted prefix', () => {
    process.env['KNOWLEDGE_INGEST_ROOTS'] = '/mnt/knowledge,/srv/uploads'
    expect(isPathAllowed('/mnt/knowledge').ok).toBe(true)
    expect(isPathAllowed('/mnt/knowledge/sub/file').ok).toBe(true)
    expect(isPathAllowed('/srv/uploads/x').ok).toBe(true)
  })

  it('rejects paths outside the allowlist', () => {
    process.env['KNOWLEDGE_INGEST_ROOTS'] = '/mnt/knowledge'
    const r = isPathAllowed('/etc/passwd')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/not under/)
  })

  it('is not fooled by string-prefix attacks', () => {
    // '/mnt/knowledge-bad' must NOT match the '/mnt/knowledge' prefix.
    process.env['KNOWLEDGE_INGEST_ROOTS'] = '/mnt/knowledge'
    expect(isPathAllowed('/mnt/knowledge-bad/x').ok).toBe(false)
  })
})

// ─── Walker + enumerate ──────────────────────────────────────────────────────

describe('enumerateCandidates — filesystem walk', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-walk-'))
    // Build: tmp/a.pdf, tmp/b.docx, tmp/node_modules/c.pdf (skipped),
    //        tmp/Mine/d.pdf (skipped), tmp/sub/e.pdf
    await fs.writeFile(path.join(tmp, 'a.pdf'), 'PDF A')
    await fs.writeFile(path.join(tmp, 'b.docx'), 'DOCX B')
    await fs.mkdir(path.join(tmp, 'node_modules'), { recursive: true })
    await fs.writeFile(path.join(tmp, 'node_modules', 'c.pdf'), 'PDF C')
    await fs.mkdir(path.join(tmp, 'Mine'), { recursive: true })
    await fs.writeFile(path.join(tmp, 'Mine', 'd.pdf'), 'PDF D')
    await fs.mkdir(path.join(tmp, 'sub'), { recursive: true })
    await fs.writeFile(path.join(tmp, 'sub', 'e.pdf'), 'PDF E')
  })

  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }) })

  it('returns only files matching extension filter', async () => {
    const { candidates } = await enumerateCandidates({
      rootPath: tmp, extensions: ['pdf'],
    })
    const names = candidates.map(c => c.name).sort()
    expect(names).toContain('a.pdf')
    expect(names).toContain('e.pdf')
    expect(names).not.toContain('b.docx')
  })

  it('skips default skip-dirs (node_modules, Mine)', async () => {
    const { candidates } = await enumerateCandidates({
      rootPath: tmp, extensions: ['pdf'],
    })
    const paths = candidates.map(c => c.path)
    expect(paths.some(p => p.includes('node_modules'))).toBe(false)
    expect(paths.some(p => p.includes('/Mine/'))).toBe(false)
  })

  it('respects custom skipDirs override', async () => {
    const { candidates } = await enumerateCandidates({
      rootPath: tmp, extensions: ['pdf'], skipDirs: ['sub'],
    })
    expect(candidates.some(c => c.path.includes('/sub/'))).toBe(false)
  })

  it('marks truncated=true when limit hits', async () => {
    const { candidates, truncated } = await enumerateCandidates({
      rootPath: tmp, extensions: ['pdf'], limit: 1,
    })
    expect(candidates).toHaveLength(1)
    expect(truncated).toBe(true)
  })

  it('handles unreadable directories gracefully (no throw)', async () => {
    // Walk a path that doesn't exist — should resolve empty.
    const { candidates } = await enumerateCandidates({
      rootPath: path.join(tmp, 'does-not-exist'),
      extensions: ['pdf'],
    })
    expect(candidates).toEqual([])
  })
})

describe('DEFAULT_SKIP list', () => {
  it('covers the user-requested personal / dev / installer dirs', () => {
    const { DEFAULT_SKIP } = __testHooks
    expect(DEFAULT_SKIP).toContain('node_modules')
    expect(DEFAULT_SKIP).toContain('.git')
    expect(DEFAULT_SKIP).toContain('Mine')
    expect(DEFAULT_SKIP).toContain('AI Projects')
    expect(DEFAULT_SKIP).toContain('ChatGPT')
  })
})
