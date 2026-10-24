import { afterEach, describe, expect, it } from 'vitest'
import { detectLocale, locale, modelLanguage, t } from '.'
import { messages } from './locales'

/** Every leaf key of a message tree, as dotted paths. */
function keys(tree: object, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : keys(v as object, `${prefix}${k}.`)))
}

describe('i18n', () => {
  afterEach(() => (locale.value = 'tr'))

  it('translates, fills placeholders and follows the locale', () => {
    expect(t('shell.dashboard.uncommitted', { n: 3 })).toBe('3 commit edilmemiş dosya')
    locale.value = 'en'
    expect(t('shell.dashboard.uncommitted', { n: 3 })).toBe('3 uncommitted files')
    expect(modelLanguage()).toBe('English')
  })

  it('picks the saved language, then the system language, then English', () => {
    expect(detectLocale('tr', ['en-US'])).toBe('tr')
    expect(detectLocale(null, ['de-DE', 'tr-TR'])).toBe('tr')
    expect(detectLocale('xx', ['de-DE'])).toBe('en')
  })

  it('has the same keys and placeholders in every language, and no empty text', () => {
    const tr = keys(messages.tr).sort()
    expect(keys(messages.en).sort()).toEqual(tr)
    const get = (tree: object, k: string) => k.split('.').reduce<unknown>((n, p) => (n as Record<string, unknown>)[p], tree) as string
    for (const k of tr) {
      const a = get(messages.tr, k)
      const b = get(messages.en, k)
      expect(a.trim(), k).not.toBe('')
      expect(b.trim(), k).not.toBe('')
      expect((b.match(/\{\w+\}/g) ?? []).sort(), k).toEqual((a.match(/\{\w+\}/g) ?? []).sort())
    }
  })
})
