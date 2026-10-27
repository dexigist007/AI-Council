<template>
  <q-layout view="lHh LpR lFf" :class="{ 'is-mac': isMac }">
    <!-- On macOS the window has no title bar; this strip lets the user drag it. -->
    <div v-if="isMac" class="drag-strip" data-tauri-drag-region />

    <q-drawer :model-value="true" persistent :breakpoint="0" :width="236" class="sidebar">
      <div class="brand" data-tauri-drag-region>
        <BrandMark class="brand-mark" />
        <span class="brand-name">AI Council</span>
      </div>
      <nav class="nav">
        <div v-for="(group, gi) in navGroups" :key="gi" class="nav-group">
          <router-link v-for="item in group" :key="item.name" :to="{ name: item.name }" class="nav-item" active-class="active">
            <q-icon :name="item.icon" size="20px" />
            <span>{{ t(item.label) }}</span>
          </router-link>
        </div>
      </nav>
    </q-drawer>

    <q-page-container class="main">
      <router-view />
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import BrandMark from '@/components/BrandMark.vue'
import { t } from '@/i18n'
import { navItems } from '@/router/routes'

const isMac = /Mac/.test(navigator.userAgent)

// Create → review → records; Settings sits alone at the end.
const GROUPS = [['dashboard', 'discovery', 'ideas'], ['projects', 'findings'], ['council', 'live'], ['decisions', 'graveyard'], ['settings']]
const navGroups = computed(() => GROUPS.map((g) => g.map((name) => navItems.find((i) => i.name === name)!).filter(Boolean)))
</script>

<style scoped>
.drag-strip {
  position: fixed;
  inset: 0 0 auto 0;
  height: 30px;
  z-index: 3000;
}
.sidebar :deep(.q-drawer) {
  background: var(--sidebar);
  border-right: 1px solid var(--line);
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 22px 20px 18px;
}
.is-mac .brand {
  padding-top: 46px; /* room for the window buttons */
}
.brand-mark {
  width: 26px;
  height: 26px;
}
.brand-name {
  font-size: 16px;
  font-weight: 650;
  letter-spacing: -0.015em;
}
.nav {
  padding: 0 10px 16px;
}
.nav-group + .nav-group {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 11px;
  height: 34px;
  padding: 0 10px;
  border-radius: 8px;
  color: var(--muted);
  font-weight: 520;
  text-decoration: none;
}
.nav-item:hover {
  background: color-mix(in srgb, var(--ink) 5%, transparent);
  color: var(--ink);
  text-decoration: none;
}
.nav-item.active {
  background: var(--surface);
  color: var(--ink);
  box-shadow: 0 0 0 1px var(--line);
}
.nav-item.active .q-icon {
  color: var(--accent);
}
.main :deep(.q-page) {
  padding: 36px 44px 56px !important;
}
.is-mac .main :deep(.q-page) {
  padding-top: 46px !important;
}
</style>
