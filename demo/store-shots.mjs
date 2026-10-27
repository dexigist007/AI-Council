// Produces the App Store screenshots from a running demo server (see demo/README.md).
// Needs the 'playwright' package; Chromium path is the one preinstalled in Claude's cloud environment.
// usage: node store-shots.mjs <outDir> <dbPath> <baseUrl> <lang>
import { chromium } from 'playwright'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
const BetterSqlite = createRequire('/home/user/AI-Council/package.json')('better-sqlite3')
const [out, dbPath, base, lang] = process.argv.slice(2)
mkdirSync(out, { recursive: true })
const db = new BetterSqlite(dbPath, { readonly: true })
const one = (sql) => db.prepare(sql).get()
const discovery = one("SELECT id FROM sessions WHERE config_json LIKE '%\"purpose\":\"discovery\"%'").id
const idea = one('SELECT idea_id AS id FROM sessions WHERE idea_id IS NOT NULL').id
const project = one('SELECT id FROM projects').id
const expandDebate = async (p) => {
  await p.locator('.debate-box .q-expansion-item__container > .q-item').first().click()
  await p.waitForTimeout(700)
  await p.evaluate(() => { const el = document.querySelector('.debate-box'); window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 30) })
}
const shots = [
  ['01-discovery', 'light', `#/council/${discovery}`],
  ['02-debate', 'light', `#/council/${discovery}`, expandDebate],
  ['03-decision', 'light', `#/ideas/${idea}`],
  ['04-discover', 'light', '#/discovery'],
  ['05-findings', 'light', `#/projects/${project}`, async (p) => { await p.locator('.q-tab').nth(4).click(); await p.waitForTimeout(500); await p.locator('.q-expansion-item').first().locator('.q-item').first().click(); await p.waitForTimeout(500) }],
  ['06-debate-dark', 'dark', `#/council/${discovery}`, expandDebate],
]
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const errors = []
for (const [name, scheme, hash, act] of shots) {
  const ctx = await b.newContext({
    viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: scheme, locale: lang === 'tr' ? 'tr-TR' : 'en-US',
    // The macOS layout (window buttons over the sidebar) is chosen from the user agent.
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 (KHTML, like Gecko)',
  })
  const p = await ctx.newPage()
  p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`))
  await p.goto(`${base}/${hash}`)
  await p.waitForLoadState('networkidle')
  await p.waitForTimeout(900)
  if (act) await act(p)
  // macOS window buttons, as the overlay title bar shows them in the real app.
  await p.addStyleTag({ content: `.mac-lights{position:fixed;top:18px;left:18px;display:flex;gap:8px;z-index:9999}.mac-lights i{width:12px;height:12px;border-radius:50%;display:block;box-shadow:inset 0 0 0 .5px rgba(0,0,0,.18)}` })
  await p.evaluate(() => { const d = document.createElement('div'); d.className = 'mac-lights'; for (const c of ['#ff5f57', '#febc2e', '#28c840']) { const i = document.createElement('i'); i.style.background = c; d.append(i) } document.body.append(d) })
  await p.waitForTimeout(200)
  await p.screenshot({ path: `${out}/${name}.png` })
  await ctx.close()
}
console.log('errors:', errors)
await b.close()
