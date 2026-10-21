import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
// 合成数据，只存在于临时浏览器，不写入产品
const U = 'https://molen-fangkun.pages.dev/', O = '/workspace/out/screenshots/v89.10.5/'
const entries = JSON.parse(readFileSync('/tmp/seed-entries.json', 'utf8'))
const D = (date, weekday, title, main, strength) => ({ orig: date, date, weekday, week: 'W1', title, main, aux: [], strength })
const plan = { schema: 'fangkun-plan-v1', label: '合成测试计划', plan: { name: '合成测试计划', shiftDays: 0, weeks: [{ week: 'W1', title: '合成周', range: '10/19-10/25', principle: '' }], days: [
  D('2026-10-20', '周二', '休息', ['休息'], []), D('2026-10-21', '周三', '间歇跑', ['200米 × 6次'], []), D('2026-10-22', '周四', '力量A', [], ['深蹲 3×8']),
  D('2026-10-23', '周五', '轻松跑＋力量', ['轻松跑30分钟'], ['臀桥 3×12']), D('2026-10-24', '周六', '休息', ['休息'], []), D('2026-10-25', '周日', '长距离跑', ['10公里'], [])] } }
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const out = { errors: [] }
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
await ctx.addInitScript(([p, e]) => { if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1'); localStorage.setItem('fk-onboard-v1', '1'); localStorage.setItem('fk-welcome-standalone-v1', '1'); localStorage.setItem('fk-plan-doc-v1', p); localStorage.setItem('fk-schedule-v1', JSON.stringify({ entries: e, acks: [], acksByAthlete: { local: [] } })) }, [JSON.stringify(plan), entries])
const p = await ctx.newPage(); p.on('pageerror', e => out.errors.push(String(e)))
await p.goto(U, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500)
for (const n of ['跳过，用默认', '逐个调整', '暂不需要', '打开方坤']) { const x = p.getByRole('button', { name: n, exact: true }); if (await x.count()) await x.first().click().catch(() => {}) }
out.sw = await p.evaluate(async () => (await (await fetch('/sw.js')).text()).split('\n')[0])
await p.locator('nav').last().getByRole('button', { name: '训练' }).or(p.locator('nav').last().getByRole('link', { name: '训练' })).first().click(); await p.waitForTimeout(1000)
const pl = p.getByRole('button', { name: '计划', exact: true }).or(p.getByRole('tab', { name: '计划', exact: true })); if (await pl.count()) await pl.first().click(); await p.waitForTimeout(800)
for (const [n, f] of [['跑步', '1-计划-跑步'], ['力量', '2-计划-力量']]) {
  await p.getByRole('button', { name: n, exact: true }).first().click(); await p.waitForTimeout(1000)
  const cyc = p.getByTestId('plan400-cycle'); if (await cyc.count()) { const w = cyc.getByRole('button', { name: /W1/ }); if (await w.count() && (await w.first().getAttribute('aria-expanded')) === 'false') await w.first().click(); await p.waitForTimeout(300) }
  out[n] = { cycle: await cyc.innerText().catch(() => null), custom: await p.locator('section.fk-scheduled-list').allInnerTexts() }
  await p.screenshot({ path: O + f + '.png', fullPage: true })
}
const rest = p.getByTestId('plan400-cycle').locator('details[aria-label="休息安排"]'); out.restOpen = await rest.getAttribute('open').catch(() => 'n/a')
if (await rest.count()) { await rest.locator('summary').click(); await p.waitForTimeout(300); await p.screenshot({ path: O + '3-休息安排展开.png', fullPage: true }) }
out.overflow = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)
console.log(JSON.stringify(out, null, 1)); await b.close()
