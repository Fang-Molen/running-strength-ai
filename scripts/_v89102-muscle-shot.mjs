import { chromium } from 'playwright'
const U = 'https://molen-fangkun.pages.dev/', O = '/workspace/out/screenshots/v89.10.2/'
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
await ctx.addInitScript(() => { localStorage.setItem('fk-onboard-v1', '1'); localStorage.setItem('fk-welcome-standalone-v1', '1') })
const p = await ctx.newPage(), out = { errors: [] }; p.on('pageerror', e => out.errors.push(String(e)))
await p.goto(U, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500)
for (const n of ['跳过，用默认', '逐个调整', '暂不需要', '打开方坤']) { const x = p.getByRole('button', { name: n, exact: true }); if (await x.count()) await x.first().click().catch(() => {}) }
await p.locator('.fk-coach-tabs').getByRole('button', { name: '学习', exact: true }).click().catch(e => out.errors.push('tabs ' + e.message.slice(0, 80)))
await p.waitForTimeout(1000)
const mx = p.getByRole('button', { name: /人体肌群 3D/ })
if (!(await mx.count())) { const more = p.getByRole('button', { name: /查看动作与热身/ }); if (await more.count()) await more.first().click() }
await p.screenshot({ path: O + '0-入口.png' }); out.entry = await mx.count()
await mx.first().click()
const d = p.getByRole('dialog', { name: '人体肌群3D', exact: true }); await d.waitFor()
const cv = d.locator('canvas'); await p.waitForFunction(() => !!document.querySelector('canvas[aria-label="人体肌群3D"]')?.__fk, null, { timeout: 90000 })
await p.waitForTimeout(1500)
await d.getByRole('button', { name: '右侧', exact: true }).click(); await p.waitForTimeout(800)
const box = await cv.boundingBox(); let hit = null
// Scan the lateral thigh for the iliotibial tract.
for (let y = .5; y <= .78 && !hit; y += .02) for (let x = .3; x <= .7 && !hit; x += .02) {
  const name = await p.evaluate(([px, py]) => document.querySelector('canvas[aria-label="人体肌群3D"]').__fk.pickAt(px, py)?.userData.fk.name || null, [box.x + box.width * x, box.y + box.height * y])
  if (name && /iliotibial/i.test(name)) hit = [box.x + box.width * x, box.y + box.height * y]
}
out.itbFound = !!hit
if (hit) { await p.mouse.click(hit[0], hit[1]); await p.waitForTimeout(600) }
out.picked = await d.locator('b.text-accent').first().innerText().catch(() => null)
out.info = await d.getByRole('region', { name: '肌群信息' }).innerText().catch(() => null)
await cv.scrollIntoViewIfNeeded(); await p.screenshot({ path: O + '1-髂胫束-选中.png' })
const dist = () => p.evaluate(() => document.querySelector('canvas[aria-label="人体肌群3D"]').__fk.state.distance)
out.fit = await p.evaluate(() => document.querySelector('canvas[aria-label="人体肌群3D"]').__fk.state.fit.distance); out.d0 = await dist()
await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
for (let i = 0; i < 25; i++) { await p.mouse.wheel(0, -200); await p.waitForTimeout(60) }
await p.waitForTimeout(1500); out.d1 = await dist(); out.ratio = out.d1 / out.fit
await d.locator('canvas').scrollIntoViewIfNeeded(); await p.screenshot({ path: O + '2-最近缩放-仍对准所选.png' })
// back view: tap the middle back
await d.getByRole('button', { name: '重置', exact: true }).click(); await d.getByRole('button', { name: '背面', exact: true }).click(); await p.waitForTimeout(800)
await p.mouse.click(box.x + box.width * .5, box.y + box.height * .33); await p.waitForTimeout(600)
out.backPick = await d.locator('b.text-accent').first().innerText().catch(() => null)
await p.screenshot({ path: O + '3-背面点选.png' })
await d.getByRole('region', { name: '肌群信息' }).scrollIntoViewIfNeeded(); await p.screenshot({ path: O + '4-功能与相关动作.png' })
console.log(JSON.stringify(out, null, 1)); await b.close()
