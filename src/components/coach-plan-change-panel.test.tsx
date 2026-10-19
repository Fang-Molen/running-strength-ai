import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CoachPlanChangePanel } from './coach-plan-change-panel'

test('plan panel initial render exposes blocked local boundary and existing compact details UI', () => {
  const html = renderToStaticMarkup(createElement(CoachPlanChangePanel, { revision: 'synthetic-test' }))
  assert.match(html, /^<details /)
  assert.ok(html.includes('尚无法可靠核对完整安排与最新状态，尚未修改'))
  assert.ok(html.includes('当前本机档案'))
  assert.ok(!html.includes('服务端鉴权'))
  assert.ok(!html.includes('UNCOORDINATED'))
  assert.ok(html.includes('待调整的日程分项'))
  assert.ok(html.includes('拟调整到的日期'))
  assert.ok(html.includes('刷新本机提案与回执'))
  assert.ok(html.includes('本机调整记录与撤销'))
  assert.ok(!html.includes('已调整成功'))
})
