import type { Idea } from '@/db/repositories/ideas'

// Very common words carry no meaning for similarity (Turkish + English).
const STOPWORDS = new Set(
  ('ve ile için bir bu şu o da de mi mu ne gibi daha çok en ama veya ya olan olarak kadar her tüm ' +
    'istiyorum yapmak geliştirmek uygulama sistem the a an and or for to of in on with app system')
    .split(' '),
)

export function keywords(text: string): Set<string> {
  return new Set(
    text
      .toLocaleLowerCase('tr')
      .normalize('NFKC')
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
      // Crude stemming so "restoranların" matches "restoran": compare 6-letter prefixes.
      .map((w) => w.slice(0, 6)),
  )
}

/**
 * Previously recorded ideas that look like the new text (keyword overlap).
 * Good enough for "you evaluated this before"; embeddings can replace it later.
 */
export function findSimilarIdeas(text: string, ideas: Idea[], excludeId?: string, threshold = 0.25): { idea: Idea; score: number }[] {
  const a = keywords(text)
  if (a.size < 2) return []
  return ideas
    .filter((i) => i.id !== excludeId)
    .map((idea) => {
      const b = keywords(`${idea.title} ${idea.body}`)
      const shared = [...a].filter((w) => b.has(w)).length
      // Overlap relative to the smaller set, so a short title can match a long description.
      return { idea, score: shared / Math.max(1, Math.min(a.size, b.size)) }
    })
    .filter((m) => m.score >= threshold && m.idea.title)
    .sort((x, y) => y.score - x.score)
    .slice(0, 3)
}
