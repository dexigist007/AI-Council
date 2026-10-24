import { Quasar } from 'quasar'
import quasarEn from 'quasar/lang/en-US'
import quasarTr from 'quasar/lang/tr'
import { watch } from 'vue'
import { repos } from '@/db'
import { detectLocale, locale, LOCALE_KEY, type Locale } from '.'

const QUASAR_LANG = { tr: quasarTr, en: quasarEn }

/** Picks the saved or system language before the first render, and keeps Quasar and <html lang> in step. */
export async function initLocale(): Promise<void> {
  let saved: unknown = null
  try {
    saved = await (await repos()).settings.get(LOCALE_KEY)
  } catch {
    // No database (e.g. a plain browser preview): fall back to the system language.
  }
  watch(locale, (l) => {
    Quasar.lang.set(QUASAR_LANG[l])
    document.documentElement.lang = l
  }, { immediate: true })
  locale.value = detectLocale(saved, navigator.languages ?? [navigator.language])
}

export async function setLocale(l: Locale): Promise<void> {
  locale.value = l
  await (await repos()).settings.set(LOCALE_KEY, l)
}
