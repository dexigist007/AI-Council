<template>
  <q-card flat bordered class="bg-blue-1">
    <q-card-section>
      <div class="text-subtitle1">Senin kararın</div>
      <div class="text-caption text-grey-8">
        Council'ın önerisi bir karar değildir. Fikrin durumu ve Decision Log sadece burada onayladığında değişir.
      </div>
    </q-card-section>
    <q-card-section class="q-pt-none q-gutter-sm">
      <q-btn-toggle v-model="decision" unelevated no-caps toggle-color="primary" color="white" text-color="dark"
        :options="DECISIONS.map((d) => ({ label: d === suggested ? `${d} (öneri)` : d, value: d }))" />
      <q-input v-model="reason" dense outlined autogrow label="Gerekçe" />
      <q-input v-if="parks" v-model="revisit" dense outlined autogrow label="Ne değişirse yeniden değerlendirilsin?" />
    </q-card-section>
    <q-card-actions class="q-px-md q-pb-md">
      <q-btn unelevated color="primary" icon="gavel" :label="parks ? 'Onayla ve Graveyard\'a taşı' : 'Kararı onayla'"
        :disable="!reason.trim()" :loading="saving" @click="save" />
      <span v-if="error" class="text-negative q-ml-md">{{ error }}</span>
    </q-card-actions>
  </q-card>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { repos, type Idea } from '@/db'
import { decisionToStatus } from '@/domain/ideas/labels'
import { DECISIONS, type IdeaDecision, type IdeaReport } from '@/domain/ideas/report'

const props = defineProps<{ idea: Idea; report: IdeaReport; sessionId: string }>()
const emit = defineEmits<{ decided: [] }>()

const suggested = props.report.decision
const decision = ref<IdeaDecision>(suggested)
const reason = ref(props.report.decision_reason)
const revisit = ref(props.report.revisit_condition ?? '')
const saving = ref(false)
const error = ref<string | null>(null)
const parks = computed(() => decision.value === 'HOLD' || decision.value === 'REJECT')

async function save() {
  saving.value = true
  try {
    const r = await repos()
    await r.ideas.setVerdict(props.idea.id, {
      status: decisionToStatus(decision.value),
      sessionId: props.sessionId,
      rejectReason: parks.value ? reason.value.trim() : null,
      revisitCondition: parks.value ? revisit.value.trim() || null : null,
    })
    await r.decisions.create({
      ideaId: props.idea.id,
      sessionId: props.sessionId,
      title: `${props.idea.title}: ${decision.value}`,
      reason: reason.value.trim(),
      userApproved: true,
    })
    emit('decided')
  } catch (e) {
    error.value = String(e)
  } finally {
    saving.value = false
  }
}
</script>
