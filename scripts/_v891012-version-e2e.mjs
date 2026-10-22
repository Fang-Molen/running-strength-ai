import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'
// v89.10.12：本地核对“回到前台发现新版本 → 刷新一次”。临时改本地构建目录里的 sw.js 版本号，结束后还原。
const U = process.env.FK_URL ?? 'http://127.0.0.1:8787/', F = '.output/public/sw.js', orig = readFileSync(F, 'utf8')
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' })
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })
await ctx.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"loggedIn":false}' }))
const p = await ctx.newPage(); let loads = 0; p.on('load', () => loads++)
const out = {}
try {
  await p.goto(U, { waitUntil: 'networkidle' }); await p.waitForTimeout(3000)
  await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await p.waitForTimeout(3000)
  out.sameVersionLoads = loads
  writeFileSync(F, orig.replace(/fr255-shell-[\w-]+/, 'fr255-shell-test-newer'))
  await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await p.waitForTimeout(5000)
  out.newVersionLoads = loads
  await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await p.waitForTimeout(4000)
  out.noLoopLoads = loads
} finally { writeFileSync(F, orig) }
console.log(JSON.stringify(out)); await b.close()
