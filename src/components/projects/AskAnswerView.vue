<template>
  <q-card flat bordered>
    <q-card-section>
      <div class="text-caption text-grey-7">Soru</div>
      <div class="text-subtitle1">{{ report.question }}</div>
    </q-card-section>
    <q-card-section class="q-pt-none">
      <div class="row items-center q-mb-xs">
        <div class="text-caption text-grey-7">Cevap</div>
        <q-badge class="q-ml-sm" :color="CONF[report.confidence].color">güven: {{ CONF[report.confidence].label }}</q-badge>
      </div>
      <!-- Plain text on purpose: model output is never rendered as HTML. -->
      <div class="answer">{{ report.answer }}</div>
    </q-card-section>
    <q-card-section v-if="report.citations.length" class="q-pt-none">
      <div class="text-caption text-grey-7 q-mb-xs">Kaynaklar</div>
      <q-list dense bordered separator>
        <q-item v-for="(c, i) in report.citations" :key="i">
          <q-item-section side top>
            <q-badge :color="c.verified ? 'positive' : 'negative'">{{ c.verified ? 'DOĞRULANDI' : 'UNVERIFIED' }}</q-badge>
          </q-item-section>
          <q-item-section>
            <q-item-label>{{ c.file }}:{{ c.start_line }}<span v-if="c.end_line !== c.start_line">-{{ c.end_line }}</span></q-item-label>
            <q-item-label caption class="mono">{{ c.quote }}</q-item-label>
            <q-item-label v-if="!c.verified" caption class="text-negative">Bu alıntı gönderilen kodda bulunamadı; iddiayı kontrol etmeden kullanma.</q-item-label>
          </q-item-section>
        </q-item>
      </q-list>
    </q-card-section>
    <q-card-section v-if="report.missingContext.length" class="q-pt-none">
      <div class="text-caption text-grey-7">Cevap için eksik kalan bağlam</div>
      <ul class="q-my-xs q-pl-md"><li v-for="(m, i) in report.missingContext" :key="i">{{ m }}</li></ul>
      <div class="text-caption text-grey-7">Bu parçaları bulmak için arama terimlerini değiştirip tekrar sorabilirsin.</div>
    </q-card-section>
    <q-card-section class="q-pt-none text-caption text-grey-7">Gönderilen dosyalar: {{ report.sentFiles.join(', ') }}</q-card-section>
  </q-card>
</template>

<script setup lang="ts">
import type { AskReport } from '@/domain/ask/ask'

defineProps<{ report: AskReport }>()
const CONF = {
  high: { label: 'yüksek', color: 'positive' },
  medium: { label: 'orta', color: 'warning' },
  low: { label: 'düşük', color: 'negative' },
} as const
</script>

<style scoped>
.answer { white-space: pre-wrap; line-height: 1.5; }
.mono { font-family: ui-monospace, monospace; white-space: pre-wrap; }
</style>
