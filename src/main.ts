import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { Quasar, Dark } from 'quasar'
import '@quasar/extras/material-icons/material-icons.css'
import 'quasar/src/css/index.sass'
import App from './App.vue'
import { router } from './router'
import { initLocale } from './i18n/setup'

const app = createApp(App)
  .use(createPinia())
  .use(router)
  .use(Quasar, { plugins: { Dark }, config: { dark: 'auto' } })

void initLocale().finally(() => app.mount('#app'))
