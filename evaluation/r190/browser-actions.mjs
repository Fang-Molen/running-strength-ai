import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
const base = process.argv[2], label = process.argv[3] || 'dev'
const out = '/workspace/fangkun/evidence/r190/browser', screens = '/workspace/screenshots/fangkun-r190'
mkdirSync(out, { recursive: true }); mkdirSync(screens, { recursive: true })
const results = [], errors = [], requests = []
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: label === 'prod' ? 'allow' : 'block' })
await ctx.route('**/*', r => new URL(r.request().url()).origin === new URL(base).origin ? r.continue() : r.abort())
ctx.on('request', r => requests.push({ path: new URL(r.url()).pathname, origin: new URL(r.url()).origin, method: r.method() }))
const p = await ctx.newPage(); p.setDefaultTimeout(15000)
p.on('pageerror', e => errors.push(String(e)))
const check = (name, ok, detail = '') => { results.push({ name, status: ok ? 'PASS' : 'FAIL', detail }); console.log(JSON.stringify(results.at(-1))); if (!ok) throw Error(name + ': ' + detail) }
const ready = () => p.locator('[data-testid="training-app"][data-ready="true"]').waitFor({ timeout: 90000 })
const openLibrary = async () => {
  await p.getByRole('button', { name: '切换到计划', exact: true }).click()
  await p.getByRole('button', { name: '动作库 · 力量动作与跑步技术', exact: true }).click()
  await p.getByRole('region', { name: '动作库', exact: true }).waitFor()
}
const facts = () => p.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(localStorage).filter(([k]) => /strength-plan|running-plan|fr255-events|fr255-event-journal|training-import|coach-review|fr255-p7/.test(k)).sort(([a], [b]) => a.localeCompare(b)))))
try {
  await p.goto(base, { waitUntil: 'domcontentloaded', timeout: 90000 }); await ready()
  if (label === 'prod') { await p.waitForFunction(() => !!navigator.serviceWorker.controller); await p.reload({ waitUntil: 'domcontentloaded' }); await ready() }
  const before = await facts()
  check('boot_does_not_download_models', !requests.some(r => /human\.glb|viewer3d\.js/.test(r.path)))
  await openLibrary()
  const lib = p.getByRole('region', { name: '动作库', exact: true })
  check('library_visible_without_opening_plan_tools', await lib.isVisible())
  check('all_76_strength_entries_preserved', await lib.locator('.list>.item').count() === 76)
  await lib.getByRole('button', { name: '跑步技术', exact: true }).click()
  const tech = p.getByRole('region', { name: '跑步技术动作库', exact: true })
  check('all_53_technique_drafts_visible', await tech.locator('.tech-item').count() === 53 && (await tech.innerText()).includes('待教练审核'))
  check('nine_categories', await tech.getByRole('group', { name: '技术分类' }).getByRole('button').count() === 10)
  check('technique_browsing_does_not_load_strength_model', !requests.some(r => /human\.glb|viewer3d\.js/.test(r.path)))
  await tech.getByRole('group', { name: '技术分类' }).getByRole('button', { name: '弯道技术', exact: true }).click()
  check('category_filter', await tech.locator('.tech-item').count() > 0 && (await tech.locator('.tech-item small').allTextContents()).every(s => s.includes('弯道技术')))
  await tech.getByRole('button', { name: '全部分类', exact: true }).click()
  await tech.getByLabel('项目', { exact: true }).selectOption('800')
  await tech.getByLabel('难度', { exact: true }).selectOption('beginner')
  check('event_and_level_combined_filter', await tech.locator('.tech-item').count() > 0 && await tech.locator('.tech-item').count() < 53 && (await tech.locator('.tech-item small').allTextContents()).every(s => s.includes('初级')))
  await tech.getByLabel('项目', { exact: true }).selectOption('')
  await tech.getByLabel('难度', { exact: true }).selectOption('')
  await tech.getByLabel('器材', { exact: true }).selectOption('手机/支架')
  check('equipment_filter', await tech.locator('.tech-item').count() > 0 && (await tech.locator('.tech-item small').allTextContents()).every(s => s.includes('手机/支架')))
  await tech.getByLabel('器材', { exact: true }).selectOption('none')
  check('no_equipment_filter', await tech.locator('.tech-item').count() > 0 && (await tech.locator('.tech-item small').allTextContents()).every(s => s.includes('无器材')))
  await tech.getByLabel('器材', { exact: true }).selectOption('')
  await tech.getByPlaceholder('例如：摆臂、A式、步频').fill('A-March')
  check('english_search', await tech.locator('.tech-item').count() > 0 && await tech.locator('.tech-item').count() < 53)
  await tech.getByPlaceholder('例如：摆臂、A式、步频').fill('不存在的技术zz')
  check('empty_result_is_truthful', await tech.locator('.tech-item').count() === 0 && (await tech.innerText()).includes('没有符合条件的动作'))
  await tech.getByPlaceholder('例如：摆臂、A式、步频').fill('')
  for (const width of [390, 414, 768]) {
    await p.setViewportSize({ width, height: 900 }); await p.screenshot({ path: `${screens}/${label}-tech-list-${width}.png` })
    check('list_no_horizontal_overflow_' + width, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  }
  await tech.locator('#technique-fk-run-tech-001').click()
  const detail = p.getByRole('article', { name: '站姿-跑姿对齐技术说明', exact: true })
  check('detail_renders_observable_purpose_steps_and_cue', (await detail.innerText()).includes('建立头、躯干与骨盆自然排列的感觉') && await detail.locator('ol>li').count() === 3 && (await detail.innerText()).includes('身体高而放松'))
  check('missing_animation_not_faked', (await detail.innerText()).includes('尚未提供可播放动画') && await detail.locator('canvas,video').count() === 0 && await detail.getByRole('button', { name: /播放|加入/ }).count() === 0)
  await detail.locator('summary', { hasText: '教学参考量' }).click()
  check('dose_ranges_and_null_not_converted_to_prescription', (await detail.innerText()).includes('15–30 秒') && (await detail.innerText()).includes('未指定') && (await detail.innerText()).includes('暂不加入可执行计划'))
  await detail.locator('summary', { hasText: '内容来源与证据限制' }).click()
  check('source_and_version_visible', (await detail.innerText()).includes('fk-run-tech-001') && (await detail.innerText()).includes('1.0.0') && await detail.getByRole('link').count() === 2)
  for (const width of [390, 414, 768]) {
    await p.setViewportSize({ width, height: 900 }); await detail.getByRole('heading', { name: '站姿-跑姿对齐', exact: true }).scrollIntoViewIfNeeded()
    await p.screenshot({ path: `${screens}/${label}-tech-detail-${width}.png` })
    check('detail_no_horizontal_overflow_' + width, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  }
  await detail.getByRole('button', { name: '‹ 返回跑步技术列表', exact: true }).click()
  await p.waitForFunction(() => document.activeElement?.id === 'technique-fk-run-tech-001')
  check('back_restores_list_and_keyboard_focus', await tech.locator('.tech-item').count() === 53)
  check('browsing_never_writes_plans_facts_or_judgments', await facts() === before)
  if (label === 'prod') {
    await ctx.setOffline(true); await p.reload({ waitUntil: 'domcontentloaded' }); await ready(); await openLibrary()
    await p.getByRole('region', { name: '动作库', exact: true }).getByRole('button', { name: '跑步技术', exact: true }).click()
    await p.getByRole('region', { name: '跑步技术动作库', exact: true }).locator('#technique-fk-run-tech-001').click()
    check('visited_technique_library_reopens_offline', await p.getByRole('article', { name: '站姿-跑姿对齐技术说明', exact: true }).isVisible())
    check('offline_browsing_preserves_facts', await facts() === before)
    await p.screenshot({ path: `${screens}/${label}-tech-offline.png` })
  }
  check('no_cloud_or_mutation_requests', requests.every(r => r.origin === new URL(base).origin && r.method === 'GET'))
  check('no_uncaught_browser_errors', errors.length === 0, JSON.stringify(errors))
} catch (error) {
  errors.push(String(error)); results.push({ name: 'actions_flow', status: 'FAIL', detail: String(error) })
  await p.screenshot({ path: `${screens}/${label}-actions-failure.png` }).catch(() => {})
} finally {
  await ctx.close(); await browser.close()
  writeFileSync(`${out}/${label}-actions.json`, JSON.stringify({ results, errors, requests }, null, 2))
  console.log(JSON.stringify({ label, pass: results.filter(r => r.status === 'PASS').length, fail: results.filter(r => r.status === 'FAIL').length, errors }))
  if (errors.length || results.some(r => r.status === 'FAIL')) process.exitCode = 1
}
