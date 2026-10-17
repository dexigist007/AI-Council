<template>
  <div class="stack">
    <q-card flat bordered>
      <q-card-section>
        <div class="text-subtitle1 q-mb-xs">Özet</div>
        <div style="white-space: pre-wrap">{{ report.summary }}</div>
      </q-card-section>
      <q-card-section v-if="report.reality_check.length" class="q-pt-none">
        <q-banner rounded class="tone-warn">
          <template #avatar><q-icon name="balance" /></template>
          <div class="text-weight-medium q-mb-xs">Gerçeklik kontrolü</div>
          <ul class="q-ma-none q-pl-md"><li v-for="(r, i) in report.reality_check" :key="i">{{ r }}</li></ul>
        </q-banner>
      </q-card-section>
    </q-card>

    <q-card v-for="c in sorted" :key="c.rank + c.name" flat bordered>
      <q-card-section class="row items-start no-wrap q-gutter-md">
        <div class="rank">#{{ c.rank }}</div>
        <div class="col">
          <div class="row items-center q-gutter-sm">
            <div class="text-h6">{{ c.name }}</div>
            <q-badge color="primary">{{ KIND[c.kind] }}</q-badge>
            <q-badge :color="CONF[c.confidence].color">{{ CONF[c.confidence].label }}</q-badge>
          </div>
          <div class="q-mt-xs">{{ c.one_liner }}</div>
          <div class="facts q-mt-sm">
            <div><q-icon name="schedule" /> İlk gelir: <b>{{ c.time_to_first_revenue }}</b></div>
            <div><q-icon name="payments" /> Başlangıç maliyeti: <b>{{ c.startup_cost }}</b></div>
            <div><q-icon name="hourglass_bottom" /> Haftalık: <b>{{ c.weekly_hours }}</b></div>
            <div><q-icon name="sell" /> Fiyat: <b>{{ c.pricing }}</b></div>
          </div>
        </div>
        <div class="col-auto">
          <q-btn v-if="!promoted[c.name]" outline color="primary" no-caps icon="lightbulb" label="Fikre dönüştür" :loading="busy === c.name" @click="promote(c)" />
          <q-btn v-else flat color="positive" no-caps icon="check" label="Fikre git" :to="`/ideas/${promoted[c.name]}`" />
        </div>
      </q-card-section>

      <q-card-section class="q-pt-none">
        <div class="text-caption text-weight-medium">Sana neden uygun</div>
        <div class="q-mb-sm">{{ c.why_this_fits_you }}</div>

        <div class="text-caption text-weight-medium q-mt-sm">Gelir senaryoları (yaklaşık 3. ay, aylık)</div>
        <div class="scenarios q-mt-xs">
          <div v-for="s in SCEN" :key="s.key" class="scenario" :class="s.cls">
            <div class="text-caption">{{ s.label }}</div>
            <div class="text-weight-bold">{{ c.revenue_scenarios[s.key].amount }}</div>
            <div class="text-caption text-soft">{{ c.revenue_scenarios[s.key].assumption }}</div>
          </div>
        </div>
      </q-card-section>

      <q-expansion-item dense icon="article" label="Detaylı rapor" header-class="text-primary">
        <q-card-section class="detail-grid">
          <div><div class="label">Hedef müşteri</div>{{ c.target_customer }}</div>
          <div><div class="label">Problem</div>{{ c.problem }}</div>
          <div><div class="label">Çözüm</div>{{ c.solution }}</div>
          <div><div class="label">Gelir modeli</div>{{ c.revenue_model }}</div>
          <div><div class="label">İlk gelire giden yol</div>{{ c.first_revenue_path }}</div>
          <div><div class="label">Birim ekonomi</div>{{ c.unit_economics }}</div>
          <div><div class="label">Rekabet</div>{{ c.competition }}</div>
          <div><div class="label">Farklılaşma</div>{{ c.differentiation }}</div>
          <div><div class="label">Dağıtım kanalları</div><ul><li v-for="(x, i) in c.distribution_channels" :key="i">{{ x }}</li></ul></div>
          <div><div class="label">Kritik varsayımlar</div><ul><li v-for="(x, i) in c.key_assumptions" :key="i">{{ x }}</li></ul></div>
          <div><div class="label">Ana riskler</div><ul><li v-for="(x, i) in c.main_risks" :key="i">{{ x }}</li></ul></div>
          <div><div class="label">Bırakma kriterleri (bunlar olursa dur)</div><ul><li v-for="(x, i) in c.kill_criteria" :key="i">{{ x }}</li></ul></div>
        </q-card-section>
        <q-card-section class="q-pt-none">
          <div class="label">7 günlük doğrulama planı</div>
          <q-markup-table flat dense separator="horizontal">
            <thead><tr><th class="text-left" style="width: 90px">Gün</th><th class="text-left">Ne yapılacak</th><th class="text-left">Başarı sinyali</th></tr></thead>
            <tbody>
              <tr v-for="(v, i) in c.validation_plan" :key="i">
                <td>{{ v.day }}</td><td class="text-wrap">{{ v.action }}</td><td class="text-wrap">{{ v.success_signal }}</td>
              </tr>
            </tbody>
          </q-markup-table>
        </q-card-section>
        <q-card-section class="q-pt-none">
          <div class="label">Doğrulama geçerse ilk 30 gün</div>
          <ol class="q-ma-none q-pl-md"><li v-for="(x, i) in c.first_30_days" :key="i">{{ x }}</li></ol>
          <div v-if="c.supporting_claims.length" class="text-caption text-soft q-mt-sm">Dayandığı iddialar: {{ c.supporting_claims.join(', ') }}</div>
        </q-card-section>
      </q-expansion-item>
    </q-card>

    <div class="row q-col-gutter-md">
      <div v-if="report.rejected.length" class="col-12 col-md-6">
        <q-card flat bordered class="full-height">
          <q-card-section class="text-subtitle2"><q-icon name="block" class="q-mr-xs" />Elenen adaylar</q-card-section>
          <q-list dense separator>
            <q-item v-for="(r, i) in report.rejected" :key="i">
              <q-item-section><q-item-label>{{ r.name }}</q-item-label><q-item-label caption>{{ r.reason }}</q-item-label></q-item-section>
            </q-item>
          </q-list>
        </q-card>
      </div>
      <div v-if="report.open_questions.length" class="col-12 col-md-6">
        <q-card flat bordered class="full-height">
          <q-card-section class="text-subtitle2"><q-icon name="help_outline" class="q-mr-xs" />Bir sonraki tur için yanıtlaman gerekenler</q-card-section>
          <q-card-section class="q-pt-none"><ul class="q-ma-none q-pl-md"><li v-for="(q, i) in report.open_questions" :key="i">{{ q }}</li></ul></q-card-section>
        </q-card>
      </div>
    </div>

    <q-card v-if="report.disagreements.length" flat bordered>
      <q-card-section class="text-subtitle2"><q-icon name="call_split" class="q-mr-xs" />Görüş ayrılıkları</q-card-section>
      <q-card-section class="q-pt-none">
        <div v-for="(d, i) in report.disagreements" :key="i" class="q-mb-sm">
          <div class="text-weight-medium">{{ d.topic }}</div>
          <div v-for="(p, j) in d.positions" :key="j" class="text-caption">• {{ p }}</div>
        </div>
      </q-card-section>
    </q-card>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { repos } from '@/db'
