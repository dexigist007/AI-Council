import type { RouteRecordRaw } from 'vue-router'
import type { MessageKey } from '@/i18n'

export interface NavItem {
  name: string
  /** i18n key of the sidebar label and page title. */
  label: MessageKey
  icon: string
}

// Single source for the sidebar and the routes, so they cannot drift apart.
export const navItems: NavItem[] = [
  { name: 'dashboard', label: 'shell.nav.dashboard', icon: 'dashboard' },
  { name: 'discovery', label: 'shell.nav.discovery', icon: 'explore' },
  { name: 'ideas', label: 'shell.nav.ideas', icon: 'lightbulb' },
  { name: 'projects', label: 'shell.nav.projects', icon: 'folder' },
  { name: 'council', label: 'shell.nav.council', icon: 'groups' },
  { name: 'live', label: 'shell.nav.live', icon: 'forum' },
  { name: 'findings', label: 'shell.nav.findings', icon: 'bug_report' },
  { name: 'decisions', label: 'shell.nav.decisions', icon: 'gavel' },
  { name: 'graveyard', label: 'shell.nav.graveyard', icon: 'inventory_2' },
  { name: 'settings', label: 'shell.nav.settings', icon: 'settings' },
]

const pages: Record<string, () => Promise<unknown>> = {
  dashboard: () => import('@/pages/DashboardPage.vue'),
  discovery: () => import('@/pages/DiscoveryPage.vue'),
  live: () => import('@/pages/LivePage.vue'),
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
      { path: 'ideas/:id', component: () => import('@/pages/IdeaDetailPage.vue'), meta: { title: 'shell.title.idea' } },
      { path: 'projects/:id', component: () => import('@/pages/ProjectDetailPage.vue'), meta: { title: 'shell.title.project' } },
      { path: 'council/:id', component: () => import('@/pages/CouncilSessionPage.vue'), meta: { title: 'shell.title.session' } },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: { name: 'dashboard' } },
]
