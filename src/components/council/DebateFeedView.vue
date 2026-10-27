<template>
  <div class="stack">
    <!-- Round 1 -->
    <div>
      <div class="text-subtitle1 q-mb-sm row items-center q-gutter-sm">
        <q-icon name="psychology" /> <span>1 · {{ t('council.round.independent') }}</span>
        <span class="text-caption text-soft">{{ t('council.feed.independentHint') }}</span>
      </div>
      <div class="debate-grid">
        <q-card v-for="m in members" :key="m.id" flat bordered>
          <q-card-section class="q-pb-sm">
            <div class="row items-center no-wrap q-gutter-sm">
              <span class="seat" :style="{ background: seatColor(m.id) }">{{ m.id }}</span>
              <div class="col">
                <div class="text-weight-medium">{{ m.roleLabel }}</div>
                <div class="text-caption text-soft ellipsis">{{ m.provider }} · {{ m.model }}</div>
              </div>
            </div>
          </q-card-section>
          <q-card-section class="q-pt-none">
            <template v-if="analysisOf(m.id)">
              <div class="q-mb-sm" style="white-space: pre-wrap">{{ analysisOf(m.id)!.summary }}</div>
              <div v-for="(c, i) in analysisOf(m.id)!.claims" :key="i" class="claim">
                <span v-if="c.id" class="tag tag-id">{{ c.id }}</span>
                <span class="tag" :class="`tag-${c.type}`">{{ t(`council.feed.type.${c.type}`) }}</span>
                <span class="text-caption text-soft q-mr-xs">{{ t(`common.confidence.${c.confidence}`) }}</span>
                <span>{{ c.text }}</span>
              </div>
            </template>
            <LiveText v-else-if="feed.live[m.id]?.round === 'independent'" :text="feed.live[m.id]!.text" />
            <div v-else-if="feed.failed[m.id]" class="text-negative text-caption">{{ feed.failed[m.id] }}</div>
            <div v-else class="text-caption text-soft">{{ t('council.feed.waiting') }}</div>
          </q-card-section>
        </q-card>
      </div>
    </div>

    <!-- Round 2 -->
    <div v-if="feed.reviews.length || liveIn('critique').length">
      <div class="text-subtitle1 q-mb-sm row items-center q-gutter-sm">
        <q-icon name="forum" /> <span>2 · {{ t('council.round.critique') }}</span>
        <span class="text-caption text-soft">{{ t('council.feed.critiqueHint') }}</span>
      </div>
      <div class="debate-grid">
        <q-card v-for="r in feed.reviews" :key="r.participantId" flat bordered>
          <q-card-section class="q-pb-sm row items-center no-wrap q-gutter-sm">
            <span class="seat" :style="{ background: seatColor(r.participantId) }">{{ r.participantId }}</span>
            <div class="text-weight-medium">{{ r.roleLabel }}</div>
          </q-card-section>
          <q-card-section class="q-pt-none">
            <div v-if="!r.reviews.length && !r.missing.length" class="text-caption text-soft">{{ t('council.feed.noComment') }}</div>
            <div v-for="(rv, i) in r.reviews" :key="i" class="claim">
              <div class="row items-center no-wrap q-gutter-xs">
                <q-icon :name="STANCE[rv.stance].icon" :color="STANCE[rv.stance].color" />
                <span class="text-weight-medium">{{ t(`council.feed.stance.${rv.stance}`) }}</span>
                <span class="tag tag-id">{{ rv.claimId }}</span>
                <span class="text-caption text-soft ellipsis">{{ claimAuthor(rv.claimId) }}</span>
              </div>
              <div class="quote text-caption">{{ claimText(rv.claimId) }}</div>
              <div>{{ rv.reason }}</div>
            </div>
            <div v-if="r.missing.length" class="q-mt-sm">
              <div class="text-caption text-weight-medium">{{ t('council.feed.missingPoints') }}</div>
              <div v-for="(mp, i) in r.missing" :key="i" class="claim">
                <span class="tag" :class="`tag-${mp.type}`">{{ t(`council.feed.type.${mp.type}`) }}</span>{{ mp.text }}
              </div>
            </div>
          </q-card-section>
        </q-card>
        <q-card v-for="pid in liveIn('critique')" :key="`live-${pid}`" flat bordered>
          <q-card-section class="q-pb-sm row items-center no-wrap q-gutter-sm">
            <span class="seat" :style="{ background: seatColor(pid) }">{{ pid }}</span>
            <div class="text-weight-medium">{{ memberOf(pid)?.roleLabel }}</div>
          </q-card-section>
          <q-card-section class="q-pt-none"><LiveText :text="feed.live[pid]!.text" /></q-card-section>
        </q-card>
      </div>
    </div>

    <!-- Judge -->
    <div v-if="feed.live.judge || judgeDone || feed.failed.judge">
      <div class="text-subtitle1 q-mb-sm row items-center q-gutter-sm">
        <q-icon name="gavel" /> <span>3 · {{ t('council.round.judge') }}</span>
        <span class="text-caption text-soft">{{ t('council.feed.judgeHint') }}</span>
      </div>
      <q-card flat bordered>
        <q-card-section>
          <LiveText v-if="feed.live.judge" :text="feed.live.judge.text" />
          <div v-else-if="feed.failed.judge" class="text-negative">{{ feed.failed.judge }}</div>
          <div v-else class="row items-center q-gutter-sm"><q-icon name="check_circle" color="positive" /> <span>{{ t('council.feed.reportReady') }}</span></div>
        </q-card-section>
      </q-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h } from 'vue'
