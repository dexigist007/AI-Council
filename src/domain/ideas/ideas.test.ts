import { describe, expect, it } from 'vitest'
import type { Idea } from '@/db/repositories/ideas'
import { toJsonSchema } from '@/domain/council/schemas'
import { findSimilarIdeas } from './similar'
import { IdeaReport } from './report'
import { buildIdeaTask } from './task'

const idea = (id: string, title: string, body = ''): Idea => ({
  id, title, body, status: 'rejected', rejectReason: null, revisitCondition: null, decidedSessionId: null, createdAt: '', updatedAt: '',
})

describe('findSimilarIdeas', () => {
  const ideas = [
    idea('1', 'Restoran dijital TV menü yönetimi', 'Restoranların TV menülerini merkezi yönetmek'),
    idea('2', 'IPTV player for Smart TVs'),
  ]

  it('matches reworded ideas across inflections', () => {
    const hits = findSimilarIdeas('Restoranlar için dijital menü ekranlarını yöneten sistem', ideas)
    expect(hits.map((h) => h.idea.id)).toEqual(['1'])
  })

  it('ignores unrelated ideas, the idea itself and too-short text', () => {
    expect(findSimilarIdeas('Muhasebe için fatura otomasyonu', ideas)).toEqual([])
    expect(findSimilarIdeas('Restoran dijital TV menü yönetimi', ideas, '1')).toEqual([])
    expect(findSimilarIdeas('menü', ideas)).toEqual([])
  })
})

describe('idea task', () => {
  it('builds evaluate and kill tasks from versioned prompts', () => {
    const t = buildIdeaTask(idea('x', 'TV menus', 'for restaurants'), 'evaluate')
    expect(t).toMatchObject({ type: 'new_idea', ideaId: 'x', promptVersions: { 'idea-brief': 1, 'idea-judge': 2 } })
    expect(t.taskBrief).toContain('TV menus')
    const k = buildIdeaTask(idea('x', 'TV menus'), 'kill')
    expect(k.type).toBe('kill_idea')
    expect(k.taskBrief).toContain('KILL THIS IDEA')
    expect(k.judgeInstructions).toContain('survives_kill_test')
  })

  it('has a report schema that converts to JSON Schema for providers', () => {
    const schema = toJsonSchema(IdeaReport) as { required: string[] }
    expect(schema.required).toContain('decision')
    expect(schema.required).toContain('survives_kill_test')
  })
})
