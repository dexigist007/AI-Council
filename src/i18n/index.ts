import { ref } from 'vue'
import { messages, type Messages } from './locales'

/**
 * Small typed i18n layer. vue-i18n compiles messages at runtime with `new Function`, which the
 * app's CSP forbids; plain lookups are enough here and every key is checked by the compiler.
 */
export const LOCALES = [
  { id: 'tr', label: 'Türkçe', modelLanguage: 'Turkish' },
  { id: 'en', label: 'English', modelLanguage: 'English' },
] as const
export type Locale = (typeof LOCALES)[number]['id']

export const LOCALE_KEY = 'locale'

/** Starts as Turkish so tests and code running before `initLocale` are deterministic. */
export const locale = ref<Locale>('tr')

type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>
}[keyof T & string]
export type MessageKey = Leaves<Messages>

function lookup(tree: unknown, key: string): string | undefined {
  let node = tree
  for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part]
  return typeof node === 'string' ? node : undefined
}

/** Translates `key`, filling `{name}` placeholders. Falls back to Turkish, then to the key. */
export function t(key: MessageKey, params: Record<string, string | number> = {}): string {
  const text = lookup(messages[locale.value], key) ?? lookup(messages.tr, key) ?? key
  return text.replace(/\{(\w+)\}/g, (m: string, name: string) => (name in params ? String(params[name]) : m))
}

/** Language the models write their prose in; follows the UI language. */
export const modelLanguage = (): string => LOCALES.find((l) => l.id === locale.value)!.modelLanguage

export const isLocale = (v: unknown): v is Locale => LOCALES.some((l) => l.id === v)

/** Saved choice, else the system language, else English (wider audience than Turkish). */
export function detectLocale(saved: unknown, systemLanguages: readonly string[]): Locale {
  if (isLocale(saved)) return saved
  for (const lang of systemLanguages) {
    const base = lang.toLowerCase().split('-')[0]
    if (isLocale(base)) return base
  }
  return 'en'
}

/** Number/date formatting that follows the UI language. */
export const fmtDate = (iso: string | number | Date) => new Date(iso).toLocaleString(locale.value)
export const fmtDay = (iso: string | number | Date) => new Date(iso).toLocaleDateString(locale.value)
export const fmtNum = (n: number) => n.toLocaleString(locale.value)
