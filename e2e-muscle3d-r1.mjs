// Muscle 3D R1 acceptance in a local build. Usage:
//   BASE=http://127.0.0.1:8912 OUT=/workspace/out/muscle3d-r1/e2e ENGINE=webkit node e2e-muscle3d-r1.mjs
// Browser-engine evidence only (Playwright WebKit / Chromium on Linux); NOT a real iPhone.
import { webkit, chromium } from 'playwright'
import fs from 'node:fs'
const BASE = process.env.BASE || 'http://127.0.0.1:8912', OUT = process.env.OUT || '/tmp/m3d-r1', ENGINE = process.env.ENGINE || 'webkit'
const SEED = process.env.SEED || '/workspace/out/ui-r1/seed.mjs', WIDTH = +(process.env.WIDTH || 390), VIDEO = process.env.VIDEO === '1'
fs.mkdirSync(OUT, { recursive: true })
const { seed } = await import(SEED)
const R = []; const ok = (n, c, x = '') => { const l = `${c ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`; R.push(l); console.log(l) }
const b = ENGINE === 'webkit' ? await webkit.launch() : await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
async function open({ blockModel = false } = {}) {
  const c = await b.newContext({ viewport: { width: WIDTH, height: 844 }, deviceScaleFactor: 2, hasTouch: true, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', serviceWorkers: 'block', ...(VIDEO && !blockModel ? { recordVideo: { dir: OUT, size: { width: WIDTH, height: 844 } } } : {}) })
  await c.addInitScript(s => { if (!localStorage.getItem('__seeded')) { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); localStorage.setItem('__seeded', '1') } }, seed())
  await c.route('**/api/**', r => r.fulfill({ status: 503, json: { error: 'offline in test' } }))
  // Fault injection: WebGL unavailable (as on a device with WebGL disabled/lost).
  if (blockModel) await c.addInitScript(() => { const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, ...a) { return /webgl/.test(t) ? null : g.call(this, t, ...a) } })
  const p = await c.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(String(e)))
  await p.goto(BASE + '/'); await p.waitForTimeout(2000)
  await p.getByRole('button', { name: /^添加训练$/ }).first().click(); await p.waitForTimeout(800)
  await p.getByRole('button', { name: '肌肉图选择' }).first().click(); await p.waitForTimeout(800)
  const d = p.getByRole('dialog', { name: '人体肌群3D' }), cv = d.locator('canvas[aria-label="人体肌群3D"]')
  return { c, p, d, cv }
}
const { c, p, d, cv } = await open()
ok('explorer sheet opens from 添加训练 → 肌肉图选择', await d.count() > 0)
await p.waitForFunction(() => !!document.querySelector('canvas[aria-label="人体肌群3D"]')?.__fk, null, { timeout: 60000 }).catch(() => {})
const st = () => cv.evaluate(e => e.__fk?.state)
ok('3D ready', !!(await st()), p.errs.join('|')); await p.waitForTimeout(1200)
await p.screenshot({ path: `${OUT}/sheet-${WIDTH}.png` })
ok(`no horizontal overflow at ${WIDTH}px`, await p.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 0)
const tapSize = await d.getByRole('button', { name: '正面', exact: true }).boundingBox(); ok('view buttons ≥44px tall', tapSize.height >= 43.5, String(tapSize.height))
for (const [v, l] of [['front', '正面'], ['left', '左侧'], ['right', '右侧'], ['back', '背面']]) {
  await d.getByRole('button', { name: l, exact: true }).click(); await p.waitForTimeout(800)
  const s = await st(); const want = { front: 0, left: 90, right: -90, back: 180 }[v]
  const dAz = Math.abs((((s.azimuth - want) % 360) + 540) % 360 - 180); ok(`view ${l}`, s.view === v && dAz < 1, `az=${s.azimuth.toFixed(1)}`)
  await cv.screenshot({ path: `${OUT}/view-${v}.png` })
}
// Find a canvas point whose pickAt() result matches, then perform a REAL touch tap there.
async function findPoint(match) {
  const box = await cv.boundingBox()
  // Coarse pickAt() scan, then choose an interior point of the most-hit mesh (neighbours at 5/10 px hit the same mesh).
  const pt = await cv.evaluate((e, m) => { const r = e.getBoundingClientRect(); const re = new RegExp(m), hits = []
    const at = (px, py) => e.__fk.pickAt(r.left + px, r.top + py)
    for (let y = .06; y < .97; y += .025) for (let x = .25; x < .75; x += .02) { const o = at(r.width * x, r.height * y); if (o && (re.test(o.userData.fk.k) || re.test(o.userData.fk.g || ''))) hits.push([r.width * x, r.height * y, o]) }
    if (!hits.length) return null
    const count = new Map(); for (const h of hits) count.set(h[2].uuid, (count.get(h[2].uuid) || 0) + 1)
    const best = [...count].sort((a, b) => b[1] - a[1])[0][0]
    const score = ([x, y]) => { let s = 0; for (const d of [5, 10]) for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d]]) if (at(x + dx, y + dy)?.uuid === best) s++; return s }
    const h = hits.filter(h => h[2].uuid === best).map(h => [score(h) + (Math.abs(h[0] / r.width - .5) < .2 ? .5 : 0), h]).sort((a, b) => b[0] - a[0])[0][1]
    return [h[0], h[1], h[2].userData.fk.zh, h[2].userData.fk.k] }, match)
  return pt && { x: box.x + pt[0], y: box.y + pt[1], zh: pt[2], k: pt[3] }
}
const orange = async () => { const f = `${OUT}/.px.png`; await cv.screenshot({ path: f }); const { execFileSync } = await import('node:child_process')
  return +execFileSync('python3', ['-c', `from PIL import Image\nim=Image.open('${f}').convert('RGB')\nprint(sum(1 for r,g,b in im.getdata() if r>170 and 70<g<150 and b<110 and r-b>90))`]).toString() }
