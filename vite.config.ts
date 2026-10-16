import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { quasar, transformAssetUrls } from '@quasar/vite-plugin'
import { execSync } from 'node:child_process'
import { fileURLToPath, URL } from 'node:url'

const build = (() => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'dev'
  }
})()

// Tauri expects a fixed dev port and must not clear its own output.
export default defineConfig({
  plugins: [vue({ template: { transformAssetUrls } }), quasar()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  define: { __BUILD__: JSON.stringify(`${build} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`) },
  build: { target: 'es2022' },
})
