import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ThemeAvatar } from './theme-avatar'
import { CHARACTER_THEMES } from '@/lib/ui/character-themes'

test('ThemeAvatar: classic = robot, every theme = its own character avatar', () => {
  assert.match(renderToStaticMarkup(createElement(ThemeAvatar, {})), /data-avatar="classic"/)
  assert.match(renderToStaticMarkup(createElement(ThemeAvatar, { theme: 'classic' })), /src="\/fangshen\/care-bust\.png"/)
  for (const t of CHARACTER_THEMES) {
    const html = renderToStaticMarkup(createElement(ThemeAvatar, { theme: t.id }))
    assert.ok(html.includes(`src="${t.avatar}"`), t.id)
    assert.ok(html.includes(`data-avatar="${t.id}"`), t.id)
    assert.ok(!html.includes('fangshen'), t.id)
  }
})

test('health today card and recovery advice use ThemeAvatar, not a hard-coded robot image', () => {
  for (const f of ['../health-page-v89.tsx', '../muscle-recovery-v89.tsx']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8')
    assert.ok(src.includes('<ThemeAvatar'), f)
    assert.ok(!src.includes('care-bust'), f)
  }
})
