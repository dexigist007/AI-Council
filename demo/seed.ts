/**
 * Demo only: builds a database with example content for screenshots and the browser preview.
 * Usage: npx vite-node demo/seed.ts -- <out.db> <en|tr>
 * Everything here is illustrative example data, not real sessions.
 */
import { existsSync, rmSync } from 'node:fs'
import { decisionsRepo } from '@/db/repositories/decisions'
import { findingsRepo } from '@/db/repositories/findings'
import { ideasRepo } from '@/db/repositories/ideas'
import { projectsRepo } from '@/db/repositories/projects'
import { providerConfigsRepo } from '@/db/repositories/providerConfigs'
import { sessionsRepo } from '@/db/repositories/sessions'
import { settingsRepo } from '@/db/repositories/settings'
import type { CouncilConfig, CouncilReport } from '@/domain/council/engine'
import type { Claim, MissingPoint, Review } from '@/domain/council/state'
import type { DiscoveryReport } from '@/domain/discovery/report'
import type { IdeaReport } from '@/domain/ideas/report'
import { openDemoDb } from './fileDb'

const [out, lang = 'en'] = process.argv.slice(2).filter((a) => a !== '--')
if (!out) throw new Error('usage: seed.ts <out.db> <en|tr>')
const tr = lang === 'tr'
const L = (en: string, trText: string) => (tr ? trText : en)

if (existsSync(out)) rmSync(out)
const { db, sqlite } = openDemoDb(out, true)
const r = {
  ideas: ideasRepo(db), sessions: sessionsRepo(db), decisions: decisionsRepo(db), projects: projectsRepo(db),
  findings: findingsRepo(db), providers: providerConfigsRepo(db), settings: settingsRepo(db),
}

await r.settings.set('locale', lang)
for (const [provider, model] of [['gemini', 'gemini-3.5-flash'], ['groq', 'llama-3.3-70b-versatile'], ['openrouter', 'deepseek/deepseek-chat-v3:free'], ['cerebras', 'qwen-3-235b']] as const) {
  await r.providers.save({ provider, enabled: true, defaultModel: model, temperature: null, maxTokens: null })
}

const council = (roles: string[]): CouncilConfig => ({
  mode: 'balanced',
  participants: [
    { id: 'p1', provider: 'gemini', model: 'gemini-3.5-flash', roleId: roles[0]! },
    { id: 'p2', provider: 'groq', model: 'llama-3.3-70b-versatile', roleId: roles[1]! },
    { id: 'p3', provider: 'openrouter', model: 'deepseek/deepseek-chat-v3:free', roleId: roles[2]! },
  ],
  judge: { id: 'judge', provider: 'cerebras', model: 'qwen-3-235b', roleId: 'judge' },
  budgetUsd: 1,
})

const claim = (id: string, participantId: string, roleLabel: string, type: Claim['type'], confidence: Claim['confidence'], text: string): Claim =>
  ({ id, participantId, roleLabel, type, confidence, text })
const review = (claimId: string, participantId: string, roleLabel: string, stance: Review['stance'], reason: string): Review =>
  ({ claimId, participantId, roleLabel, stance, reason })

async function addSession(type: 'new_idea', config: CouncilConfig & { meta?: Record<string, unknown> }, report: unknown, opts: { ideaId?: string; cost?: number; daysAgo: number }) {
  const s = await r.sessions.create({ type, mode: config.mode, ideaId: opts.ideaId ?? null, config: { ...config, outputLanguage: tr ? 'Turkish' : 'English' }, estCost: 0 })
  await r.sessions.markRunning(s.id)
  await r.sessions.complete(s.id, report)
  const at = new Date(Date.now() - opts.daysAgo * 86_400_000).toISOString()
  sqlite.prepare('UPDATE sessions SET created_at = ?, finished_at = ?, actual_cost = ? WHERE id = ?').run(at, at, opts.cost ?? 0, s.id)
  return s.id
}

