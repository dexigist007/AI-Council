<template>
  <q-layout view="lHh LpR lFf">
    <q-drawer v-model="drawerOpen" show-if-above bordered :width="220">
      <div class="text-h6 q-pa-md">AI Council</div>
      <q-list>
        <q-item
          v-for="item in navItems"
          :key="item.name"
          :to="{ name: item.name }"
          clickable
          active-class="text-primary bg-blue-1"
        >
          <q-item-section avatar><q-icon :name="item.icon" /></q-item-section>
          <q-item-section>{{ item.label }}</q-item-section>
        </q-item>
      </q-list>
    </q-drawer>

    <q-header bordered class="bg-transparent text-body1" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
      <q-toolbar>
        <q-btn flat dense round icon="menu" @click="drawerOpen = !drawerOpen" />
        <q-toolbar-title>{{ route.meta.title }}</q-toolbar-title>
      </q-toolbar>
    </q-header>

    <q-page-container>
      <router-view />
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRoute } from 'vue-router'
import { navItems } from '@/router/routes'

const route = useRoute()
const drawerOpen = ref(true)
</script>
