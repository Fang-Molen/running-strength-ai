import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CoachPet } from './coach-pet'
import { ChiyanStill } from './chiyan-still'
import { PET_MOODS, petMoodForAnswer, petMoodFromChat } from './mood'
import { PET_ENABLED } from './config'

const coach = (id: string, text: string) => ({ id, role: 'coach', text })

test('mood mapping: waiting, empty chat, safety, rest, done, local knowledge, fallback, default', () => {
  assert.equal(petMoodFromChat({ sending: true, messages: [{ id: 'u', role: 'user', text: '下周怎么练' }] }), 'analyzing')
  assert.equal(petMoodFromChat({ messages: undefined }), 'hello')
  assert.equal(petMoodFromChat({ messages: [coach('hi', '你好')] }), 'hello')
  assert.equal(petMoodForAnswer(coach('1-local', '胸痛请先停止训练并就医')), 'recovery')
  assert.equal(petMoodForAnswer(coach('1-local', '昨晚睡眠不足，今天建议减量休息')), 'rest')
  assert.equal(petMoodForAnswer(coach('1', '这节课已记录')), 'done')
  assert.equal(petMoodForAnswer(coach('1-local', '轻松跑用来建立有氧基础')), 'suggest')
  assert.equal(petMoodForAnswer(coach('1-online', '联网解释')), 'think')
  assert.equal(petMoodForAnswer(coach('1-fallback', '暂时连不上')), 'question')
  assert.equal(petMoodForAnswer(coach('1', '做得好，继续保持')), 'encourage')
  assert.equal(petMoodForAnswer(coach('1', '好的')), 'hello')
  assert.equal(petMoodFromChat({ messages: [coach('a-local', '间歇跑的休息'), { id: 'u2', role: 'user', text: '嗯' }] }), 'hello')
  for (const m of PET_MOODS) assert.ok(typeof m === 'string')
})

test('CoachPet renders a lazy decorative image per mood; ChiyanStill labels gender honestly', () => {
  assert.equal(PET_ENABLED, true)
  const html = renderToStaticMarkup(createElement(CoachPet, { mood: 'think' }))
  assert.match(html, /src="\/fangkun-pet\/chiyan\/think\.webp"/)
  assert.match(html, /loading="lazy"/)
  assert.match(html, /aria-hidden="true"/)
  const male = renderToStaticMarkup(createElement(ChiyanStill, { gender: 'male', fallbackSrc: '/x.webp', fallbackAlt: 'a', className: 'c' }))
  assert.match(male, /chiyan-fullbody\.webp/); assert.match(male, /不随滑杆变形/)
  const female = renderToStaticMarkup(createElement(ChiyanStill, { gender: 'female', fallbackSrc: '/female.webp', fallbackAlt: 'a', className: 'c' }))
  assert.match(female, /src="\/female\.webp"/); assert.match(female, /女版形象待制作/); assert.ok(!female.includes('chiyan-fullbody'))
})

// --- v89.11.4：头像位置只保留一个 ---
import { readFileSync } from 'node:fs'
import { CoachAvatar } from './coach-avatar'
const robot = createElement('img', { 'data-fang-face': 'happy', alt: '方坤，开心' })
const avatarOf = (theme: Parameters<typeof CoachAvatar>[0]['theme'], extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(CoachAvatar, { theme, mood: 'think', classic: robot, ...extra }))
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length

test('classic theme: exactly one avatar and it is the robot (no pet, no theme art)', () => {
  const html = avatarOf('classic')
  assert.equal(count(html, /data-testid="coach-avatar"/g), 1)
  assert.match(html, /data-avatar="classic"/); assert.match(html, /data-fang-face/)
  assert.ok(!html.includes('coach-pet')); assert.ok(!html.includes('/assets/fangkun/themes/'))
})

