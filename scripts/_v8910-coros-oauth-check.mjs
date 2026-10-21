import { chromium } from 'playwright'
const U = 'https://molen-fangkun.pages.dev/', O = '/workspace/out/screenshots/v89.10/'
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' })
const out = {}
// 1) onboarding with COROS chosen (fresh profile)
{ const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage()
  await p.goto(U, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500)
  out.sw = await p.evaluate(async () => (await (await fetch('/sw.js', { cache: 'no-store' })).text()).match(/fr255-shell-[\w-]+/)?.[0])
  await p.getByRole('button', { name: '下一步' }).click(); await p.waitForTimeout(600)
  await p.getByRole('button', { name: /专业运动手表/ }).first().click(); await p.waitForTimeout(500)
  out.brandSelect = await p.locator('select[aria-label="品牌"]').count()
  if (out.brandSelect) { await p.selectOption('select[aria-label="品牌"]', 'coros'); await p.waitForTimeout(1200)
    const c = p.locator('[data-testid=coros-account]').first(); await c.scrollIntoViewIfNeeded(); out.onboardCard = await c.isVisible(); out.onboardText = (await c.locator('h3').innerText()) }
  await p.screenshot({ path: O + 'onboarding-coros.png' }) }
// 2) device sheet
{ const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
  await ctx.addInitScript(() => { localStorage.setItem('fk-onboard-v1', '1'); localStorage.setItem('fk-welcome-standalone-v1', '1') })
  const p = await ctx.newPage(); await p.goto(U, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500)
  for (const n of ['跳过，用默认', '逐个调整', '暂不需要']) { const x = p.getByRole('button', { name: n }); if (await x.count()) await x.first().click().catch(() => {}) }
  await p.locator('[aria-label="个人与数据"]').first().click(); await p.waitForTimeout(500)
  await p.locator('[data-testid=menu-sync]').click(); await p.waitForTimeout(2500)
  out.statusRows = await p.locator('[data-testid=coros-status]').innerText()
  const c = p.locator('[data-testid=coros-account]').first(); out.sheetCard = await c.isVisible(); await c.scrollIntoViewIfNeeded(); await p.waitForTimeout(300)
  await p.screenshot({ path: O + 'device-sheet-coros-card.png' })
  await p.locator('[data-testid=coros-status]').scrollIntoViewIfNeeded(); await p.screenshot({ path: O + 'device-sheet-status-rows.png' })
  out.garmin = await p.getByText('佳明中国').count(); out.oauthBtn = await p.locator('[data-testid=coros-oauth]').count(); out.pwdInput = await p.locator('input[aria-label=高驰密码]').count(); out.oauthHref = await p.locator('[data-testid=coros-oauth]').first().getAttribute('href') }
console.log(JSON.stringify(out, null, 1)); await b.close()
