import { chromium } from 'playwright'
// v89.10.12 端到端（合成佳明接口，Asia/Shanghai，临时浏览器；不连真实账号）：
// 早上同步时佳明只有到 12:27 的数据 → 几小时后回到前台，自动同步是否重取今天日内、身体电量卡片是否刷新。
const U = process.env.FK_URL ?? 'http://127.0.0.1:8787/', O = process.env.FK_OUT ?? '/tmp/e2e112/'
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const out = { errors: [], log: [] }
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, timezoneId: 'Asia/Shanghai', serviceWorkers: 'block' })
const tz = 8 * 3600e3, now = Date.now(), today = new Date(now + tz).toISOString().slice(0, 10)
const dayStart = d => Date.parse(d + 'T00:00:00Z') - tz
let serverNow = Math.min(now, dayStart(today) + (12 * 60 + 27) * 60e3), phase = 'morning'
const calls = []
await ctx.addInitScript(() => { if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1'); localStorage.setItem('fk-onboard-v1', '1'); localStorage.setItem('fk-welcome-standalone-v1', '1') })
await ctx.route('**/api/**', async route => {
  const url = new URL(route.request().url()), p = url.pathname.replace('/api/garmin/', '') + url.search
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  if (!url.pathname.startsWith('/api/garmin/')) return json({ ok: true, connected: false, providers: [] })
  calls.push(`${phase} ${p.split('?')[0].slice(0, 60)} ${p.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? ''}`)
  if (p.startsWith('status')) return json({ ok: true, loggedIn: true, region: 'cn', profile: { displayName: 'synthetic', fullName: '合成账号' } })
  if (p.includes('activities/search')) return json([])
  const d = p.match(/\d{4}-\d{2}-\d{2}/)?.[0]
  if (p.includes('usersummary')) return json({ calendarDate: d, restingHeartRate: 47, bodyBatteryMostRecentValue: 50, averageStressLevel: 30, totalSteps: 8000 })
  if (p.includes('hrv-service')) return json({ hrvSummary: { calendarDate: d, lastNightAvg: 65 } })
  if (p.includes('dailySleepData')) return json({ dailySleepDTO: { calendarDate: d, sleepTimeSeconds: 4.55 * 3600, sleepStartTimestampGMT: dayStart(d) - 1 * 3600e3, sleepEndTimestampGMT: dayStart(d) + 3.6 * 3600e3 } })
  const end = d === today ? serverNow : dayStart(d) + 864e5 - 60e3, pts = []
  for (let t = dayStart(d); t <= end; t += 15 * 60e3) pts.push(t)
  const off = { startTimestampGMT: new Date(dayStart(d)).toISOString().slice(0, 19), startTimestampLocal: d + 'T00:00:00' }
  if (p.includes('dailyHeartRate')) return json({ calendarDate: d, ...off, restingHeartRate: 47, heartRateValueDescriptors: [{ key: 'timestamp', index: 0 }, { key: 'heartrate', index: 1 }], heartRateValues: pts.map(t => [t, 60]) })
  if (p.includes('dailyStress')) return json({ calendarDate: d, ...off, bodyBatteryValueDescriptorsDTOList: [{ bodyBatteryValueDescriptorIndex: 0, bodyBatteryValueDescriptorKey: 'timestamp' }, { bodyBatteryValueDescriptorIndex: 1, bodyBatteryValueDescriptorKey: 'bodyBatteryStatus' }, { bodyBatteryValueDescriptorIndex: 2, bodyBatteryValueDescriptorKey: 'bodyBatteryLevel' }], bodyBatteryValuesArray: pts.map((t, i) => [t, 'MEASURED', Math.max(5, 95 - Math.round(i / 2)), 2]), stressValueDescriptorsDTOList: [{ key: 'timestamp', index: 0 }, { key: 'stressLevel', index: 1 }], stressValuesArray: pts.map(t => [t, 25]) })
  return json({})
})
const p = await ctx.newPage(); p.on('pageerror', e => out.errors.push(String(e)))
const tile = async () => (await p.locator('body').innerText()).match(/身体电量\s*\n?\s*(\d+)[^\n]*\n[^\n]*\n?[^\n]*/)?.[0]?.replace(/\s+/g, ' ')
const settle = async () => { let n = -1, still = 0; for (let i = 0; i < 400 && still < 8; i++) { await p.waitForTimeout(500); if (calls.length === n) still++; else { still = 0; n = calls.length } } }
await p.goto(U, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500)
for (const n of ['跳过，用默认', '逐个调整', '暂不需要', '打开方坤']) { const x = p.getByRole('button', { name: n, exact: true }); if (await x.count()) await x.first().click().catch(() => {}) }
const nav = n => p.locator('nav').last().getByRole('button', { name: n }).first().click()
await settle(); await p.waitForTimeout(3000)
await nav('健康'); await p.waitForTimeout(1500)
out.morning = { tile: await tile(), requests: calls.length }
await p.screenshot({ path: O + '1-上午同步后.png' })
// 模拟“过了几小时”：把本机记录的同步时刻往前挪 4 小时（不改代码路径），佳明服务器此时已有到现在的数据。
await p.evaluate(shift => { for (const k of Object.keys(localStorage)) { if (/^fk-garmin-(last-sync|last-attempt|last-full-ok):/.test(k)) localStorage.setItem(k, new Date(Date.parse(localStorage.getItem(k)) - shift).toISOString()); if (/^fk-garmin-sync-report:/.test(k)) { const r = JSON.parse(localStorage.getItem(k)); r.at = new Date(Date.parse(r.at) - shift).toISOString(); localStorage.setItem(k, JSON.stringify(r)) } if (/^fk-garmin-daily-progress:/.test(k)) { const r = JSON.parse(localStorage.getItem(k)); if (r.progress?.lastSyncAt) r.progress.lastSyncAt = new Date(Date.parse(r.progress.lastSyncAt) - shift).toISOString(); localStorage.setItem(k, JSON.stringify(r)) } } }, 4 * 3600e3)
out.state = await p.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter(k => /^fk-garmin-(sync-report|auto-fail|last-sync|daily-progress)/.test(k)).map(k => [k, localStorage.getItem(k).slice(0, 300)])))
await p.waitForTimeout(61000) // 页面内“60 秒内不重复尝试”的保护
if (!process.env.FK_NODATA) serverNow = now - 10 * 60e3; phase = 'resume'
const before = calls.length
await p.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })) })
await p.waitForTimeout(2500); await settle(); await p.waitForTimeout(1500)
out.resume = { tile: await tile(), stale: await p.getByTestId('h89-stale').first().innerText().catch(() => null), requests: calls.length - before, days: [...new Set(calls.slice(before).map(c => c.split(' ').slice(1).join(' ')).filter(c => !/status|activities/.test(c)))] }
await p.screenshot({ path: O + '2-回到前台后.png' })
console.log(JSON.stringify(out, null, 1)); await b.close()