test('chiyan theme: one avatar, the pet, no robot; bubble variant is a still without pet', () => {
  const html = avatarOf('chiyan')
  assert.equal(count(html, /data-testid="coach-avatar"/g), 1)
  assert.match(html, /data-avatar="pet"/); assert.match(html, /data-testid="coach-pet"/); assert.match(html, /chiyan\/think\.webp/)
  assert.ok(!html.includes('data-fang-face'))
  const bubble = avatarOf('chiyan', { size: 'bubble', pet: false })
  assert.ok(!bubble.includes('coach-pet')); assert.ok(!bubble.includes('data-fang-face')); assert.match(bubble, /chiyan-avatar\.webp/)
})

test('all seven themes: exactly one avatar, that role\'s mood image, no robot', () => {
  for (const id of ['chiyan', 'xuanjin', 'lingyue', 'qingye', 'anlan', 'liuguang', 'shanyue'] as const) {
    const html = avatarOf(id)
    assert.equal(count(html, /data-testid="coach-avatar"/g), 1, id)
    assert.match(html, new RegExp(`data-role="${id}"`)); assert.match(html, new RegExp(`/fangkun-pet/${id}/think\\.webp`)); assert.ok(!html.includes('data-fang-face'))
    const bubble = avatarOf(id, { size: 'bubble', pet: false })
    assert.equal(count(bubble, /data-testid="coach-avatar"/g), 1); assert.match(bubble, new RegExp(`${id}-avatar\\.webp`)); assert.ok(!bubble.includes('coach-pet'))
  }
})

import { existsSync } from 'node:fs'
import { PET_ROLES, petMoodSrc, petRoleForTheme, type PetRoleId } from './config'
import { CHARACTER_THEMES } from '@/lib/ui/character-themes'
import { THEME_CARDS } from '../appearance-settings'
const pub = (p: string) => fileURLToPath(new URL('../../../public' + p, import.meta.url))
import { fileURLToPath } from 'node:url'

test('8 pet roles (robot + 7 themes): each resolves 12 mood images and a full-body image, all files exist', () => {
  const ids = Object.keys(PET_ROLES) as PetRoleId[]
  assert.equal(ids.length, 8); assert.equal(PET_MOODS.length, 12)
  for (const id of ids) {
    for (const m of PET_MOODS) { const src = petMoodSrc(id, m); assert.equal(src, `/fangkun-pet/${id}/${m}.webp`); assert.ok(existsSync(pub(src)), src) }
    assert.ok(existsSync(pub(PET_ROLES[id].fullbody)), PET_ROLES[id].fullbody)
  }
  assert.equal(petRoleForTheme('classic'), 'robot'); assert.equal(petRoleForTheme('nope'), 'robot'); assert.equal(petRoleForTheme(undefined), 'robot'); assert.equal(petRoleForTheme('constructor'), 'robot')
  for (const t of CHARACTER_THEMES) { assert.equal(petRoleForTheme(t.id), t.id); assert.equal(PET_ROLES[t.id].name, t.name); assert.ok(existsSync(pub(t.avatar)), t.avatar) }
})

test('appearance settings: 8 cards (classic first + 7 themes), each with a happy image and three swatches', () => {
  assert.equal(THEME_CARDS.length, 8); assert.equal(THEME_CARDS[0].id, 'classic'); assert.equal(THEME_CARDS[0].role, 'robot')
  assert.equal(new Set(THEME_CARDS.map(c => c.id)).size, 8)
  for (const c of THEME_CARDS) { assert.equal(c.swatches.length, 3); assert.ok(existsSync(pub(petMoodSrc(c.role, 'happy')))) }
})

test('wiring: coach sheet uses CoachAvatar only (no direct pet), app title avatar hidden on coach tab', () => {
  const sheet = readFileSync(new URL('../coach-sheet.tsx', import.meta.url), 'utf8')
  assert.ok(!/<CoachPet\b/.test(sheet)); assert.equal(count(sheet, /<CoachAvatar\b/g), 2)
  const app = readFileSync(new URL('../strength-app.tsx', import.meta.url), 'utf8')
  assert.match(app, /characterTheme !== "classic" && tab !== "coach" \? <img className="fk-coach-theme-avatar"/)
  assert.match(app, /<CoachSheet embedded characterTheme=\{characterTheme\}/)
})