const countOf = () => d.getByRole('region', { name: '按肌肉找动作' }).locator('span.text-xs').first().innerText()
const banner = () => d.locator('b', { hasText: '已选：' }).first().innerText().catch(() => '')
await d.getByRole('button', { name: '正面', exact: true }).click(); await p.waitForTimeout(700)
const o0 = await orange()
const q = await findPoint('^(quads)$'); ok('quads reachable by ray in front view', !!q, JSON.stringify(q))
if (q) { await p.touchscreen.tap(q.x, q.y); await p.waitForTimeout(700)
  ok('tap front thigh → 已选 shows the tapped muscle (Chinese)', (await banner()).includes(q.zh), await banner())
  const o1 = await orange(); ok('selection highlight is visible orange on canvas', o1 > o0 + 200, `orange px ${o0}→${o1}`); await cv.screenshot({ path: `${OUT}/tap-quads.png` })
  const list = await d.getByRole('region', { name: '按肌肉找动作' }).innerText(); ok('相关动作 list shown for tapped muscle', /相关动作/.test(list) && !/^相关动作\s*0 项/.test(list), list.slice(0, 40).replace(/\n/g, ' '))
  globalThis.tapCount = await countOf() }
// Name-based selection must match the 3D group mapping.
await d.locator('summary', { hasText: '按名称选择肌群' }).click(); await p.waitForTimeout(300)
await d.getByRole('button', { name: q?.zh || '股直肌', exact: true }).first().click(); await p.waitForTimeout(700)
ok(`名称选择 ${q?.zh} → same name as 3D tap`, (await banner()).includes(q?.zh), await banner())
const nameCount = await countOf(); ok('名称选择 and 3D tap give the same related-action count', nameCount === globalThis.tapCount, `${globalThis.tapCount} vs ${nameCount}`)
await cv.screenshot({ path: `${OUT}/name-quads.png` })
// Back view → glutes through the integrated shorts.
await d.getByRole('button', { name: '背面', exact: true }).click(); await p.waitForTimeout(800)
const g = await findPoint('^glutes$'); ok('臀大肌 reachable under shorts in back view', !!g, JSON.stringify(g))
if (g) { await p.touchscreen.tap(g.x, g.y); await p.waitForTimeout(700); ok('tap glutes → 已选：臀大肌', (await banner()).includes('臀大肌'), await banner()); await cv.screenshot({ path: `${OUT}/tap-glutes-back.png` }) }
// Upper-body groups tap-select.
await d.getByRole('button', { name: '正面', exact: true }).click(); await p.waitForTimeout(700)
for (const [k, label, want] of [['^pec_', '胸', /胸大肌/], ['^delt_', '肩', /三角肌/], ['^biceps$', '肱二头', /肱二头/], ['^abs$', '腹', /腹直肌/]]) { const t = await findPoint(k); if (t) { await p.touchscreen.tap(t.x, t.y); await p.waitForTimeout(400) } ok(`tap ${label} (front)`, !!t && want.test(await banner()), t ? `${t.k} ${await banner()}` : 'not found') }
await d.getByRole('button', { name: '背面', exact: true }).click(); await p.waitForTimeout(700)
for (const [k, label, want] of [['^lats$', '背阔肌', /背阔肌/], ['^trap_', '斜方肌', /斜方肌/], ['^hamstrings$', '腘绳肌', /股二头|半腱|半膜/], ['^calves$', '小腿', /腓肠|比目鱼|腓骨/], ['^delt_rear$', '三角肌后束', /三角肌/], ['^triceps$', '肱三头', /肱三头/]]) { const t = await findPoint(k); if (t) { await p.touchscreen.tap(t.x, t.y); await p.waitForTimeout(400) } ok(`tap ${label} (back)`, !!t && want.test(await banner()), t ? `${t.k} ${await banner()}` : 'not found') }
// Head and crotch are blockers: tapping them must not select anything behind them.
await d.getByRole('button', { name: '重置' }).click(); await p.waitForTimeout(700)
const hb = await cv.evaluate(e => { const r = e.getBoundingClientRect(); for (let y = .02; y < .3; y += .01) { const hit = e.__fk.pickAt(r.left + r.width / 2, r.top + r.height * y); if (hit) return { y, k: hit.userData.fk.k } } return null })
ok('front head column picks no facial muscle', !hb || !/frontalis|orbicularis|masseter|zygomaticus|temporalis/.test(hb.k), JSON.stringify(hb))
const crotch = await cv.evaluate(e => { const r = e.getBoundingClientRect(); const out = []; for (let y = .5; y < .62; y += .02) { const hit = e.__fk.pickAt(r.left + r.width / 2, r.top + r.height * y); out.push(hit ? hit.userData.fk.g || hit.userData.fk.k : null) } return out })
ok('front crotch midline never selects a far-side (back) muscle', crotch.every(k => !k || ['adductors', 'quads', 'hip_flexors', 'abs', 'core', 'obliques'].includes(k)), JSON.stringify(crotch))
// Limited rotation, then reset.
const bb = await cv.boundingBox()
for (const [nm, dx] of [['left', -600], ['right', 900]]) { await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.mouse.down(); await p.mouse.move(bb.x + bb.width / 2 + dx, bb.y + bb.height / 2, { steps: 14 }); await p.mouse.up(); await p.waitForTimeout(900)
  const s = await st(); ok(`drag ${nm} clamps to ±30°`, Math.abs(s.azimuth) <= 30.5 && Math.abs(s.azimuth) > 5, `az=${s.azimuth.toFixed(1)}`); await cv.screenshot({ path: `${OUT}/drag-${nm}.png` }) }
