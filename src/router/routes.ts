import type { RouteRecordRaw } from 'vue-router'

export interface NavItem {
  name: string
  label: string
  icon: string
}

// Single source for the sidebar and the routes, so they cannot drift apart.
export const navItems: NavItem[] = [
  { name: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { name: 'ideas', label: 'Ideas', icon: 'lightbulb' },
  { name: 'projects', label: 'Projects', icon: 'folder' },
  { name: 'council', label: 'Council', icon: 'groups' },
  { name: 'findings', label: 'Findings', icon: 'bug_report' },
  { name: 'decisions', label: 'Decisions', icon: 'gavel' },
  { name: 'graveyard', label: 'Idea Graveyard', icon: 'inventory_2' },
  { name: 'settings', label: 'Settings', icon: 'settings' },
]

const pages: Record<string, () => Promise<unknown>> = {
  dashboard: () => import('@/pages/DashboardPage.vue'),
  ideas: () => import('@/pages/IdeasPage.vue'),
  projects: () => import('@/pages/ProjectsPage.vue'),
  council: () => import('@/pages/CouncilPage.vue'),
  findings: () => import('@/pages/FindingsPage.vue'),
  decisions: () => import('@/pages/DecisionsPage.vue'),
  graveyard: () => import('@/pages/GraveyardPage.vue'),
  settings: () => import('@/pages/SettingsPage.vue'),
}

export const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('@/layouts/MainLayout.vue'),
    children: [
      { path: '', redirect: { name: 'dashboard' } },
      ...navItems.map((item) => ({
        path: item.name,
        name: item.name,
        component: pages[item.name]!,
        meta: { title: item.label },
      })),
      { path: 'ideas/:id', component: () => import('@/pages/IdeaDetailPage.vue'), meta: { title: 'Fikir' } },
      { path: 'projects/:id', component: () => import('@/pages/ProjectDetailPage.vue'), meta: { title: 'Proje' } },
      { path: 'council/:id', component: () => import('@/pages/CouncilSessionPage.vue'), meta: { title: 'Council oturumu' } },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: { name: 'dashboard' } },
]