import { liveFragments, type DebateFeed } from '@/domain/council/feed'
import { fmtNum, t } from '@/i18n'

const props = defineProps<{ feed: DebateFeed; judgeDone?: boolean }>()

const members = computed(() => props.feed.members.filter((m) => m.id !== 'judge'))
const memberOf = (id: string) => props.feed.members.find((m) => m.id === id)
const analysisOf = (id: string) => props.feed.analyses.find((a) => a.participantId === id)
const liveIn = (round: string) => Object.keys(props.feed.live).filter((id) => id !== 'judge' && props.feed.live[id]!.round === round)
const claimText = (id: string) => props.feed.claims.find((c) => c.id === id)?.text ?? ''
const claimAuthor = (id: string) => props.feed.claims.find((c) => c.id === id)?.roleLabel ?? ''

/** Each member keeps one seat colour everywhere in the debate (see --seat-* in theme.css). */
const seatColor = (id: string) => (id === 'judge' ? 'var(--seat-judge)' : `var(--seat-${((Number(id.replace(/\D/g, '')) - 1) % 6) + 1})`)
const STANCE = {
  agree: { icon: 'thumb_up', color: 'positive' },
  disagree: { icon: 'thumb_down', color: 'negative' },
  wrong_assumption: { icon: 'report', color: 'deep-orange' },
} as const

/** What a member is typing right now, as readable sentences rather than raw JSON. */
const LiveText = defineComponent({
  props: { text: { type: String, required: true } },
  setup(p) {
    return () => {
      const lines = liveFragments(p.text)
      return h('div', [
        h('div', { class: 'row items-center q-gutter-sm text-primary q-mb-xs' }, [
          h('span', { class: 'typing' }, [h('i'), h('i'), h('i')]),
          h('span', { class: 'text-caption' }, t('council.feed.typing', { count: fmtNum(p.text.length) })),
        ]),
        ...lines.map((l) => h('div', { class: 'live-line' }, l)),
      ])
    }
  },
})
</script>

<style scoped>
.debate-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 12px;
}
.claim {
  padding: 6px 0;
  border-top: 1px solid rgba(128, 128, 128, 0.15);
  line-height: 1.45;
}
.quote {
  opacity: 0.7;
  border-left: 3px solid rgba(128, 128, 128, 0.4);
  padding-left: 8px;
  margin: 4px 0;
}
</style>

<style>
/* Unscoped: LiveText renders through h(), which does not get this file's scope id. */
.live-line {
  opacity: 0.8;
  padding: 2px 0;
}
.typing i {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-right: 3px;
  border-radius: 50%;
  background: currentColor;
  animation: blink 1.2s infinite;
}
.typing i:nth-child(2) { animation-delay: 0.2s; }
.typing i:nth-child(3) { animation-delay: 0.4s; }
@keyframes blink {
  0%, 80%, 100% { opacity: 0.2; }
  40% { opacity: 1; }
}
</style>