import type { Candidate, DiscoveryReport } from '@/domain/discovery/report'
import { candidateToIdea } from '@/domain/discovery/task'

const props = defineProps<{ report: DiscoveryReport }>()

const sorted = computed(() => [...props.report.candidates].sort((a, b) => a.rank - b.rank))
const promoted = reactive<Record<string, string>>({})
const busy = ref<string | null>(null)

async function promote(c: Candidate) {
  busy.value = c.name
  try {
    const idea = await (await repos()).ideas.create(candidateToIdea(c))
    promoted[c.name] = idea.id
  } finally {
    busy.value = null
  }
}

const KIND = { app: 'Uygulama', game: 'Oyun', saas: 'SaaS', service: 'Hizmet', content: 'İçerik', ecommerce: 'E-ticaret', other: 'Diğer' } as const
const CONF = {
  high: { label: 'yüksek güven', color: 'positive' },
  medium: { label: 'orta güven', color: 'orange-8' },
  low: { label: 'düşük güven', color: 'negative' },
} as const
const SCEN = [
  { key: 'pessimistic', label: 'Kötümser', cls: 'pess' },
  { key: 'realistic', label: 'Gerçekçi', cls: 'real' },
  { key: 'optimistic', label: 'İyimser', cls: 'opt' },
] as const
</script>

<style scoped>
.rank {
  font-size: 28px;
  font-weight: 700;
  opacity: 0.5;
  min-width: 48px;
}
.facts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 20px;
  font-size: 13px;
}
.scenarios {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.scenario {
  border-radius: 6px;
  padding: 8px 10px;
  border: 1px solid rgba(128, 128, 128, 0.25);
}
.scenario.pess { border-left: 4px solid #e57373; }
.scenario.real { border-left: 4px solid #ffb74d; }
.scenario.opt { border-left: 4px solid #81c784; }
.detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 14px 24px;
}
.detail-grid ul {
  margin: 0;
  padding-left: 18px;
}
.label {
  font-size: 12px;
  font-weight: 600;
  opacity: 0.7;
  margin-bottom: 2px;
}
</style>
