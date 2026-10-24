import { afterEach, describe, expect, it } from 'vitest'
import { createTestDb } from '@/db/testing'
import { findingsRepo } from '@/db/repositories/findings'
import { projectsRepo } from '@/db/repositories/projects'
import { locale } from '@/i18n'
import { localFindings } from './local'

describe('local scan across languages', () => {
  afterEach(() => (locale.value = 'tr'))

  it('keeps one finding per problem when the UI language changes', async () => {
    const db = createTestDb()
    const project = await projectsRepo(db).create({ name: 'p', rootPath: '/tmp/p' })
    const findings = findingsRepo(db)
    const files = [{ path: 'src/a.ts', size: 10, mtimeMs: 0, hash: 'h', lang: 'ts', skipReason: null }]
    const chunks = [{ path: 'src/a.ts', startLine: 1, endLine: 2, content: '// TODO: fix\nconst a = 1' }]
    const scan = () => localFindings(files as never, chunks as never)

    const tr = scan()
    locale.value = 'en'
    const en = scan()
    expect(en.map((f) => f.title)).not.toEqual(tr.map((f) => f.title))

    await findings.upsertMany(project.id, null, tr)
    await findings.upsertMany(project.id, null, en)
    expect((await findings.list({ projectId: project.id })).length).toBe(tr.length)
  })
})
