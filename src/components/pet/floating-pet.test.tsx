import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { FloatingPet, PetVisibleToggle } from './floating-pet'
import { FLOATING_PET_ENABLED, FLOATING_PET_POS_KEY, FLOATING_PET_VISIBLE_KEY } from './config'
import { petMoodForPage, PAGE_MOODS } from './page-mood'
import { PET_MOODS } from './mood'
import { PET_TIPS, bubbleReducer, clampPos, initialBubble, moodForBubble, parsePos, readPetPos, readPetVisible, shouldShowFloatingPet, writePetPos, writePetVisible } from './floating-pet-logic'

const render = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(FloatingPet, { theme: 'chiyan', visible: true, reducedMotion: false, ...props } as never))
const memStore = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) } } }

test('floating pet: shown for every theme with that theme\'s own role (classic = robot)', () => {
  assert.equal(FLOATING_PET_ENABLED, true)
  const html = render({})
  assert.match(html, /data-testid="floating-pet"/); assert.match(html, /chiyan\/hello\.webp/)
  assert.match(html, /touch-action:none/)
  assert.match(render({ theme: 'classic' }), /data-role="robot"[^>]*>[\s\S]*robot\/hello\.webp/)
  for (const t of ['xuanjin', 'lingyue', 'qingye', 'anlan', 'liuguang', 'shanyue']) {
    const h = render({ theme: t, page: 'diet' })
    assert.match(h, new RegExp(`data-role="${t}"`), t); assert.match(h, new RegExp(`/fangkun-pet/${t}/water\\.webp`), t)
    assert.equal((h.match(/data-testid="floating-pet"/g) ?? []).length, 1)
  }
  assert.equal(render({ theme: 'unknown-theme' }).includes('robot/hello.webp'), true)
})

test('floating pet: hidden on coach tab, when master switch is off, and when the user hid it', () => {
  assert.equal(render({ onCoachTab: true }), '')
  assert.equal(render({ enabled: false }), '')
  assert.equal(render({ visible: false }), '')
  assert.equal(shouldShowFloatingPet({ enabled: true, petEnabled: false, theme: 'chiyan', onCoachTab: false, visible: true }), false)
  assert.equal(shouldShowFloatingPet({ enabled: true, petEnabled: true, theme: 'chiyan', onCoachTab: false, visible: true }), true)
  assert.equal(shouldShowFloatingPet({ enabled: true, petEnabled: true, theme: 'classic', onCoachTab: false, visible: true }), true)
})

test('floating pet: visibility is read from fk-pet-visible-v1 (only "0" hides)', () => {
  const s = memStore()
  assert.equal(FLOATING_PET_VISIBLE_KEY, 'fk-pet-visible-v1'); assert.equal(FLOATING_PET_POS_KEY, 'fk-pet-pos-v1')
  assert.equal(readPetVisible(s, FLOATING_PET_VISIBLE_KEY), true)
  writePetVisible(s, FLOATING_PET_VISIBLE_KEY, false); assert.equal(readPetVisible(s, FLOATING_PET_VISIBLE_KEY), false)
  assert.equal(renderToStaticMarkup(createElement(FloatingPet, { theme: 'chiyan', storage: s as never, reducedMotion: false })), '')
  writePetVisible(s, FLOATING_PET_VISIBLE_KEY, true)
  assert.match(renderToStaticMarkup(createElement(FloatingPet, { theme: 'chiyan', storage: s as never, reducedMotion: false })), /floating-pet/)
})

test('tap shows a fixed gentle tip bubble with a hide button and changes mood; closing restores idle mood', () => {
  const tapped = bubbleReducer(initialBubble, { type: 'tap' })
  assert.equal(tapped.open, true); assert.equal(tapped.tip, 0)
  assert.equal(moodForBubble(tapped), PET_TIPS[0].mood); assert.notEqual(moodForBubble(tapped), moodForBubble(initialBubble))
  const second = bubbleReducer(tapped, { type: 'tap' }); assert.equal(second.tip, 1)
  const closed = bubbleReducer(second, { type: 'close' })
  assert.equal(closed.open, false); assert.equal(moodForBubble(closed), 'hello')
  let s = initialBubble; for (let i = 0; i < PET_TIPS.length; i++) s = bubbleReducer(s, { type: 'tap' })
  assert.equal(bubbleReducer(s, { type: 'tap' }).tip, 0, 'tips cycle')
  const html = render({ initialBubble: tapped })
  assert.match(html, /data-testid="floating-pet-bubble"/); assert.ok(html.includes(PET_TIPS[0].text)); assert.match(html, /data-testid="floating-pet-hide"/); assert.match(html, /data-testid="floating-pet-hide"[^>]*>收起<\/button>/); assert.ok(!html.includes("外观设置里可重新打开"))
  assert.match(html, new RegExp(`chiyan/${PET_TIPS[0].mood}\\.webp`)); assert.match(html, /fk-fpet-bounce/)
  assert.ok(!render({}).includes('floating-pet-bubble'))
  for (const t of PET_TIPS) assert.ok(!/联网|模型|计划已|已改/.test(t.text), 'tips are plain local text, no claims')
})

