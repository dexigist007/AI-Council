import { describe, expect, it } from 'vitest'
import { latestVersion, render, roleBrief, roleIds } from './registry'

describe('prompt registry', () => {
  it('loads versioned prompts and roles from /prompts', () => {
    expect(latestVersion('council-judge')).toBeGreaterThanOrEqual(1)
    expect(roleIds()).toContain('devils-advocate')
    expect(roleBrief('critical-analyst').label).toBe('Critical Analyst')
  })

  it('renders variables and rejects missing or unused ones', () => {
    const p = render('json-repair', { errors: '- bad' })
    expect(p).toMatchObject({ id: 'json-repair', version: 1 })
    expect(p.text).toContain('- bad')
    expect(() => render('json-repair', {})).toThrow(/missing variable "errors"/)
    expect(() => render('json-repair', { errors: 'x', extra: 'y' })).toThrow(/unused variables extra/)
    expect(() => render('nope', {})).toThrow(/unknown prompt/)
  })
})