// ── Discovery ────────────────────────────────────────────────────────────────────────────────
const OH = 'Opportunity Hunter', IH = 'Indie Hacker', DA = "Devil's Advocate"
const dClaims: Claim[] = [
  claim('C1', 'p1', OH, 'opportunity', 'medium', L(
    'Menu setup service for independent cafés: QR menu, photos and monthly updates | Pays: café owners, ~$40 setup + $10/month | First revenue: 5 cafés you already know, in person | Time: 2–3 weeks | Cost: $20 domain',
    'Bağımsız kafelere menü kurulum hizmeti: QR menü, fotoğraf, aylık güncelleme | Öder: kafe sahibi, ~₺1.500 kurulum + ₺300/ay | İlk gelir: tanıdığın 5 kafe, yüz yüze | Süre: 2–3 hafta | Maliyet: ₺700 alan adı')),
  claim('C2', 'p1', OH, 'risk', 'high', L(
    'Free QR menu tools are everywhere; what sells is the setup and upkeep, not the software.',
    'Ücretsiz QR menü araçları çok; satılan şey yazılım değil, kurulum ve bakım hizmeti olmalı.')),
  claim('C3', 'p2', IH, 'opportunity', 'medium', L(
    'Paid Android starter kit (auth, billing, offline sync) on Gumroad: $49 | First revenue: post a build log in two Android communities | Time: 3–4 weeks | Cost: hours only',
    'Gumroad’da ücretli Android başlangıç kiti (giriş, ödeme, çevrimdışı senkron): $49 | İlk gelir: iki Android topluluğunda geliştirme günlüğü | Süre: 3–4 hafta | Maliyet: yalnızca zaman')),
  claim('C4', 'p2', IH, 'recommendation', 'high', L(
    'Pre-sell before building: a landing page and 3 paid pre-orders within 7 days, or stop.',
    'Yapmadan önce sat: 7 gün içinde bir tanıtım sayfası ve 3 ücretli ön sipariş yoksa bırak.')),
  claim('C5', 'p3', DA, 'weakness', 'high', L(
    'A mobile game cannot realistically earn within a month: store review plus discovery alone takes longer.',
    'Bir mobil oyun bir ayda gerçekçi olarak para kazanamaz: mağaza onayı ve keşfedilme tek başına daha uzun sürer.')),
  claim('C6', 'p3', DA, 'assumption', 'medium', L(
    'The café idea assumes owners will pay monthly; many will want a one-off price.',
    'Kafe fikri, sahiplerin aylık ödeyeceğini varsayıyor; çoğu tek seferlik fiyat isteyebilir.')),
]
const dReviews: Review[] = [
  review('C1', 'p2', IH, 'agree', L('You already have the distribution channel; this is the shortest path to a first payment.', 'Dağıtım kanalın zaten var; ilk ödemeye giden en kısa yol bu.')),
  review('C2', 'p2', IH, 'wrong_assumption', L('Owners do not have time to set up free tools; the service itself is the difference.', 'Kafe sahiplerinin ücretsiz aracı kurmaya vakti yok; farkı hizmetin kendisi yaratıyor.')),
  review('C3', 'p3', DA, 'disagree', L('Starter kits are a crowded niche and sales depend on an audience you have not built yet.', 'Başlangıç kitleri kalabalık bir niş ve satış, henüz olmayan bir kitleye bağlı.')),
  review('C5', 'p1', OH, 'agree', L('Agreed; games should be dropped for this timeline.', 'Katılıyorum; bu süre için oyun elenmeli.')),
  review('C6', 'p1', OH, 'agree', L('Offer both: one-off setup, optional monthly upkeep.', 'İkisini de sun: tek seferlik kurulum, isteğe bağlı aylık bakım.')),
]
const dMissing: MissingPoint[] = [
  { participantId: 'p3', roleLabel: DA, type: 'risk', confidence: 'medium', text: L('Invoicing and tax registration add cost and time before the first payment.', 'Fatura ve vergi kaydı ilk ödemeden önce maliyet ve zaman ekler.') },
]
const sc = (amount: string, assumption: string) => ({ amount, assumption })
const discovery: DiscoveryReport = {
  summary: L(
    'The best bet is a menu setup service for cafés you can reach in person: you sell setup and upkeep, not software, and the first payment can come within three weeks. The Android starter kit is a slower second option that depends on building an audience. Start tomorrow by offering a pre-paid setup to five cafés you know.',
    'En iyi bahis, yüz yüze ulaşabildiğin kafelere menü kurulum hizmeti: yazılım değil kurulum ve bakım satıyorsun, ilk ödeme üç hafta içinde gelebilir. Android başlangıç kiti, kitle kurmaya bağlı daha yavaş ikinci seçenek. Yarın tanıdığın beş kafeye ön ödemeli kurulum teklif ederek başla.'),
  reality_check: [
    L('Earning from a game within one month is close to impossible; store review and discovery alone take longer.', 'Bir ay içinde oyundan gelir neredeyse imkânsız; mağaza onayı ve keşfedilme tek başına daha uzun sürer.'),
    L('This report used no live market data; check prices with real cafés before you commit.', 'Bu rapor güncel pazar verisi kullanmadı; fiyatları bağlanmadan önce gerçek kafelerle doğrula.'),
  ],
  candidates: [
    {
      rank: 1, name: L('Café menu setup service', 'Kafe menü kurulum hizmeti'), kind: 'service',
      one_liner: L('QR menus, photos and monthly updates for independent cafés.', 'Bağımsız kafelere QR menü, fotoğraf ve aylık güncelleme.'),
      why_this_fits_you: L('You know several café owners and can build the menu template in a weekend with your web skills.', 'Birkaç kafe sahibini tanıyorsun ve web becerinle menü şablonunu bir hafta sonunda yapabilirsin.'),
      target_customer: L('Independent cafés with 10–40 seats in your district', 'Semtindeki 10–40 kişilik bağımsız kafeler'),
      problem: L('Printed menus are costly to update and go out of date with every price change.', 'Basılı menüyü güncellemek pahalı ve her fiyat değişiminde eskiyor.'),
      solution: L('A ready template, set up and photographed by you, updated on request.', 'Senin kurduğun ve fotoğrafladığın, istek üzerine güncellenen hazır şablon.'),
      revenue_model: L('Setup fee plus optional monthly upkeep', 'Kurulum ücreti ve isteğe bağlı aylık bakım'),
      pricing: L('$40 setup + $10/month', '₺1.500 kurulum + ₺300/ay'),
      first_revenue_path: L('Visit five cafés you know with a one-page offer and a live demo on your phone; ask for the setup fee up front.', 'Tanıdığın beş kafeye tek sayfalık teklif ve telefonda canlı demoyla git; kurulum ücretini peşin iste.'),
      time_to_first_revenue: L('2–3 weeks', '2–3 hafta'), startup_cost: L('$20 domain', '₺700 alan adı'), weekly_hours: L('10–15 hours', '10–15 saat'),
      revenue_scenarios: {
        pessimistic: sc(L('$0–40', '₺0–1.500'), L('1 café out of 20 visits', '20 ziyarette 1 kafe')),
        realistic: sc(L('$80–150', '₺3.000–6.000'), L('5–8 cafés on monthly upkeep', '5–8 kafe aylık bakımda')),
        optimistic: sc(L('$300+', '₺12.000+'), L('20+ cafés through referrals', 'Tavsiyeyle 20+ kafe')),
      },
      unit_economics: L('$10/month per café, hosting about $1; about $9 left per café.', 'Kafe başına aylık ₺300, barındırma ~₺20; kafe başına ~₺280 kalır.'),
      competition: L('Free QR tools and the menu modules of point-of-sale vendors.', 'Ücretsiz QR araçları ve POS firmalarının menü modülleri.'),
      differentiation: L('You do the setup, photos and updates; the owner does nothing.', 'Kurulumu, fotoğrafı ve güncellemeyi sen yapıyorsun; kafe sahibi hiçbir şey yapmıyor.'),
      distribution_channels: [L('In-person visits', 'Yüz yüze ziyaret'), L('Local business WhatsApp groups', 'Yerel esnaf WhatsApp grupları')],
      key_assumptions: [L('Owners will pay up front for setup', 'Kafe sahipleri kurulum için peşin öder')],
      main_risks: [L('Point-of-sale vendors bundling menus for free', 'POS firmalarının menüyü ücretsiz vermesi')],
      validation_plan: [
        { day: L('Days 1–2', '1–2. gün'), action: L('Offer a one-page proposal to 20 cafés', '20 kafeye tek sayfalık teklif götür'), success_signal: L('3 or more demo meetings', 'En az 3 demo randevusu') },
        { day: L('Days 3–5', '3–5. gün'), action: L('Show the demo and ask for a pre-payment', 'Demoyu göster, ön ödeme iste'), success_signal: L('2 or more pre-payments', 'En az 2 ön ödeme') },
        { day: L('Days 6–7', '6–7. gün'), action: L('Deliver the first menu by hand', 'İlk menüyü elle teslim et'), success_signal: L('1 referral to another café', 'Başka bir kafeye 1 tavsiye') },
      ],
      kill_criteria: [L('No pre-payment after 20 visits', '20 ziyarette 0 ön ödeme')],
      first_30_days: [L('Finish the template', 'Şablonu bitir'), L('Set up the first five cafés', 'İlk beş kafeyi kur'), L('Add a referral discount', 'Tavsiye indirimi ekle')],
      confidence: 'medium', supporting_claims: ['C1', 'C2', 'C6'],
    },
    {
      rank: 2, name: L('Android starter kit', 'Android başlangıç kiti'), kind: 'app',
      one_liner: L('A paid template with login, billing and offline sync for Android developers.', 'Android geliştiricileri için giriş, ödeme ve çevrimdışı senkron içeren ücretli şablon.'),
      why_this_fits_you: L('It packages code you have already written many times.', 'Defalarca yazdığın kodu paketliyor.'),
      target_customer: L('Solo Android developers starting a paid app', 'Ücretli uygulama başlatan tek kişilik Android geliştiricileri'),
      problem: L('Every new app repeats weeks of setup work.', 'Her yeni uygulama haftalarca aynı kurulum işini tekrarlıyor.'),
      solution: L('A documented, tested starter project.', 'Belgelenmiş, test edilmiş bir başlangıç projesi.'),
      revenue_model: L('One-off sale', 'Tek seferlik satış'), pricing: '$49',
      first_revenue_path: L('Share a build log in two Android communities and open pre-orders at $29.', 'İki Android topluluğunda geliştirme günlüğü paylaş ve $29’dan ön sipariş aç.'),
      time_to_first_revenue: L('3–4 weeks', '3–4 hafta'), startup_cost: L('Time only', 'Yalnızca zaman'), weekly_hours: L('10 hours', '10 saat'),
      revenue_scenarios: {
        pessimistic: sc('$0', L('No audience yet', 'Henüz kitle yok')),
        realistic: sc('$50–250', L('1–5 sales a month', 'Ayda 1–5 satış')),
        optimistic: sc('$750', L('Featured in a newsletter', 'Bir bültende yer alırsa')),
      },
      unit_economics: L('Platform fee about 10%; no running costs.', 'Platform payı ~%10; işletme maliyeti yok.'),
      competition: L('Free open-source templates and paid kits.', 'Ücretsiz açık kaynak şablonlar ve ücretli kitler.'),
      differentiation: L('Billing and offline sync already solved.', 'Ödeme ve çevrimdışı senkron hazır.'),
      distribution_channels: [L('Android communities', 'Android toplulukları')], key_assumptions: [L('Developers pay for time saved', 'Geliştiriciler kazandıkları zaman için öder')],
      main_risks: [L('Crowded niche', 'Kalabalık niş')],
      validation_plan: [{ day: L('Days 1–7', '1–7. gün'), action: L('Landing page with $29 pre-orders', '$29 ön siparişli tanıtım sayfası'), success_signal: L('5 pre-orders', '5 ön sipariş') }],
      kill_criteria: [L('Under 5 pre-orders in two weeks', 'İki haftada 5’ten az ön sipariş')],
      first_30_days: [L('Ship version 1', 'Sürüm 1’i yayınla')], confidence: 'low', supporting_claims: ['C3', 'C4'],
    },
  ],
  rejected: [{ name: L('Casual mobile game', 'Basit mobil oyun'), reason: L('Not realistic within a month (C5).', 'Bir ay içinde gerçekçi değil (C5).') }],
  disagreements: [{ topic: L('Free competitors', 'Ücretsiz rakipler'), positions: [L('Opportunity Hunter: a serious risk', 'Opportunity Hunter: ciddi risk'), L('Indie Hacker: the service is the difference', 'Indie Hacker: farkı hizmet yaratır')] }],
  open_questions: [L('How many café owners do you know personally?', 'Kaç kafe sahibini kişisel olarak tanıyorsun?')],
}
const dConfig = council(['opportunity-hunter', 'indie-hacker', 'devils-advocate'])
const discoveryReport: CouncilReport<DiscoveryReport> = {
  judge: discovery, claims: dClaims, reviews: dReviews, missing: dMissing, failed: [],
  positions: [
    { participantId: 'p1', roleLabel: OH, summary: L('Your café network is the strongest asset; services to small businesses bring the fastest cash.', 'Kafe çevren en güçlü varlığın; küçük işletmelere hizmet en hızlı nakdi getirir.') },
    { participantId: 'p2', roleLabel: IH, summary: L('Sell before you build; if nobody pays in seven days, stop.', 'Yapmadan önce sat; yedi günde kimse ödemezse bırak.') },
    { participantId: 'p3', roleLabel: DA, summary: L('A game does not fit a one-month goal; the café idea depends on monthly payments.', 'Bir aylık hedefe oyun uymaz; kafe fikri aylık ödemeye bağlı.') },
  ],
}
const profile = { skills: L('8 years of Android, Vue; knows several café owners', '8 yıl Android, Vue; birkaç kafe sahibini tanıyor'), budget: '$300', weeklyHours: '15', timeToRevenue: '1m', market: L('Turkey, TR/EN', 'Türkiye, TR/EN'), exclusions: L('crypto, physical stock', 'kripto, fiziksel stok') }
const discoveryId = await addSession('new_idea', { ...dConfig, meta: { purpose: 'discovery', question: L('Find me a business model, app or game I can turn into money quickly.', 'Bana kısa sürede paraya çevirebileceğim bir iş modeli, uygulama veya oyun bulun.'), profile, kinds: [] } }, discoveryReport, { daysAgo: 0, cost: 0 })

