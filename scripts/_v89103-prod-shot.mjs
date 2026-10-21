import { chromium } from 'playwright'
const U = 'https://molen-fangkun.pages.dev/', O = '/workspace/out/screenshots/v89.10.3/'
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const out = { errors: [] }
// A: fresh browser, 先逛逛
{ const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
  await ctx.addInitScript(() => localStorage.setItem('fk-welcome-standalone-v1', '1'))
  const p = await ctx.newPage(); p.on('pageerror', e => out.errors.push(String(e)))
  await p.goto(U, { waitUntil: 'networkidle' }); await p.waitForTimeout(2000)
  await p.screenshot({ path: O + '0-首次引导.png' })
  const skip = p.getByRole('button', { name: /先逛逛/ }); out.skipBtn = await skip.count()
  if (out.skipBtn) { await skip.first().click(); await p.waitForTimeout(1500) }
  out.sw = await p.evaluate(async () => (await (await fetch('/sw.js')).text()).split('\n')[0])
  out.storage = await p.evaluate(() => Object.keys(localStorage).sort()); out.sched = await p.evaluate(() => localStorage.getItem('fk-schedule-v1'))
  out.nav = await p.locator('nav').last().innerText().catch(() => null)
  out.overflow = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  await p.screenshot({ path: O + '1-先逛逛后今天页.png' })
  for (const [n, f] of [['训练', '2-训练空状态.png'], ['饮食', '3-饮食空状态.png'], ['健康', '4-健康空状态.png']]) {
    const t = p.locator('nav').last().getByRole('button', { name: n }).or(p.locator('nav').last().getByRole('link', { name: n }))
    if (await t.count()) { await t.first().click(); await p.waitForTimeout(1200); await p.screenshot({ path: O + f }) } else out.errors.push('nav missing ' + n)
  }
  await ctx.close() }
// B: 3D 部位信息 (ITB)
{ const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
  await ctx.addInitScript(() => { localStorage.setItem('fk-onboard-v1', '1'); localStorage.setItem('fk-welcome-standalone-v1', '1') })
  const p = await ctx.newPage(); p.on('pageerror', e => out.errors.push(String(e)))
  await p.goto(U, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500)
  for (const n of ['跳过，用默认', '逐个调整', '暂不需要', '打开方坤']) { const x = p.getByRole('button', { name: n, exact: true }); if (await x.count()) await x.first().click().catch(() => {}) }
  await p.locator('nav').last().getByRole('button', { name: '训练' }).or(p.locator('nav').last().getByRole('link', { name: '训练' })).first().click(); await p.waitForTimeout(1000)
  for (const n of ['课程', '力量']) { const x = p.getByRole('button', { name: n, exact: true }).or(p.getByRole('tab', { name: n, exact: true })); if (await x.count()) { await x.first().click().catch(() => {}); await p.waitForTimeout(800) } }
  await p.screenshot({ path: O + '7-训练-课程-力量.png' })
  const mx = p.getByRole('button', { name: /按部位选动作/ })
  out.mxEntry = await mx.count()
  if (out.mxEntry) {
    await mx.first().click()
    const d = p.getByRole('dialog', { name: '人体肌群3D', exact: true }); await d.waitFor()
    await p.waitForFunction(() => !!document.querySelector('canvas[aria-label="人体肌群3D"]')?.__fk, null, { timeout: 90000 }); await p.waitForTimeout(1500)
    await d.getByRole('button', { name: '右侧', exact: true }).click(); await p.waitForTimeout(800)
    const cv = d.locator('canvas'), box = await cv.boundingBox(); let hit = null
    for (let y = .4; y <= .8 && !hit; y += .02) for (let x = .25; x <= .75 && !hit; x += .02) {
      const name = await p.evaluate(([px, py]) => document.querySelector('canvas[aria-label="人体肌群3D"]').__fk.pickAt(px, py)?.userData.fk.name || null, [box.x + box.width * x, box.y + box.height * y])
      if (name && /iliotibial/i.test(name)) hit = [box.x + box.width * x, box.y + box.height * y] }
    out.itbFound = !!hit; if (hit) { await p.mouse.click(hit[0], hit[1]); await p.waitForTimeout(600) }
    out.info = await d.getByRole('region', { name: '部位信息' }).innerText().catch(() => null)
    await p.screenshot({ path: O + '5-3D髂胫束.png' })
    await d.getByRole('combobox', { name: '按名称选择部位' }).selectOption({ label: '股直肌' }).catch(e => out.errors.push('select ' + e.message.slice(0, 80)))
    await p.waitForTimeout(600); out.info2 = await d.getByRole('region', { name: '部位信息' }).innerText().catch(() => null)
    out.fit = await p.evaluate(() => document.querySelector('canvas[aria-label="人体肌群3D"]').__fk.state.fit.distance)
    await p.screenshot({ path: O + '6-按名称选股直肌.png' })
  }
  await ctx.close() }
console.log(JSON.stringify(out, null, 1)); await b.close()
