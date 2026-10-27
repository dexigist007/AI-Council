<template>
  <q-card flat bordered>
    <q-card-section>
      <div class="text-subtitle1">{{ t('shell.privacy.title') }}</div>
      <div class="text-caption text-soft q-mt-xs">{{ t('shell.privacy.hint') }}</div>
    </q-card-section>
    <q-card-section class="q-pt-none">
      <div class="text-subtitle2 q-mb-xs">{{ t('shell.privacy.consents') }}</div>
      <div v-if="!rows.length" class="text-caption text-soft">{{ t('shell.privacy.noConsents') }}</div>
      <div v-for="r in rows" :key="r.id" class="row items-center consent-row">
        <div class="col">
          <div>{{ r.label }}</div>
          <div class="text-caption text-soft">{{ t('shell.privacy.grantedAt', { date: fmtDate(r.at) }) }}</div>
        </div>
        <q-btn flat dense no-caps color="negative" :label="t('shell.privacy.revoke')" @click="revoke(r.id)" />
      </div>
    </q-card-section>
    <q-card-actions class="q-px-md q-pb-md">
      <q-btn outline no-caps icon="policy" :label="t('shell.privacy.policy')" to="/privacy" />
      <q-space />
      <q-btn flat no-caps color="negative" icon="delete_forever" :label="t('shell.privacy.deleteAll')" @click="confirmDelete" />
    </q-card-actions>
  </q-card>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useQuasar } from 'quasar'
import { consents, revokeConsent } from '@/domain/consent'
import { PROVIDERS } from '@/domain/providers/registry'
import type { ProviderId } from '@/domain/providers/types'
import { deleteAllData } from '@/domain/wipe'
import { fmtDate, t } from '@/i18n'

const $q = useQuasar()
const rows = ref<{ id: ProviderId; label: string; at: string }[]>([])

async function load() {
  const granted = await consents()
  rows.value = (Object.entries(granted) as [ProviderId, string][]).map(([id, at]) => ({ id, at, label: PROVIDERS.find((p) => p.id === id)?.label ?? id }))
}

async function revoke(id: ProviderId) {
  await revokeConsent(id)
  await load()
}

function confirmDelete() {
  $q.dialog({ title: t('shell.privacy.deleteAll'), message: t('shell.privacy.deleteConfirm'), cancel: { flat: true, label: t('common.cancel') }, ok: { color: 'negative', unelevated: true, label: t('shell.privacy.deleteAll') }, persistent: true })
    .onOk(async () => {
      await deleteAllData()
      // Start fresh: settings, language and provider cards are reloaded from the empty database.
      window.location.hash = '#/dashboard'
      window.location.reload()
    })
}

onMounted(load)
</script>

<style scoped>
.consent-row { padding: 8px 0; border-top: 1px solid var(--line); }
</style>