// ── Ideas ────────────────────────────────────────────────────────────────────────────────────
const menuIdea = await r.ideas.create({
  title: L('Café menu setup service', 'Kafe menü kurulum hizmeti'),
  body: L('QR menus, photos and monthly updates for independent cafés. Setup fee plus optional upkeep.', 'Bağımsız kafelere QR menü, fotoğraf ve aylık güncelleme. Kurulum ücreti ve isteğe bağlı bakım.'),
})
const PS = 'Product Strategist', CA = 'Critical Analyst', MA = 'Market / Opportunity Analyst'
const iClaims: Claim[] = [
  claim('C1', 'p1', PS, 'strength', 'high', L('The owner has direct access to the first customers, so validation costs almost nothing.', 'Sahibinin ilk müşterilere doğrudan erişimi var; doğrulama neredeyse bedava.')),
  claim('C2', 'p1', PS, 'recommendation', 'medium', L('Sell the setup as a one-off service first; add monthly upkeep only after five cafés.', 'Önce kurulumu tek seferlik hizmet olarak sat; aylık bakımı beş kafeden sonra ekle.')),
  claim('C3', 'p2', CA, 'risk', 'high', L('Point-of-sale vendors can bundle digital menus for free and remove the reason to pay.', 'POS firmaları dijital menüyü ücretsiz verirse ödeme sebebi ortadan kalkar.')),
  claim('C4', 'p2', CA, 'assumption', 'medium', L('Assumes cafés change prices often enough to value updates.', 'Kafelerin güncellemeye değer verecek kadar sık fiyat değiştirdiğini varsayıyor.')),
  claim('C5', 'p3', MA, 'opportunity', 'medium', L('Bakeries and small restaurants share the same problem and widen the market.', 'Fırınlar ve küçük restoranlar aynı sorunu yaşıyor; pazar genişliyor.')),
  claim('C6', 'p3', MA, 'weakness', 'medium', L('Revenue grows only as fast as the owner can visit shops.', 'Gelir, sahibin dükkân ziyaret hızı kadar büyüyebilir.')),
]
const iReviews: Review[] = [
  review('C1', 'p2', CA, 'agree', L('Strong point; it makes the first test nearly free.', 'Güçlü nokta; ilk testi neredeyse bedava yapıyor.')),
  review('C3', 'p1', PS, 'disagree', L('Vendors give the software, not the setup and photos; the service still sells.', 'POS firmaları yazılımı verir, kurulum ve fotoğrafı değil; hizmet yine satar.')),
  review('C4', 'p3', MA, 'wrong_assumption', L('Prices changed several times this year; updates are frequent.', 'Fiyatlar bu yıl birkaç kez değişti; güncelleme sık.')),
  review('C6', 'p1', PS, 'agree', L('True; it is a service business and scales with time.', 'Doğru; bu bir hizmet işi ve zamanla ölçeklenir.')),
]
const ideaReport: CouncilReport<IdeaReport> = {
  judge: {
    decision: 'VALIDATE',
    decision_reason: L(
      'The demand is plausible and the first customers are within reach, but monthly payments and competition from free tools are unproven. Test with pre-paid setups before building more than the template.',
      'Talep makul ve ilk müşteriler ulaşılabilir, ama aylık ödeme ve ücretsiz araçlarla rekabet kanıtlanmadı. Şablondan fazlasını yapmadan önce ön ödemeli kurulumla test et.'),
    survives_kill_test: null,
    rubric: [
      { dimension: 'problem_clarity', level: 'high', reason: L('Outdated printed menus are a concrete, visible problem.', 'Eskiyen basılı menü somut ve görünür bir sorun.') },
      { dimension: 'demand_evidence', level: 'low', reason: L('No café has paid yet.', 'Henüz hiçbir kafe ödeme yapmadı.') },
      { dimension: 'feasibility', level: 'high', reason: L('A template and hosting are enough.', 'Bir şablon ve barındırma yeterli.') },
      { dimension: 'effort', level: 'low', reason: L('A weekend for the template; visits take the time.', 'Şablon için bir hafta sonu; asıl zaman ziyaretlerde.') },
      { dimension: 'risk', level: 'medium', reason: L('Free bundles from point-of-sale vendors.', 'POS firmalarının ücretsiz paketleri.') },
    ],
    strengths: [L('Direct access to the first customers', 'İlk müşterilere doğrudan erişim'), L('Almost no upfront cost', 'Neredeyse sıfır başlangıç maliyeti')],
    weaknesses: [L('Growth limited by time for visits', 'Büyüme ziyaret zamanıyla sınırlı')],
    critical_assumptions: [{ assumption: L('Cafés pay up front for setup', 'Kafeler kurulum için peşin öder'), how_to_validate: L('Ask 20 cafés for a pre-payment within a week', 'Bir hafta içinde 20 kafeden ön ödeme iste') }],
    main_risks: [L('Point-of-sale vendors giving menus away', 'POS firmalarının menüyü bedava vermesi')],
    suggested_mvp: { include: [L('One menu template', 'Tek menü şablonu'), L('Setup by hand', 'Elle kurulum')], exclude: [L('Ordering and payments', 'Sipariş ve ödeme'), L('A self-service editor', 'Self-servis düzenleyici')] },
    do_not_build_yet: [L('An admin panel for owners', 'Kafe sahipleri için yönetim paneli')],
    next_steps: [L('Write a one-page offer', 'Tek sayfalık teklif yaz'), L('Visit 20 cafés this week', 'Bu hafta 20 kafeyi ziyaret et'), L('Decide on monthly upkeep after five setups', 'Beş kurulumdan sonra aylık bakıma karar ver')],
    disagreements: [{ topic: L('Free competition', 'Ücretsiz rekabet'), positions: [L('Critical Analyst: removes the reason to pay', 'Critical Analyst: ödeme sebebini ortadan kaldırır'), L('Product Strategist: the service still sells', 'Product Strategist: hizmet yine satar')] }],
    revisit_condition: null,
  },
  claims: iClaims, reviews: iReviews, missing: [], failed: [],
  positions: [
    { participantId: 'p1', roleLabel: PS, summary: L('Worth testing now: the first customers are a short walk away.', 'Şimdi test etmeye değer: ilk müşteriler birkaç adım ötede.') },
    { participantId: 'p2', roleLabel: CA, summary: L('Free bundles are the main threat; prove that cafés pay.', 'Ücretsiz paketler ana tehdit; kafelerin ödediğini kanıtla.') },
    { participantId: 'p3', roleLabel: MA, summary: L('A wider market exists in bakeries and small restaurants.', 'Fırın ve küçük restoranlarda daha geniş bir pazar var.') },
  ],
}
const ideaSessionId = await addSession('new_idea', { ...council(['product-strategist', 'critical-analyst', 'market-analyst']), meta: { ideaMode: 'evaluate' } }, ideaReport, { ideaId: menuIdea.id, daysAgo: 1 })
await r.ideas.markEvaluating(menuIdea.id)

