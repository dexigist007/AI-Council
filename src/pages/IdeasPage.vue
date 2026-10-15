<template>
  <q-page padding>
    <div class="row items-center q-mb-md">
      <div class="text-h5">Fikirler</div>
      <q-space />
      <q-btn unelevated color="primary" icon="add" label="Yeni fikir" @click="showNew = true" />
    </div>

    <q-card v-if="showNew" flat bordered class="q-mb-lg" style="max-width: 900px">
      <q-card-section class="q-gutter-sm">
        <q-input v-model="title" outlined dense autofocus label="Fikir (tek cümle)" />
        <q-input v-model="body" outlined autogrow type="textarea" label="Ayrıntı: problem, hedef kullanıcı, aklındaki çözüm…" />
        <SimilarIdeas :text="`${title} ${body}`" :ideas="all" />
      </q-card-section>
      <q-card-actions align="right" class="q-px-md q-pb-md">
        <q-btn flat label="Vazgeç" @click="reset" />
        <q-btn unelevated color="primary" label="Kaydet ve aç" :disable="!title.trim()" @click="create" />
      </q-card-actions>
    </q-card>

    <div v-if="active.length === 0 && !showNew" class="text-grey-7">
      Henüz fikir yok. Bir fikir yaz, Council'a değerlendirt ya da öldürmeye çalış.
    </div>
    <q-list v-else bordered separator style="max-width: 900px">
      <q-item v-for="i in active" :key="i.id" clickable :to="`/ideas/${i.id}`">
        <q-item-section>
          <q-item-label>{{ i.title }}</q-item-label>
          <q-item-label caption lines="1">{{ i.body }}</q-item-label>
        </q-item-section>
        <q-item-section side>
          <q-badge :color="i.status === 'evaluating' ? 'orange' : i.status === 'draft' ? 'grey-6' : 'primary'">{{ STATUS_LABEL[i.status] }}</q-badge>
          <q-item-label caption class="q-mt-xs">{{ new Date(i.updatedAt).toLocaleDateString() }}</q-item-label>
        </q-item-section>
      </q-item>
    </q-list>
    <div v-if="graveyardCount" class="q-mt-md text-caption">
      <router-link to="/graveyard">Idea Graveyard'da {{ graveyardCount }} fikir var</router-link>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import SimilarIdeas from '@/components/ideas/SimilarIdeas.vue'
import { repos, type Idea } from '@/db'
import { GRAVEYARD_STATUSES } from '@/db/repositories/ideas'
import { STATUS_LABEL } from '@/domain/ideas/labels'

const router = useRouter()
const all = ref<Idea[]>([])
const showNew = ref(false)
const title = ref('')
const body = ref('')
const active = computed(() => all.value.filter((i) => !GRAVEYARD_STATUSES.includes(i.status)))
const graveyardCount = computed(() => all.value.length - active.value.length)

function reset() {
  showNew.value = false
  title.value = ''
  body.value = ''
}

async function create() {
  const idea = await (await repos()).ideas.create({ title: title.value, body: body.value })
  await router.push(`/ideas/${idea.id}`)
}

onMounted(async () => {
  all.value = await (await repos()).ideas.list()
})
</script>
