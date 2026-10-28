import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { CoachSheet } from './coach-sheet'

const plan = { sessions: [] } as never
const store = new Map<string, string>()
;(globalThis as { sessionStorage?: unknown }).sessionStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) }, removeItem: (k: string) => { store.delete(k) } }

test('chat input restores an unsent draft after leaving and returning; nothing is sent by rendering', () => {
  store.set('fk-coach-draft-v1', '还没发出去的问题')
  const html = renderToStaticMarkup(createElement(CoachSheet, { plan, embedded: true, onClose: () => {} }))
  assert.match(html, /value="还没发出去的问题"/)
  assert.doesNotMatch(html, /回到最新/, 'no jump button until a reply arrives while the user is reading above')
  store.clear()
  assert.doesNotMatch(renderToStaticMarkup(createElement(CoachSheet, { plan, embedded: true, onClose: () => {} })), /value="还没发出去的问题"/)
})
test('context chip is driven by an explicit seed and removal only clears an untouched seed (source contract)', () => {
  const src = readFileSync(new URL('./coach-sheet.tsx', import.meta.url), 'utf8')
  assert.match(src, /if \(draft === contextChip\.seed\) setDraft\(""\)/)
  assert.match(src, /nearBottom\.current \|\| lastRole === "user"/, 'own messages always scroll; replies do not yank a reader who scrolled up')
  const app = readFileSync(new URL('./strength-app.tsx', import.meta.url), 'utf8')
  assert.match(app, /健康 · \$\{Number\(day\.slice\(5, 7\)\)\}月/, 'health → coach carries the selected day')
})