const recipe = await r.ideas.create({ title: L('Offline recipe planner', 'Çevrimdışı tarif planlayıcı'), body: L('Weekly meal plans and a shopping list that work without internet.', 'İnternetsiz çalışan haftalık yemek planı ve alışveriş listesi.') })
await r.ideas.setVerdict(recipe.id, { status: 'build', sessionId: null })
await r.decisions.create({ title: L('Build: Offline recipe planner', 'BUILD: Çevrimdışı tarif planlayıcı'), reason: L('Validated with 40 sign-ups from a single post.', 'Tek bir gönderiden 40 kayıtla doğrulandı.'), ideaId: recipe.id, userApproved: true })
const nft = await r.ideas.create({ title: L('NFT loyalty cards', 'NFT sadakat kartları'), body: L('Loyalty stamps as tokens.', 'Sadakat damgaları token olarak.') })
await r.ideas.setVerdict(nft.id, { status: 'rejected', sessionId: null, rejectReason: L('Cafés do not want crypto; a paper card already works.', 'Kafeler kripto istemiyor; kâğıt kart zaten çalışıyor.') })
await r.decisions.create({ title: L('Reject: NFT loyalty cards', 'REJECT: NFT sadakat kartları'), reason: L('Cafés do not want crypto.', 'Kafeler kripto istemiyor.'), ideaId: nft.id, userApproved: true })
await r.ideas.create({ title: L('Habit tracker for teams', 'Ekipler için alışkanlık takibi'), body: '' })

