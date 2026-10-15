<template>
  <div class="stack">
    <q-card flat bordered>
      <q-card-section class="row items-center q-gutter-sm">
        <q-chip square size="lg" :color="decision.color" text-color="white" class="text-weight-bold">{{ decision.label }}</q-chip>
        <div class="text-grey-7">{{ decision.hint }}</div>
        <q-space />
        <q-chip v-if="report.survives_kill_test !== null" :color="report.survives_kill_test ? 'positive' : 'negative'" text-color="white"
          :icon="report.survives_kill_test ? 'shield' : 'local_fire_department'">
          {{ report.survives_kill_test ? 'Fikir saldırıdan sağ çıktı' : 'Fikir saldırıya dayanamadı' }}
        </q-chip>
      </q-card-section>
      <q-card-section class="q-pt-none" style="white-space: pre-wrap">{{ report.decision_reason }}</q-card-section>
      <q-card-section v-if="report.revisit_condition" class="q-pt-none">
        <b>Yeniden değerlendirme koşulu:</b> {{ report.revisit_condition }}
      </q-card-section>
    </q-card>

    <q-card flat bordered>
      <q-card-section class="text-subtitle2">Rubrik</q-card-section>
      <q-markup-table flat dense separator="horizontal">
        <tbody>
          <tr v-for="r in report.rubric" :key="r.dimension">
            <td style="width: 160px">{{ RUBRIC_LABEL[r.dimension] }}</td>
            <td style="width: 90px"><q-badge :color="rubricColor(r.dimension, r.level)">{{ LEVEL_LABEL[r.level] }}</q-badge></td>
            <td class="text-wrap">{{ r.reason }}</td>
          </tr>
        </tbody>
      </q-markup-table>
    </q-card>

    <div class="row q-col-gutter-md">
      <div v-for="s in listSections" :key="s.title" class="col-12 col-md-6">
        <q-card flat bordered class="full-height">
          <q-card-section class="text-subtitle2"><q-icon :name="s.icon" :color="s.color" class="q-mr-xs" />{{ s.title }}</q-card-section>
          <q-card-section class="q-pt-none">
            <ul v-if="s.items.length" class="q-ma-none q-pl-md"><li v-for="(it, i) in s.items" :key="i" class="q-mb-xs">{{ it }}</li></ul>
            <div v-else class="text-grey-6">—</div>
          </q-card-section>
        </q-card>
      </div>
    </div>

    <q-card flat bordered>
      <q-card-section class="text-subtitle2">Kritik varsayımlar ve nasıl doğrulanır</q-card-section>
      <q-list separator>
        <q-item v-for="(a, i) in report.critical_assumptions" :key="i">
          <q-item-section>
            <q-item-label>{{ a.assumption }}</q-item-label>
            <q-item-label caption>Doğrulama: {{ a.how_to_validate }}</q-item-label>
          </q-item-section>
        </q-item>
      </q-list>
    </q-card>

    <q-card flat bordered>
      <q-card-section class="text-subtitle2">Önerilen MVP</q-card-section>
      <q-card-section class="q-pt-none row q-col-gutter-md">
        <div class="col-12 col-md-6">
          <div class="text-caption text-positive q-mb-xs">MVP'de olmalı</div>
          <ul class="q-ma-none q-pl-md"><li v-for="(x, i) in report.suggested_mvp.include" :key="i">{{ x }}</li></ul>
        </div>
        <div class="col-12 col-md-6">
          <div class="text-caption text-negative q-mb-xs">MVP'de kesinlikle olmamalı</div>
          <ul class="q-ma-none q-pl-md"><li v-for="(x, i) in report.suggested_mvp.exclude" :key="i">{{ x }}</li></ul>
        </div>
      </q-card-section>
    </q-card>

    <q-card v-if="report.disagreements.length" flat bordered>
      <q-card-section class="text-subtitle2"><q-icon name="call_split" class="q-mr-xs" />Görüş ayrılıkları</q-card-section>
      <q-list separator>
        <q-item v-for="(d, i) in report.disagreements" :key="i">
          <q-item-section>
            <q-item-label class="text-weight-medium">{{ d.topic }}</q-item-label>
            <q-item-label v-for="(p, j) in d.positions" :key="j" caption>• {{ p }}</q-item-label>
          </q-item-section>
        </q-item>
      </q-list>
    </q-card>

    <q-expansion-item v-if="council" dense icon="forum" :label="`Tartışma ayrıntısı (${council.claims.length} iddia, ${council.reviews.length} değerlendirme)`">
      <q-card flat bordered>
        <q-card-section v-if="council.failed.length" class="text-negative text-caption">
          Analizi başarısız olan üyeler: {{ council.failed.map((f) => `${f.participantId} (${f.error})`).join(', ') }}
        </q-card-section>
        <q-list dense separator>
          <q-item v-for="c in council.claims" :key="c.id">
            <q-item-section side top><q-badge outline>{{ c.id }}</q-badge></q-item-section>
            <q-item-section>
              <q-item-label>{{ c.text }}</q-item-label>
              <q-item-label caption>{{ c.roleLabel }} · {{ c.type }} · {{ c.confidence }}</q-item-label>
              <q-item-label v-for="(r, i) in reviewsOf(c.id)" :key="i" caption :class="r.stance === 'agree' ? 'text-positive' : 'text-negative'">
                {{ r.roleLabel }}: {{ r.stance }} — {{ r.reason }}
              </q-item-label>
            </q-item-section>
          </q-item>
        </q-list>
      </q-card>
    </q-expansion-item>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CouncilReport } from '@/domain/council/engine'
import { DECISION_META, LEVEL_LABEL, RUBRIC_LABEL, rubricColor } from '@/domain/ideas/labels'
import type { IdeaReport } from '@/domain/ideas/report'

const props = defineProps<{ report: IdeaReport; council?: CouncilReport<IdeaReport> }>()

const decision = computed(() => DECISION_META[props.report.decision])
const listSections = computed(() => [
  { title: 'Güçlü yanlar', icon: 'thumb_up', color: 'positive', items: props.report.strengths },
  { title: 'Zayıf yanlar', icon: 'thumb_down', color: 'negative', items: props.report.weaknesses },
  { title: 'Ana riskler', icon: 'warning', color: 'orange', items: props.report.main_risks },
  { title: 'Henüz yapma', icon: 'block', color: 'grey-7', items: props.report.do_not_build_yet },
  { title: 'Önerilen sonraki adımlar', icon: 'flag', color: 'primary', items: props.report.next_steps },
])
const reviewsOf = (id: string) => props.council?.reviews.filter((r) => r.claimId === id) ?? []
</script>
