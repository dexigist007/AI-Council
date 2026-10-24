<template>
  <q-card flat bordered>
    <q-card-section>
      <div class="text-caption text-grey-7">{{ t('projects.answer.question') }}</div>
      <div class="text-subtitle1">{{ report.question }}</div>
    </q-card-section>
    <q-card-section class="q-pt-none">
      <div class="row items-center q-mb-xs">
        <div class="text-caption text-grey-7">{{ t('projects.answer.answer') }}</div>
        <q-badge class="q-ml-sm" :color="CONF[report.confidence].color">{{ t('projects.answer.confidence', { level: t(`projects.answer.conf.${report.confidence}`) }) }}</q-badge>
      </div>
      <!-- Plain text on purpose: model output is never rendered as HTML. -->
      <div class="answer">{{ report.answer }}</div>
    </q-card-section>
    <q-card-section v-if="report.citations.length" class="q-pt-none">
      <div class="text-caption text-grey-7 q-mb-xs">{{ t('projects.answer.sources') }}</div>
      <q-list dense bordered separator>
        <q-item v-for="(c, i) in report.citations" :key="i">
          <q-item-section side top>
            <q-badge :color="c.verified ? 'positive' : 'negative'">{{ c.verified ? t('projects.answer.verified') : t('projects.answer.unverified') }}</q-badge>
          </q-item-section>
          <q-item-section>
            <q-item-label>{{ c.file }}:{{ c.start_line }}<span v-if="c.end_line !== c.start_line">-{{ c.end_line }}</span></q-item-label>
            <q-item-label caption class="mono">{{ c.quote }}</q-item-label>
            <q-item-label v-if="!c.verified" caption class="text-negative">{{ t('projects.answer.notFound') }}</q-item-label>
          </q-item-section>
        </q-item>
      </q-list>
    </q-card-section>
    <q-card-section v-if="report.missingContext.length" class="q-pt-none">
      <div class="text-caption text-grey-7">{{ t('projects.answer.missing') }}</div>
      <ul class="q-my-xs q-pl-md"><li v-for="(m, i) in report.missingContext" :key="i">{{ m }}</li></ul>
      <div class="text-caption text-grey-7">{{ t('projects.answer.missingHint') }}</div>
    </q-card-section>
    <q-card-section class="q-pt-none text-caption text-grey-7">{{ t('projects.answer.sentFiles', { files: report.sentFiles.join(', ') }) }}</q-card-section>
  </q-card>
</template>

<script setup lang="ts">
import type { AskReport } from '@/domain/ask/ask'
import { t } from '@/i18n'

defineProps<{ report: AskReport }>()
const CONF = {
  high: { color: 'positive' },
  medium: { color: 'warning' },
  low: { color: 'negative' },
} as const
</script>

<style scoped>
.answer { white-space: pre-wrap; line-height: 1.5; }
.mono { font-family: ui-monospace, monospace; white-space: pre-wrap; }
</style>
