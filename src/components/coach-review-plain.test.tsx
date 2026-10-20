import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CoachReviewPlain } from './coach-review-plain'

test('plain review card: section titles visible, evidence collapsed behind 查看依据', () => {
  const html = renderToStaticMarkup(createElement(CoachReviewPlain, { plain: { sections: [{ key: 'how', title: '这次练得怎么样', lines: ['每组用时：78 → 85 秒'], emphasis: '4×400米' }, { key: 'need', title: '还需要你补什么', lines: ['整节课有多吃力'] }], evidence: '本次事实：x' } }))
  assert.ok(html.includes('这次练得怎么样') && html.includes('text-accent') && html.includes('<li'))
  assert.match(html, /<details data-testid="review-evidence"[^>]*><summary[^>]*>查看依据<\/summary>/)
  assert.ok(!/<details[^>]* open/.test(html))
  assert.ok(html.indexOf('本次事实') > html.indexOf('查看依据'))
  // 说明小字不用被全局隐藏的 text-muted
  assert.ok(!html.includes('text-muted'))
})
