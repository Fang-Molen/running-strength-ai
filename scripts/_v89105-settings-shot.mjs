import { chromium } from 'playwright'
const U = 'https://molen-fangkun.pages.dev/', O = '/workspace/out/screenshots/v89.10.5/'
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const out = { errors: [], api: [] }
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
await ctx.addInitScript(() => { localStorage.setItem('fk-onboard-v1', '1'); localStorage.setItem('fk-welcome-standalone-v1', '1') })
const p = await ctx.newPage(); p.on('pageerror', e => out.errors.push(String(e)))
p.on('response', r => { if (/\/api\/(garmin|coros)/.test(r.url())) out.api.push(r.status() + ' ' + new URL(r.url()).pathname) })
await p.goto(U, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500)
for (const n of ['跳过，用默认', '逐个调整', '暂不需要', '打开方坤']) { const x = p.getByRole('button', { name: n, exact: true }); if (await x.count()) await x.first().click().catch(() => {}) }
out.sw = await p.evaluate(async () => (await (await fetch('/sw.js')).text()).split('\n')[0])
await p.getByRole('button', { name: '个人与数据' }).first().click().catch(e => out.errors.push('gear ' + e.message.slice(0, 60))); await p.waitForTimeout(1000)
await p.screenshot({ path: O + '1-设置.png' }); out.settings = (await p.locator('body').innerText()).slice(0, 600)
const dev = p.getByRole('button', { name: /设备连接与同步/ }); out.devBtn = await dev.count()
if (out.devBtn) { await dev.first().click(); await p.waitForTimeout(2500); await p.screenshot({ path: O + '2-设备连接与同步.png', fullPage: true })
  out.garmin = await p.locator('#garmin-sync').innerText().catch(() => null); out.coros = await p.getByTestId('coros-account').first().innerText().catch(() => null)
  out.garminLoginForm = await p.getByLabel('佳明账号', { exact: true }).count()
  await p.keyboard.press('Escape').catch(() => {}); const back = p.getByRole('button', { name: /返回/ }); if (await back.count()) await back.first().click().catch(() => {}); await p.waitForTimeout(800) }
const ap = p.getByRole('button', { name: /外观与显示/ }); out.apBtn = await ap.count()
if (out.apBtn) { await ap.first().click(); await p.waitForTimeout(1200); await p.screenshot({ path: O + '3-外观与壁纸.png', fullPage: true }) }
out.overflow = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)
console.log(JSON.stringify(out, null, 1)); await b.close()
