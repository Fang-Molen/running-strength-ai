import { chromium } from 'playwright'
// v89.10.8 线上核对：临时浏览器，合成佳明形状日内数据，不写入产品或账号
const U = 'https://molen-fangkun.pages.dev/', O = '/workspace/out/screenshots/v89.10.8/'
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
const mr = p.getByRole('button', { name: /肌肉恢复/ }).first()
if (await mr.count()) { await mr.click().catch(() => {}); await p.waitForTimeout(2000); await p.getByRole('dialog').getByRole('button', { name: '跑步影响', exact: true }).click().catch(e => out.errors.push('run ' + e.message.slice(0, 50))); await p.waitForTimeout(800); await p.screenshot({ path: O + '3-跑步影响.png' }); out.runTab = (await p.getByRole('dialog').innerText()).slice(0, 200); await p.keyboard.press('Escape'); await p.waitForTimeout(500) }
await nav('方坤'); await p.waitForTimeout(1500); await p.screenshot({ path: O + '4-方坤.png' })
const qs = ['今天练了 400m×6，目标配速 75 秒，组间休息 90 秒，实际 74、75、76、77、78、80 秒，最后两组很吃力，RPE 8，腿不痛。下次怎么调？', '明天要不要休息？']
out.answers = []
for (const [i, q] of qs.entries()) {
  const box = p.getByPlaceholder('输入你的问题'); await box.fill(q); await box.press('Enter'); await p.waitForTimeout(500)
  const send = p.getByRole('button', { name: /发送/ }); if (await send.count() && await box.inputValue()) await send.first().click().catch(() => {})
  await p.waitForTimeout(25000)
  out.answers.push((await p.locator('body').innerText().catch(() => '')).slice(-900))
  await p.screenshot({ path: O + `5-问答${i + 1}.png`, fullPage: false })
}
out.overflow = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)
console.log(JSON.stringify(out, null, 1)); await b.close()
