import { chromium } from 'playwright'
// v89.10.10 本地端到端（合成佳明接口响应，临时浏览器；不连真实账号）：同步后健康页是否刷新、第二次同步请求多少天
const U = process.env.FK_URL ?? 'http://127.0.0.1:8787/', O = process.env.FK_OUT ?? '/tmp/e2e110/'
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const out = { errors: [], summaryDays: [], runs: [] }
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, timezoneId: 'Asia/Shanghai', serviceWorkers: 'block' })
const now = Date.now(), tz = 8 * 3600e3, today = new Date(now + tz).toISOString().slice(0, 10)
const dayStart = d => Date.parse(d + 'T00:00:00Z') - tz
// 旧的本机日内：今天只到 09:09（模拟上次同步）
const stale = { schemaVersion: 1, days: { [today]: { schemaVersion: 1, day: today, source: 'garmin', fetchedAt: new Date(dayStart(today) + 9.2 * 3600e3).toISOString(), offsetMin: 480, hr: [[dayStart(today) + 9.15 * 3600e3, 60]], bb: [[dayStart(today) + 9.15 * 3600e3, 69]], st: [], restingHr: 47, sleep: null, training: [] } } }
await ctx.addInitScript(s => { if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1'); localStorage.setItem('fk-onboard-v1', '1'); localStorage.setItem('fk-welcome-standalone-v1', '1'); localStorage.setItem('fk-garmin-intraday-v1:local', JSON.stringify(s)) }, stale)
let phase = 0
await ctx.route('**/api/**', async route => {
  const url = new URL(route.request().url()), p = url.pathname.replace('/api/garmin/', '') + url.search
  const json = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  if (!url.pathname.startsWith('/api/garmin/')) return json({ ok: true, connected: false, providers: [] })
  if (p.startsWith('status')) return json({ ok: true, loggedIn: true, region: 'cn', profile: { displayName: 'synthetic', fullName: '合成账号' } })
  if (p.includes('activities/search')) return json([
    { activityId: 9001, activityType: { typeKey: 'running' }, startTimeGMT: new Date(now - 864e5).toISOString().slice(0, 19).replace('T', ' '), duration: 1800.37, distance: 5000.5 },
    { activityId: 9002, activityType: { typeKey: 'strength_training' }, startTimeGMT: new Date(now - 2 * 864e5).toISOString().slice(0, 19).replace('T', ' '), duration: 2400, distance: 0 }])
  const d = p.match(/\d{4}-\d{2}-\d{2}/)?.[0]
  if (p.includes('usersummary')) { out.summaryDays.push(`${phase}:${d}`); return json({ calendarDate: d, restingHeartRate: 47 + (d.charCodeAt(9) % 3), bodyBatteryMostRecentValue: d === today ? 55 : 60, averageStressLevel: 30, totalSteps: 8000 }) }
  if (p.includes('hrv-service')) return json({ hrvSummary: { calendarDate: d, lastNightAvg: 65 } })
  if (p.includes('dailySleepData')) return json({ dailySleepDTO: { calendarDate: d, sleepTimeSeconds: 7 * 3600, sleepStartTimestampGMT: dayStart(d) - 1.5 * 3600e3, sleepEndTimestampGMT: dayStart(d) + 5.5 * 3600e3 } })
  const end = d === today ? now - 10 * 60e3 : dayStart(d) + 864e5 - 60e3, pts = []
  for (let t = dayStart(d); t <= end; t += 15 * 60e3) pts.push(t)
  if (p.includes('dailyHeartRate')) return json({ calendarDate: d, restingHeartRate: 47, heartRateValueDescriptors: [{ key: 'timestamp', index: 0 }, { key: 'heartrate', index: 1 }], heartRateValues: pts.map(t => [t, 60]) })
  if (p.includes('dailyStress')) return json({ calendarDate: d, bodyBatteryValueDescriptorsDTOList: [{ bodyBatteryValueDescriptorIndex: 0, bodyBatteryValueDescriptorKey: 'timestamp' }, { bodyBatteryValueDescriptorIndex: 1, bodyBatteryValueDescriptorKey: 'bodyBatteryStatus' }, { bodyBatteryValueDescriptorIndex: 2, bodyBatteryValueDescriptorKey: 'bodyBatteryLevel' }], bodyBatteryValuesArray: pts.map((t, i) => [t, 'MEASURED', Math.max(5, 90 - i), 2]), stressValueDescriptorsDTOList: [{ key: 'timestamp', index: 0 }, { key: 'stressLevel', index: 1 }], stressValuesArray: pts.map(t => [t, 25]) })
  return json({})
})
const p = await ctx.newPage(); p.on('pageerror', e => out.errors.push(String(e)))
await p.goto(U, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500)
for (const n of ['跳过，用默认', '逐个调整', '暂不需要', '打开方坤']) { const x = p.getByRole('button', { name: n, exact: true }); if (await x.count()) await x.first().click().catch(() => {}) }
const nav = n => p.locator('nav').last().getByRole('button', { name: n }).or(p.locator('nav').last().getByRole('link', { name: n })).first().click()
await nav('健康'); await p.waitForTimeout(1200)
const tile = async () => (await p.locator('body').innerText()).match(/身体电量\s*\n?\s*(\d+)[^\n]*\n[^\n]*\n?[^\n]*/)?.[0]?.replace(/\s+/g, ' ')
out.beforeTile = await tile(); await p.screenshot({ path: O + '1-同步前-健康.png' })
// 先等页面自动同步结束（若有），再手动“立即同步”两次
async function syncOnce(label) {
  await p.getByRole('button', { name: '个人与数据' }).first().click().catch(() => {}); await p.waitForTimeout(600)
  await p.getByTestId('menu-sync').click(); await p.waitForTimeout(800)
  await p.getByTestId('sync-platform').selectOption('garmin').catch(() => {}); await p.waitForTimeout(800)
  await p.getByRole('button', { name: '同步中…' }).waitFor({ state: 'detached', timeout: 120000 }).catch(() => {})
  phase++; const before = out.summaryDays.length
  await p.getByRole('button', { name: '立即同步' }).first().click()
  await p.getByRole('button', { name: '立即同步' }).first().waitFor({ timeout: 180000 })
  await p.waitForTimeout(500)
  out.runs.push({ label, summaryRequests: out.summaryDays.length - before, days: out.summaryDays.slice(before).map(x => x.split(':')[1]), feedback: (await p.getByTestId('device-sync-center').innerText()).replace(/\s+/g, ' ').match(/(首次同步|增量同步|完整复核)[^。]*。[^。]*/)?.[0] })
  await p.screenshot({ path: O + `2-${label}.png` })
  await p.keyboard.press('Escape'); await p.waitForTimeout(400)
  const close = p.getByRole('button', { name: /关闭/ }); if (await close.count()) await close.first().click().catch(() => {})
  await p.waitForTimeout(800)
}
out.autoBefore = out.summaryDays.length
await syncOnce('第1次'); await syncOnce('第2次')
await nav('健康'); await p.waitForTimeout(1200)
out.afterTile = await tile(); out.bbChart = await p.getByTestId('h89-chart-bb').count()
await p.screenshot({ path: O + '3-同步后-健康.png' })
out.verdict = (await p.locator('body').innerText()).match(/证据不足[^\n]*\n[^\n]*/)?.[0]
console.log(JSON.stringify(out, null, 1)); await b.close()
