import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { HealthPageV89 } from './health-page-v89'
import { setStoreBackend } from '../lib/core/storage'
import { setEventContext } from '../lib/core/events'

let data: Map<string, string>
beforeEach(() => { data = new Map(); setStoreBackend({ getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v) }, keys: () => [...data.keys()] }); setEventContext({ athleteId: 'synthetic-health-ui' }) })
afterEach(() => { setStoreBackend(null); setEventContext({ athleteId: 'local' }) })
const render = () => renderToStaticMarkup(createElement(HealthPageV89, { body: createElement('i', { id: 'body-slot' }), grid: null, stats: null, rest: () => null, trend: () => null }))

test('health page: recovery overview comes before the pain tracker, both tabs and the pain tracker are still present, read-only render', () => {
  const before = [...data]; const html = render(); assert.deepEqual([...data], before)
  const overview = html.indexOf('今日恢复状态'), pain = html.indexOf('疼痛与酸痛追踪'), body = html.indexOf('id="health-body"')
  assert.ok(overview > 0 && pain > overview, 'overview first')
  assert.equal(html.split('data-testid="r5-symptoms"').length - 1, 1, 'single pain tracker, not duplicated per tab')
  assert.ok(body > 0 && pain > body, 'pain tracker follows both tab bodies')
  assert.match(html, /恢复与趋势/); assert.match(html, /身体与记录/)
})
test('health page: missing data is shown as missing, never as a zero reading', () => {
  const html = render()
  assert.doesNotMatch(html, /h89-tile-[A-Z]+[^>]*>[^<]*<p[^>]*>[^<]*<\/p><p[^>]*><b[^>]*>0</)
  assert.match(html, /暂无|证据不足|数据不足|读取健康记录失败/)
})
