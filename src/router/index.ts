import { createRouter, createWebHashHistory } from 'vue-router'
import { routes } from './routes'

// Hash history: the app is served from local files, there is no server to rewrite paths.
export const router = createRouter({ history: createWebHashHistory(), routes })
