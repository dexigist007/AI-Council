import { describe, expect, it } from 'vitest'
import { parseDiff, parseLog, parseStatus } from './parse'
import { buildReviewContext } from './review'
import { verifyCitations } from '@/domain/context/evidence'

describe('git parsing', () => {
  it('parses porcelain status with branch tracking and renames', () => {
    const raw = '## main...origin/main [ahead 2, behind 1]\0 M src/a.ts\0R  new.ts\0old.ts\0?? notes.md\0'
    expect(parseStatus(raw)).toEqual({
      branch: 'main', upstream: 'origin/main', ahead: 2, behind: 1,
      files: [{ path: 'src/a.ts', index: ' ', worktree: 'M' }, { path: 'new.ts', index: 'R', worktree: ' ' }, { path: 'notes.md', index: '?', worktree: '?' }],
    })
    expect(parseStatus('## No commits yet on main\0').branch).toBe('main')
    expect(parseStatus('## HEAD (no branch)\0').branch).toBeNull()
  })

  it('parses log records', () => {
    expect(parseLog('abc\x1fAda\x1f2026-10-01T10:00:00+03:00\x1fFix: x\x1e\ndef\x1fBob\x1f2026-09-30\x1fInit\x1e\n')).toEqual([
      { hash: 'abc', author: 'Ada', date: '2026-10-01T10:00:00+03:00', subject: 'Fix: x' },
      { hash: 'def', author: 'Bob', date: '2026-09-30', subject: 'Init' },
    ])
  })

  const diff = [
    'diff --git a/src/player.ts b/src/player.ts',
    'index 1..2 100644',
    '--- a/src/player.ts',
    '+++ b/src/player.ts',
    '@@ -10,4 +10,5 @@ export class Player {',
    '   load(url: string) {',
    '-    return fetch(url)',
    '+    const res = await fetch(url)',
    '+    this.cache.push(res)',
    '   }',
    'diff --git a/package-lock.json b/package-lock.json',
    '@@ -1 +1 @@',
    '-a',
    '+b',
    'diff --git a/logo.png b/logo.png',
    'Binary files a/logo.png and b/logo.png differ',
    'diff --git a/src/old.ts b/src/new.ts',
    'similarity index 90%',
    'rename from src/old.ts',
    'rename to src/new.ts',
  ].join('\n')

  it('parses files, hunks and new-file line numbers', () => {
    const { files, truncated } = parseDiff(diff)
    expect(truncated).toBe(false)
    expect(files.map((f) => `${f.path}:${f.status}:${f.binary}:+${f.additions}-${f.deletions}`)).toEqual([
      'src/player.ts:modified:false:+2-1', 'package-lock.json:modified:false:+1-1', 'logo.png:modified:true:+0-0', 'src/new.ts:renamed:false:+0-0',
    ])
    expect(files[0]!.hunks[0]!.lines.map((l) => [l.type, l.newLine])).toEqual([[' ', 10], ['-', null], ['+', 11], ['+', 12], [' ', 13]])
    expect(files[3]!.oldPath).toBe('src/old.ts')
  })

  it('builds review context and verifies citations against new-side lines', () => {
    const ctx = buildReviewContext(parseDiff(diff).files, [])
    expect(ctx.files).toEqual(['src/player.ts', 'src/new.ts'])
    expect(ctx.skipped.map((s) => s.path)).toEqual(['package-lock.json', 'logo.png'])
    expect(ctx.diff).toContain('+   12|     this.cache.push(res)')
    expect(ctx.diff).toContain('-     |     return fetch(url)')
    const [ok, removed] = verifyCitations([
      { file: 'src/player.ts', start_line: 1, end_line: 1, quote: 'this.cache.push(res)' },
      { file: 'src/player.ts', start_line: 11, end_line: 11, quote: 'return fetch(url)' }, // removed line: not citable
    ], ctx.sources)
    expect(ok).toMatchObject({ verified: true, start_line: 12 })
    expect(removed!.verified).toBe(false)
  })
})
