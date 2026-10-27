<template>
  <q-page>
    <article class="policy">
      <h1 class="text-h5">{{ t('shell.privacyPage.title') }}</h1>
      <p class="text-caption text-soft">{{ t('shell.privacyPage.updated') }}</p>
      <section v-for="n in 7" :key="n">
        <h2 class="text-subtitle1">{{ t(`shell.privacyPage.s${n}h` as MessageKey) }}</h2>
        <p>{{ n === 7 ? t('shell.privacyPage.s7', { email: SUPPORT_EMAIL || '—' }) : t(`shell.privacyPage.s${n}` as MessageKey) }}</p>
      </section>
    </article>
  </q-page>
</template>

<script setup lang="ts">
import { SUPPORT_EMAIL } from '@/config/app'
import { t, type MessageKey } from '@/i18n'
</script>

<style scoped>
.policy { max-width: 68ch; }
.policy h1 { margin: 0 0 4px; }
.policy h2 { margin: 26px 0 6px; }
.policy p { margin: 0; line-height: 1.6; }
</style>
