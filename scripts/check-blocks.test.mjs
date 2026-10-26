import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { BLOCKS } from './blocks.mjs'
import { checkBlock } from './check-blocks.mjs'
test('every block passes its import boundary and lists existing tests', () => {
  for (const name of Object.keys(BLOCKS)) {
    assert.deepEqual(checkBlock(name), [], name)
    for (const t of BLOCKS[name].tests) if (!t.includes('*')) assert.ok(existsSync(t), `${name}: ${t}`)
  }
})
test('plan-execution host stays UNCOORDINATED / calendar UNKNOWN (改课确认与撤销保持阻断)', () => {
  const host = readFileSync('src/lib/coach/plan-execution/host.ts', 'utf8')
  assert.doesNotMatch(host, /persistenceBoundary:\s*['"]COORDINATED_LOCAL['"]/)
  assert.doesNotMatch(host, /calendarCoverage:\s*['"]COMPLETE['"]/)
  assert.doesNotMatch(host, /['"]ALLOW_DATE_MOVE['"]/)
})
test('online coach stays default ON and client cap equals trusted server rejection limit', () => {
  const c = readFileSync('src/lib/coach/online-coach.ts', 'utf8'), s = readFileSync('server/coach-deepseek/lib/coach-request-boundary.ts', 'utf8')
  const values = JSON.parse(execFileSync(process.execPath, ['--import', './scripts/test-register.mjs', '--input-type=module', '-e', `
    import { setStoreBackend } from './src/lib/core/storage.ts';
    import { onlineSetting, setOnline } from './src/lib/coach/online-coach.ts';
    const m=new Map();setStoreBackend({getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)});
    const defaultOn=onlineSetting().on;setOnline(false);console.log(JSON.stringify({defaultOn,afterOff:onlineSetting().on}));
  `], {encoding:'utf8'}))
  assert.deepEqual(values, {defaultOn:true,afterOff:false})
  const cap = Number(/ONLINE_QUESTION_MAX = (\d+)/.exec(c)?.[1]), server = Number(/body\.question\.length > (\d+)/.exec(s)?.[1])
  assert.ok(Number.isFinite(cap) && Number.isFinite(server))
  assert.equal(cap, server)
})
test('knowledge complete package stays PENDING with zero production approvals (no self-approval)', () => {
  const cards = JSON.parse(readFileSync('knowledge/coach-complete-20261020/knowledge_cards.json', 'utf8'))
  assert.equal(cards.length, 48)
  assert.ok(cards.every(c => c.professional_review === 'PENDING' && c.production_eligible === false))
  const src = readFileSync('src/lib/coach/knowledge/complete.ts', 'utf8')
  assert.match(src, /const approvedCardVersions: ReadonlySet<string> = new Set<string>\(\)/)
  assert.doesNotMatch(src, /approvedCardVersions\.add|approvedForProduction:\s*[1-9]/)
})
