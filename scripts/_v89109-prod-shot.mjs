import { chromium } from 'playwright'
// v89.10.9 线上核对：临时浏览器，合成佳明形状日内数据，不写入产品或账号；不发起任何真实授权
const U = 'https://molen-fangkun.pages.dev/', O = '/workspace/out/screenshots/v89.10.9/'
const days = {}
for (let i = 1; i <= 10; i++) {
  const day = new Date(Date.UTC(2026, 9, 22 - i)).toISOString().slice(0, 10), base = Date.parse(day + 'T00:00:00+08:00'), bb = [], hr = [], st = []
  for (let m = 0; m < 1440; m += 15) { const h = m / 60, t = base + m * 60e3; bb.push([t, Math.round(h < 8 ? 20 + h * 9 : Math.max(10, 92 - (h - 8) * 4.5))]); hr.push([t, Math.round((h < 8 ? 52 : 70) + 8 * Math.sin(h + i))]); st.push([t, Math.round(h < 8 ? 12 : 35)]) }
  days[day] = { schemaVersion: 1, day, source: 'garmin', fetchedAt: new Date(base + 23.9 * 3600e3).toISOString(), offsetMin: 480, hr, bb, st, restingHr: 51, sleep: [base - 1.5 * 3600e3, base + 7.5 * 3600e3], training: [] }
}
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const out = { errors: [], console: [], api: [] }
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, timezoneId: 'Asia/Shanghai' })
await ctx.addInitScript(d => { if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1'); localStorage.setItem('fk-onboard-v1', '1'); localStorage.setItem('fk-welcome-standalone-v1', '1'); localStorage.setItem('fk-garmin-intraday-v1:local', JSON.stringify({ schemaVersion: 1, days: d })) }, days)
const p = await ctx.newPage(); p.on('pageerror', e => out.errors.push(String(e))); p.on('console', m => { if (m.type() === 'error') out.console.push(m.text().slice(0, 160)) })
p.on('response', r => { if (r.url().includes('/api/')) out.api.push(r.status() + ' ' + new URL(r.url()).pathname) })
await p.goto(U, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500)
for (const n of ['跳过，用默认', '逐个调整', '暂不需要', '打开方坤']) { const x = p.getByRole('button', { name: n, exact: true }); if (await x.count()) await x.first().click().catch(() => {}) }
out.sw = await p.evaluate(async () => (await (await fetch('/sw.js')).text()).split('\n')[0])
await p.screenshot({ path: O + '1-首页.png' })
const nav = n => p.locator('nav').last().getByRole('button', { name: n }).or(p.locator('nav').last().getByRole('link', { name: n })).first().click()
await nav('健康'); await p.waitForTimeout(1500); await p.screenshot({ path: O + '2-健康.png' })
out.bbChart = await p.getByTestId('h89-chart-bb').count()
// 设备与数据同步窗口
await p.getByRole('button', { name: '个人与数据' }).first().click().catch(e => out.errors.push('gear ' + e.message.slice(0, 60))); await p.waitForTimeout(1000)
await p.getByTestId('menu-sync').click().catch(e => out.errors.push('menu-sync ' + e.message.slice(0, 60))); await p.waitForTimeout(1500)
out.syncCenter = await p.getByTestId('device-sync-center').count()
out.platforms = {}
for (const [i, id] of ['garmin', 'coros', 'polar', 'suunto', 'huawei', 'apple_health', 'health_connect', 'strava'].entries()) {
  await p.getByTestId('sync-platform').selectOption(id).catch(e => out.errors.push('sel ' + id + e.message.slice(0, 40))); await p.waitForTimeout(1500)
  out.platforms[id] = (await p.getByTestId('device-sync-center').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 260)
  if (['garmin', 'coros', 'polar', 'huawei', 'apple_health', 'strava'].includes(id)) await p.screenshot({ path: O + `3-同步-${i + 1}-${id}.png` })
}
await p.keyboard.press('Escape'); await p.goto(U, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500)
await nav('方坤'); await p.waitForTimeout(1500)
const box = p.getByPlaceholder('输入你的问题'); await box.fill('明天要不要休息？'); await box.press('Enter'); await p.waitForTimeout(500)
const send = p.getByRole('button', { name: /发送/ }); if (await send.count() && await box.inputValue()) await send.first().click().catch(() => {})
await p.waitForTimeout(25000)
out.answer = (await p.locator('body').innerText().catch(() => '')).slice(-700)
await p.screenshot({ path: O + '4-问答.png' })
out.overflow = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)
console.log(JSON.stringify(out, null, 1)); await b.close()
