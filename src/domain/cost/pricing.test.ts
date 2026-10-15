import { describe, expect, it } from 'vitest'
import { costOf, priceLookup } from './pricing'

describe('pricing', () => {
  const lookup = priceLookup([{ provider: 'anthropic', model: 'a', inPerMtok: 4, outPerMtok: 20, cachedPerMtok: 0.2 }])

  it('charges cached input at the cache rate', () => {
    // 600k fresh × $4 + 400k cached × $0.2 + 100k out × $20 = 2.4 + 0.08 + 2.0
    expect(costOf(lookup('anthropic', 'a'), { input: 1_000_000, cached: 400_000, output: 100_000 })).toBeCloseTo(4.48)
  })

  it('returns null for unpriced models instead of pretending they are free', () => {
    expect(costOf(lookup('anthropic', 'b'), { input: 10, cached: 0, output: 10 })).toBeNull()
  })
})
