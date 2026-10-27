import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { Quasar, Dark, Dialog, type GlobalQuasarIconMapFn } from 'quasar'
import '@quasar/extras/material-symbols-rounded/material-symbols-rounded.css'
import iconSet from 'quasar/icon-set/material-symbols-rounded'
import 'quasar/src/css/index.sass'
import '@fontsource-variable/instrument-sans'
import './css/theme.css'
import App from './App.vue'
import { router } from './router'
import { initLocale } from './i18n/setup'

// Icons are written by their plain names (e.g. "gavel"); render them all as rounded symbols.
const iconMapFn: GlobalQuasarIconMapFn = (name) =>
  /^[a-z0-9_]+$/.test(name) && !name.startsWith('sym_') ? { cls: 'material-symbols-rounded', content: name } : undefined

const app = createApp(App)
  .use(createPinia())
  .use(router)
  .use(Quasar, {
    plugins: { Dark, Dialog },
    iconSet,
    // Quasar reads iconMapFn from config at install time, but its config type does not declare it.
    config: { dark: 'auto', iconMapFn } as Record<string, unknown>,
  })

void initLocale().finally(() => app.mount('#app'))