const g2 = await findPoint('^(quads)$'); if (g2) { await p.touchscreen.tap(g2.x, g2.y); await p.waitForTimeout(400) }
await d.getByRole('group', { name: '聚焦' }).getByRole('button', { name: '足部' }).click(); await p.waitForTimeout(900); ok('focus 足部', (await st()).focus === 'foot'); await cv.screenshot({ path: `${OUT}/focus-foot.png` })
const f = await findPoint('^(foot_intrinsic|tibialis|peroneals|soleus|gastroc_.*)$'); if (f) { await p.touchscreen.tap(f.x, f.y); await p.waitForTimeout(400) } ok('tap in foot focus selects a foot/ankle muscle', !!f && (await banner()).includes(f.zh), f ? `${f.k} ${await banner()}` : 'none')
await d.getByRole('group', { name: '聚焦' }).getByRole('button', { name: '小腿' }).click(); await p.waitForTimeout(900); ok('focus 小腿', (await st()).focus === 'calf'); await cv.screenshot({ path: `${OUT}/focus-calf.png` })
await d.getByRole('group', { name: '聚焦' }).getByRole('button', { name: '全身' }).click(); await p.waitForTimeout(700); ok('focus 全身', (await st()).focus === 'body')
await d.getByRole('button', { name: '重置' }).click(); await p.waitForTimeout(900)
const sr = await st(); ok('重置 → front, full body, az≈0, selection cleared', sr.view === 'front' && sr.focus === 'body' && Math.abs(sr.azimuth) < 1 && !(await banner()), JSON.stringify({ view: sr.view, focus: sr.focus, az: sr.azimuth, banner: await banner() }))
// Add an action to the draft via the muscle path; finishing must keep the draft.
await d.getByRole('button', { name: '股直肌', exact: true }).first().click(); await p.waitForTimeout(500)
const first = d.getByRole('region', { name: '按肌肉找动作' }).locator('details').first(); const actName = (await first.locator('summary b').innerText()).trim()
await first.locator('summary').click(); await p.waitForTimeout(300)
await first.getByRole('button').filter({ hasNotText: /动作详情|原始来源/ }).first().click(); await p.waitForTimeout(700)
const footer = await d.getByRole('button', { name: /返回训练|完成查看/ }).last().innerText(); ok('添加 → footer counts the selected action', /已选\d+个动作/.test(footer), footer)
await d.getByRole('button', { name: /返回训练|完成查看/ }).last().click(); await p.waitForTimeout(800)
ok('sheet closes and the draft keeps the added action', !(await p.getByRole('dialog', { name: '人体肌群3D' }).count()) && (await p.locator('main, body').first().innerText()).includes(actName), actName)
ok('no page errors (main flow)', p.errs.length === 0, p.errs.slice(0, 2).join('|'))
await c.close()
// Fallback: model asset fails → retry + name list still selects.
{ const { c: c2, p: p2, d: d2 } = await open({ blockModel: true })
  await p2.waitForSelector('text=3D 模型加载失败', { timeout: 30000 }).catch(() => {})
  const t = await d2.innerText(); ok('WebGL failure shows error + 重试', /3D 模型加载失败/.test(t) && /重试/.test(t), t.slice(0, 60).replace(/\n/g, ' '))
  await d2.getByLabel('备用肌群列表').getByRole('button').first().click(); await p2.waitForTimeout(400)
  ok('备用肌群列表 still selects a muscle', /已选：/.test(await d2.innerText()))
  await p2.screenshot({ path: `${OUT}/fallback.png` }); await c2.close() }
await b.close()
fs.writeFileSync(`${OUT}/results-${ENGINE}-${WIDTH}.txt`, R.join('\n') + '\n')
console.log(`${R.filter(x => x.startsWith('PASS')).length}/${R.length} PASS`)
