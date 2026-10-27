<template>
  <q-dialog ref="dialogRef" persistent @hide="onDialogHide">
    <q-card class="consent">
      <q-card-section>
        <div class="text-h6">{{ t('shell.consent.title') }}</div>
        <div class="q-mt-sm">{{ t('shell.consent.body') }}</div>
      </q-card-section>
      <q-card-section class="q-pt-none">
        <div v-for="p in metas" :key="p.id" class="provider">
          <div class="text-weight-medium">{{ p.label }}</div>
          <div class="text-caption text-soft">{{ t('shell.consent.operator', { operator: p.operator ?? p.label }) }}</div>
          <a v-if="p.privacyUrl" href="#" class="text-caption" @click.prevent="openUrl(p.privacyUrl)">{{ t('shell.consent.policy') }}</a>
          <div v-if="p.note === 'china'" class="text-caption text-warn">{{ t('shell.provider.note.china') }}</div>
        </div>
        <div class="text-caption text-soft q-mt-md">{{ t('shell.consent.footer') }}</div>
      </q-card-section>
      <q-card-actions align="right" class="q-px-md q-pb-md">
        <q-btn flat :label="t('shell.consent.deny')" @click="onDialogCancel" />
        <q-btn unelevated color="primary" :label="t('shell.consent.allow')" @click="onDialogOK(true)" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useDialogPluginComponent } from 'quasar'
import { PROVIDERS } from '@/domain/providers/registry'
import type { ProviderId } from '@/domain/providers/types'
import { t } from '@/i18n'
import { openUrl } from '@/platform/tauri'

const props = defineProps<{ providers: ProviderId[] }>()
defineEmits([...useDialogPluginComponent.emits])
const { dialogRef, onDialogHide, onDialogOK, onDialogCancel } = useDialogPluginComponent()
const metas = computed(() => props.providers.map((id) => PROVIDERS.find((p) => p.id === id)!).filter(Boolean))
</script>

<style scoped>
.consent { width: 520px; max-width: 92vw; }
.provider { padding: 10px 0; border-top: 1px solid var(--line); }
</style>
