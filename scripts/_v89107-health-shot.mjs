import { chromium } from 'playwright'
// 合成的佳明形状日内数据，只存在于临时浏览器，不写入产品
const U = 'https://molen-fangkun.pages.dev/', O = '/workspace/out/screenshots/v89.10.7/'
const days = {}
for (let i = 1; i <= 12; i++) {
  const day = new Date(Date.UTC(2026, 9, 22 - i)).toISOString().slice(0, 10), base = Date.parse(day + 'T00:00:00+08:00')
  const bb = [], hr = [], st = []
  for (let m = 0; m < 1440; m += 15) { const h = m / 60, t = base + m * 60e3
    bb.push([t, Math.round(h < 8 ? 20 + h * 9 : Math.max(10, 92 - (h - 8) * 4.5) + (i % 3))])
    hr.push([t, Math.round((h < 8 ? 52 : 70) + 8 * Math.sin(h + i) + (h > 18 && h < 19 ? 70 : 0))])
    st.push([t, Math.round(h < 8 ? 12 : 35 + 10 * Math.sin(h * 2 + i))]) }
  days[day] = { schemaVersion: 1, day, source: 'garmin', fetchedAt: new Date(base + 23.9 * 3600e3).toISOString(), offsetMin: 480, hr, bb, st, restingHr: 50 + (i % 4), sleep: [base - 1.5 * 3600e3, base + 7.5 * 3600e3], training: [{ start: base + 18 * 3600e3, end: base + 19 * 3600e3, label: '合成·跑步' }] }
}
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const out = { errors: [] }
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, timezoneId: 'Asia/Shanghai', colorScheme: 'dark' })
await ctx.addInitScript(d => { if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1'); localStorage.setItem('fk-onboard-v1', '1'); localStorage.setItem('fk-welcome-standalone-v1', '1'); localStorage.setItem('fk-garmin-intraday-v1:local', JSON.stringify({ schemaVersion: 1, days: d })) }, days)
const p = await ctx.newPage(); p.on('pageerror', e => out.errors.push(String(e)))
await p.goto(U, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500)
for (const n of ['跳过，用默认', '逐个调整', '暂不需要', '打开方坤']) { const x = p.getByRole('button', { name: n, exact: true }); if (await x.count()) await x.first().click().catch(() => {}) }
out.sw = await p.evaluate(async () => (await (await fetch('/sw.js')).text()).split('\n')[0])
await p.locator('nav').last().getByRole('button', { name: '健康' }).or(p.locator('nav').last().getByRole('link', { name: '健康' })).first().click(); await p.waitForTimeout(1500)
const tr = p.getByTestId('h89-trend')
out.dayLabel = await p.getByTestId('h89-trend-day').innerText().catch(() => null)
out.bbChart = await tr.getByTestId('h89-chart-bb').count(); out.norm = await tr.getByTestId('h89-estimate').count(); out.sleepBand = await tr.getByTestId('shade-sleep').count(); out.trainBand = await tr.getByTestId('shade-training').count()
await tr.scrollIntoViewIfNeeded(); await p.screenshot({ path: O + '1-身体电量-当天-默认最近有数据日.png' })
await tr.getByRole('button', { name: '心率', exact: true }).click(); await p.waitForTimeout(600)
out.hrChart = await tr.getByTestId('h89-chart-hr').count(); out.hrNorm = await tr.getByTestId('h89-estimate').count()
await p.screenshot({ path: O + '2-心率-当天.png' })
await tr.getByRole('button', { name: '后一天' }).click(); await p.waitForTimeout(600)
out.todayLabel = await p.getByTestId('h89-trend-day').innerText(); out.empty = await tr.getByTestId('intraday-empty').innerText().catch(() => null)
await p.screenshot({ path: O + '3-切到今天-无样本-可回看.png' })
await tr.getByRole('button', { name: /看最近有数据的/ }).click().catch(e => out.errors.push('back ' + e.message.slice(0, 60))); await p.waitForTimeout(600)
out.backLabel = await p.getByTestId('h89-trend-day').innerText().catch(() => null)
await tr.getByRole('button', { name: '前一天' }).click(); await p.waitForTimeout(600); out.prevLabel = await p.getByTestId('h89-trend-day').innerText().catch(() => null)
await tr.getByRole('button', { name: '压力', exact: true }).click(); await p.waitForTimeout(600); out.stChart = await tr.getByTestId('h89-chart-st').count()
await p.screenshot({ path: O + '4-压力-前一天.png' })
out.overflow = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)

out.periods = await tr.locator('.fk-h89-period button').allInnerTexts()
await tr.getByRole('button', { name: '7天', exact: true }).click(); await p.waitForTimeout(800)
await p.screenshot({ path: O + '5-压力-7天.png' })
await tr.getByRole('button', { name: '身体电量', exact: true }).click().catch(() => {}); await tr.getByRole('button', { name: '当天', exact: true }).click(); await p.waitForTimeout(600)
const rr = p.getByTestId('trend-range'); out.recoveryRanges = (await rr.count()) ? await rr.first().locator('button').allInnerTexts() : null
const lg = p.getByTestId('trend-norm-legend'); out.normLegend = (await lg.count()) ? await lg.first().innerText() : null
if (await rr.count()) { await rr.first().scrollIntoViewIfNeeded(); await p.screenshot({ path: O + '6-恢复趋势-7天-图例.png' }) }
const mr = p.getByRole('button', { name: /肌肉恢复/ }).first()
if (await mr.count()) { await mr.click().catch(() => {}); await p.waitForTimeout(2500); await p.screenshot({ path: O + '7-肌肉恢复.png', fullPage: true }) ; for (const [t, f] of [['跑步影响', '7b-跑步影响.png'], ['恢复趋势', '7c-恢复趋势.png']]) { await p.getByRole('dialog').getByRole('button', { name: t, exact: true }).click().catch(e => out.errors.push(t + ' ' + e.message.slice(0, 50))); await p.waitForTimeout(800); await p.screenshot({ path: O + f }) }
  const d = p.getByRole('dialog'); out.sheetRanges = await d.getByTestId('trend-range').first().locator('button').allInnerTexts().catch(() => null); out.sheetLegend = await d.getByTestId('trend-norm-legend').first().innerText().catch(() => null); out.sheetText = (await d.innerText().catch(() => '')).slice(0, 300) }
const ctx2 = await b.newContext({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 2, timezoneId: 'Asia/Shanghai', colorScheme: 'light' })
await ctx2.addInitScript(d => { if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1'); localStorage.setItem('fk-onboard-v1', '1'); localStorage.setItem('fk-welcome-standalone-v1', '1'); localStorage.setItem('fk-garmin-intraday-v1:local', JSON.stringify({ schemaVersion: 1, days: d })) }, days)
const q = await ctx2.newPage(); q.on('pageerror', e => out.errors.push('light ' + String(e)))
await q.goto(U, { waitUntil: 'networkidle' }); await q.waitForTimeout(1500)
for (const n of ['跳过，用默认', '逐个调整', '暂不需要', '打开方坤']) { const x = q.getByRole('button', { name: n, exact: true }); if (await x.count()) await x.first().click().catch(() => {}) }
await q.locator('nav').last().getByRole('button', { name: '健康' }).or(q.locator('nav').last().getByRole('link', { name: '健康' })).first().click(); await q.waitForTimeout(1500)
await q.getByTestId('h89-trend').scrollIntoViewIfNeeded(); await q.screenshot({ path: O + '8-浅色-360-身体电量当天.png' })
out.overflowLight360 = await q.evaluate(() => document.documentElement.scrollWidth > innerWidth)
console.log(JSON.stringify(out, null, 1)); await b.close()