test('reduced motion: no animation classes; normal: breathe + blink; talking adds bounce', () => {
  const calm = render({ reducedMotion: true, initialBubble: bubbleReducer(initialBubble, { type: 'tap' }) })
  assert.match(calm, /data-motion="off"/); assert.ok(!/class="[^"]*fk-fpet-(breathe|blink|bounce)/.test(calm))
  const idle = render({})
  assert.match(idle, /data-motion="on"/); assert.match(idle, /class="[^"]*fk-fpet-breathe/); assert.match(idle, /class="[^"]*fk-fpet-blink/); assert.ok(!/class="[^"]*fk-fpet-bounce/.test(idle))
  assert.match(idle, /prefers-reduced-motion:reduce/, 'CSS also disables animation')
})

test('position: clamped on screen above the dock, stored and parsed safely', () => {
  const view = { w: 390, h: 800 }, size = { w: 52, h: 68 }
  assert.deepEqual(clampPos({ x: -50, y: -50 }, view, size), { x: 4, y: 8 })
  const far = clampPos({ x: 9999, y: 9999 }, view, size)
  assert.ok(far.x + size.w <= view.w && far.y + size.h <= view.h - 60)
  assert.deepEqual(clampPos({ x: 100, y: 200 }, view, size), { x: 100, y: 200 })
  const s = memStore(); assert.equal(readPetPos(s, FLOATING_PET_POS_KEY), null)
  writePetPos(s, FLOATING_PET_POS_KEY, { x: 120.4, y: 300.6 }); assert.deepEqual(readPetPos(s, FLOATING_PET_POS_KEY), { x: 120, y: 301 })
  assert.equal(parsePos('not json'), null); assert.equal(parsePos('{"x":"a","y":1}'), null); assert.equal(parsePos(null), null)
})

test('settings toggle: visible for every theme, honours master switch, shows state', () => {
  const tg = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(PetVisibleToggle, props as never))
  assert.match(tg({ theme: 'chiyan', initialVisible: true }), /显示悬浮桌宠：已开/)
  assert.match(tg({ theme: 'chiyan', initialVisible: false }), /显示悬浮桌宠：已关/)
  assert.match(tg({ theme: 'classic', initialVisible: true }), /显示悬浮桌宠/); assert.match(tg({ initialVisible: true }), /显示悬浮桌宠/); assert.equal(tg({ theme: 'chiyan', enabled: false }), '')
})

test('wiring: app shell has one import + one use; settings has one import + one use; no network or answer code in the pet', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
  const app = read('../strength-app.tsx')
  assert.equal((app.match(/floating-pet"/g) ?? []).length, 1); assert.equal((app.match(/<FloatingPet\b/g) ?? []).length, 1)
  assert.match(app, /<FloatingPet theme=\{characterTheme\} page=\{tab\} onCoachTab=\{tab === "coach"\} \/>/)
  const set = read('../appearance-settings.tsx')
  assert.equal((set.match(/<PetVisibleToggle\b/g) ?? []).length, 1)
  assert.match(set, /THEME_CARDS\.map\(/)
  const src = read('./floating-pet.tsx') + read('./floating-pet-logic.ts')
  assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon|coach-chat/.test(src))
  const sw = read('../../../public/sw.js'); assert.ok(!/fangkun-pet/.test(sw), 'no image precache')
})

test('page → mood mapping (only the existing 12 moods) and floating pet follows the page', () => {
  assert.deepEqual(['today', 'plan', 'courses', 'log', 'body', 'diet'].map(petMoodForPage), ['hello', 'suggest', 'sprint', 'analyzing', 'rest', 'water'])
  assert.equal(petMoodForPage('settings'), 'hello'); assert.equal(petMoodForPage('whatever'), 'hello'); assert.equal(petMoodForPage(undefined), 'hello'); assert.equal(petMoodForPage('constructor'), 'hello')
  for (const m of Object.values(PAGE_MOODS)) assert.ok((PET_MOODS as readonly string[]).includes(m))
  const on = (page: string) => render({ page })
  assert.match(on('diet'), /chiyan\/water\.webp/); assert.match(on('body'), /chiyan\/rest\.webp/); assert.match(on('courses'), /chiyan\/sprint\.webp/)
  assert.match(on('plan'), /chiyan\/suggest\.webp/); assert.match(on('log'), /data-page="log"/)
  assert.match(render({ page: 'diet', initialDone: true }), /chiyan\/done\.webp/, 'done flash after a save')
  assert.match(render({ page: 'diet', initialBubble: bubbleReducer(initialBubble, { type: 'tap' }) }), new RegExp(`chiyan/${PET_TIPS[0].mood}\\.webp`), 'tap mood wins over page mood')
  assert.match(render({ initialHop: true }), /fk-fpet-hop/); assert.ok(!/fk-fpet-hop"/.test(render({ initialHop: true, reducedMotion: true })) && !/class="[^"]*fk-fpet-hop/.test(render({ initialHop: true, reducedMotion: true })))
  assert.equal(render({ page: 'coach', onCoachTab: true }), '')
})