// ── Project with findings ────────────────────────────────────────────────────────────────────
const project = await r.projects.create({ name: 'pocket-recipes', rootPath: '/Users/demo/code/pocket-recipes' })
await r.projects.setIndexed(project.id, { files: 312, indexedFiles: 268, chunks: 1140, skipped: { sensitive: 3, lockfile: 2, binary: 31, too_large: 8 }, languages: { Kotlin: 182, XML: 61, Gradle: 9, Markdown: 16 }, truncated: false, durationMs: 1840 })
const ev = (file: string, start: number, quote: string) => [{ file, start_line: start, end_line: start + 2, quote, verified: true }]
await r.findings.upsertMany(project.id, null, [
  { title: L('API key committed in source', 'Kaynakta commit edilmiş API anahtarı'), description: L('A live maps key is hard-coded and ships in every build.', 'Canlı bir harita anahtarı koda gömülü ve her derlemeyle dağıtılıyor.'), category: 'secrets', severity: 'high', confidence: 'confirmed', evidence: ev('app/src/main/java/net/pocket/MapConfig.kt', 12, 'const val MAPS_KEY = "********"'), impact: 5, risk: 5, urgency: 5, effort: 1, suggestedFix: L('Move the key to local.properties and rotate it.', 'Anahtarı local.properties’e taşı ve yenile.') },
  { title: L('Sync runs on the main thread', 'Senkron ana iş parçacığında çalışıyor'), description: L('RecipeSync.pull() does network I/O on the UI thread and can freeze the app.', 'RecipeSync.pull() ağ işini arayüz iş parçacığında yapıyor ve uygulamayı dondurabilir.'), category: 'performance', severity: 'medium', confidence: 'high', evidence: ev('app/src/main/java/net/pocket/sync/RecipeSync.kt', 41, 'val body = client.newCall(req).execute()'), impact: 4, risk: 3, urgency: 3, effort: 2, suggestedFix: L('Move the call into a coroutine on Dispatchers.IO.', 'Çağrıyı Dispatchers.IO üzerinde bir coroutine’e taşı.') },
  { title: L('No tests for the shopping list', 'Alışveriş listesi için test yok'), description: L('Merging duplicate ingredients has no tests and broke twice.', 'Tekrarlayan malzemeleri birleştirme kodunun testi yok ve iki kez bozuldu.'), category: 'testing', severity: 'medium', confidence: 'confirmed', evidence: ev('app/src/main/java/net/pocket/list/ListMerger.kt', 8, 'fun merge(items: List<Item>): List<Item>'), impact: 3, risk: 3, urgency: 2, effort: 2, suggestedFix: L('Add unit tests for units and duplicates.', 'Birimler ve tekrarlar için birim testi ekle.') },
  { title: L('Large activity file', 'Çok büyük activity dosyası'), description: L('PlannerActivity.kt has 1,240 lines mixing UI and data code.', 'PlannerActivity.kt 1.240 satır; arayüz ve veri kodu karışık.'), category: 'maintainability', severity: 'low', confidence: 'confirmed', evidence: ev('app/src/main/java/net/pocket/PlannerActivity.kt', 1, 'class PlannerActivity : AppCompatActivity() {'), impact: 2, risk: 2, urgency: 1, effort: 3, suggestedFix: L('Split the week view into a fragment and a view model.', 'Hafta görünümünü bir fragment ve view model’e ayır.') },
])

sqlite.close()
console.log(`seeded ${out} (${lang}); discovery ${discoveryId}, idea session ${ideaSessionId}, idea ${menuIdea.id}, project ${project.id}`)
