import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { commitScheduleRaw, readScheduleRevision, withScheduleLock, SCHEDULE_WRITERS, SCHEDULE_DOC_KEY, SCHEDULE_REVISION_KEY, SCHEDULE_PENDING_WRITE_KEY, lastScheduleFailure } from './schedule-writer.ts'
const box = () => { const d = new Map<string, string>(); return { d, getItem: (k: string) => d.get(k) ?? null, setItem: (k: string, v: string) => { d.set(k, v) } } }
test('CAS write: expected revision must match; content-identical write is not a revision', () => {
  const b = box()
  assert.deepEqual(commitScheduleRaw(b, '{"entries":[]}', 'today-board', 0), { ok: true, rev: 1 })
  assert.deepEqual(commitScheduleRaw(b, '{"entries":[1]}', 'today-board', 0), { ok: false, reason: 'VERSION_CONFLICT' })
  assert.equal(b.d.get('fk-schedule-v1'), '{"entries":[]}', 'conflicting write leaves the document untouched')
  assert.deepEqual(commitScheduleRaw(b, '{"entries":[]}', 'unmarked-plans', 1), { ok: true, rev: 1 })
  assert.equal(readScheduleRevision(b).writer, 'today-board')
})
test('in-page lock serialises async writers when Web Locks are unavailable (reported as not cross-page coordinated)', async () => {
  // Node 24 exposes Web Locks too. Explicitly model the absent capability
  // instead of assuming every Node runtime lacks navigator.locks.
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} })
  try {
  const order: string[] = []
  const a = withScheduleLock(async () => { order.push('a1'); await new Promise(r => setTimeout(r, 10)); order.push('a2') })
  const b = withScheduleLock(() => { order.push('b') })
  const [ra] = await Promise.all([a, b]); assert.deepEqual(order, ['a1', 'a2', 'b']); assert.equal(ra.coordinated, false)
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor)
    else Reflect.deleteProperty(globalThis, 'navigator')
  }
})
test('every source writer of fk-schedule-v1 goes through the central schedule writer with its writer label', () => {
  const files: Record<string, string> = { 'today-board': 'src/components/today-board.tsx', 'today-board-sync': 'src/components/today-board.tsx', 'onboarding-r8': 'src/components/r8.tsx', 'unmarked-plans': 'src/components/unmarked-plans.tsx', 'schedule-progress': 'src/lib/ui/schedule-progress.ts', 'guided-discard': 'src/lib/ui/guided-discard.ts', 'scheduled-entry': 'src/lib/ui/day-schedule.ts' }
  for (const w of SCHEDULE_WRITERS) assert.match(readFileSync(files[w], 'utf8'), new RegExp(`(?:saveSchedule|updateSchedule)\\([^;]*'${w}'(?:,|\\))`), w)
  const ds = readFileSync('src/lib/ui/day-schedule.ts', 'utf8')
  assert.match(ds, /commitScheduleRaw\(box, raw, writer\)/); assert.doesNotMatch(ds, /setItem\(SCHEDULE_KEY/)
})

test('metadata failure never claims saved; retry repairs the same write exactly once',()=>{
 const b=box();let fail=true
 const store={getItem:b.getItem,setItem:(k:string,v:string)=>{if(k==='fk-schedule-v1-rev'&&fail)throw new Error('quota');b.setItem(k,v)}}
 assert.deepEqual(commitScheduleRaw(store,'{"entries":[1]}','today-board'),{ok:false,reason:'WRITE_FAILED'})
 assert.equal(readScheduleRevision(store).rev,0)
 assert.equal(b.getItem('fk-schedule-v1'),'{"entries":[1]}')
 fail=false
 assert.deepEqual(commitScheduleRaw(store,'{"entries":[1]}','today-board'),{ok:true,rev:1})
 assert.deepEqual(commitScheduleRaw(store,'{"entries":[1]}','today-board'),{ok:true,rev:1})
})
test('silent metadata loss is detected and failed intent does not alter the document',()=>{
 const b=box()
 const drop={getItem:b.getItem,setItem:(k:string,v:string)=>{if(k!=='fk-schedule-v1-rev')b.setItem(k,v)}}
 assert.deepEqual(commitScheduleRaw(drop,'{"entries":[]}','today-board'),{ok:false,reason:'WRITE_FAILED'})
 const c=box();const rejectIntent={getItem:c.getItem,setItem:()=>{}}
 assert.deepEqual(commitScheduleRaw(rejectIntent,'{"entries":[]}','today-board'),{ok:false,reason:'WRITE_FAILED'})
 assert.equal(c.getItem('fk-schedule-v1'),null)
})
test('recovery cannot overwrite a newer document or silently reset a corrupt revision',()=>{
 const b=box();const fail={getItem:b.getItem,setItem:(k:string,v:string)=>{if(k==='fk-schedule-v1-rev')throw new Error('quota');b.setItem(k,v)}}
 commitScheduleRaw(fail,'{"entries":[1]}','today-board')
 b.setItem('fk-schedule-v1','{"entries":[2]}')
 assert.deepEqual(commitScheduleRaw(b,'{"entries":[3]}','today-board'),{ok:false,reason:'VERSION_CONFLICT'})
 assert.equal(b.getItem('fk-schedule-v1'),'{"entries":[2]}')
 const c=box();c.setItem('fk-schedule-v1-rev','{bad')
 assert.deepEqual(commitScheduleRaw(c,'{"entries":[]}','today-board'),{ok:false,reason:'WRITE_FAILED'})
 assert.equal(c.getItem('fk-schedule-v1'),null)
})

// ---- v89.11.13：待提交记录改为只存哈希（旧格式遗留仍可恢复） ----
import { sha256Hex } from '../core/sha256-sync'
import { createHash } from 'node:crypto'
test('v89.11.13 sha256Hex 与 node:crypto 一致（含中文、空串、跨块长度）', () => {
  for (const t of ['', 'abc', '方坤'.repeat(50), 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'y'.repeat(10_000)]) assert.equal(sha256Hex(t), createHash('sha256').update(t).digest('hex'))
})
function memBox() { const d = new Map<string, string>(); return { d, box: { getItem: (k: string) => d.get(k) ?? null, setItem: (k: string, v: string) => { d.set(k, v) } } } }
test('v89.11.13 新格式 pending 只含哈希，体积固定很小；成功后清为 null', () => {
  const m = memBox(); const big = JSON.stringify({ entries: 'z'.repeat(500_000) })
  const seen: number[] = []; const orig = m.box.setItem; m.box.setItem = (k, v) => { if (k === SCHEDULE_PENDING_WRITE_KEY) seen.push(v.length); orig(k, v) }
  m.d.set(SCHEDULE_DOC_KEY, big); assert.equal(commitScheduleRaw(m.box, big + ' ', 'today-board').ok, true)
  assert.ok(seen[0] < 400, `pending ${seen[0]}`); assert.equal(m.d.get(SCHEDULE_PENDING_WRITE_KEY), 'null')
  const first = JSON.parse(m.d.get(SCHEDULE_REVISION_KEY)!); assert.equal(first.rev, 1)
})
test('v89.11.13 中断恢复：新格式（文档已写、版本号未写）补写版本号；文档未写则清除；被别处改过则 E-PENDING-DOC', () => {
  const m = memBox(); const before = '{"entries":[]}', after = '{"entries":[1]}', revision = JSON.stringify({ rev: 1, writer: 'today-board', at: 'x' })
  const intent = JSON.stringify({ schema: 2, beforeHash: sha256Hex(before), afterHash: sha256Hex(after), previousRevision: null, revision })
  m.d.set(SCHEDULE_DOC_KEY, after); m.d.set(SCHEDULE_PENDING_WRITE_KEY, intent)
  assert.equal(commitScheduleRaw(m.box, after, 'today-board').ok, true); assert.equal(m.d.get(SCHEDULE_REVISION_KEY), revision); assert.equal(m.d.get(SCHEDULE_PENDING_WRITE_KEY), 'null')
  const m2 = memBox(); m2.d.set(SCHEDULE_DOC_KEY, before); m2.d.set(SCHEDULE_PENDING_WRITE_KEY, intent)
  assert.equal(commitScheduleRaw(m2.box, after, 'today-board').ok, true); assert.equal(m2.d.get(SCHEDULE_DOC_KEY), after)
  const m3 = memBox(); m3.d.set(SCHEDULE_DOC_KEY, '{"entries":[9]}'); m3.d.set(SCHEDULE_PENDING_WRITE_KEY, intent)
  assert.equal(commitScheduleRaw(m3.box, after, 'today-board').ok, false); assert.equal(lastScheduleFailure()?.code, 'E-PENDING-DOC'); assert.equal(m3.d.get(SCHEDULE_PENDING_WRITE_KEY), intent)
})
test('v89.11.13 旧格式（schema 1）遗留 pending 升级后仍能恢复', () => {
  const m = memBox(); const before = '{"entries":[]}', after = '{"entries":[1]}', revision = JSON.stringify({ rev: 1, writer: 'today-board', at: 'x' })
  m.d.set(SCHEDULE_DOC_KEY, after); m.d.set(SCHEDULE_PENDING_WRITE_KEY, JSON.stringify({ schema: 1, before, after, previousRevision: null, revision }))
  assert.equal(commitScheduleRaw(m.box, after, 'today-board').ok, true); assert.equal(m.d.get(SCHEDULE_REVISION_KEY), revision)
  const m2 = memBox(); m2.d.set(SCHEDULE_PENDING_WRITE_KEY, JSON.stringify({ schema: 2, beforeHash: null, afterHash: sha256Hex(after), previousRevision: null, revision })); m2.d.set(SCHEDULE_DOC_KEY, after)
  assert.equal(commitScheduleRaw(m2.box, after, 'today-board').ok, true, '无前文档的新格式也能恢复')
  const m4 = memBox(); m4.d.set(SCHEDULE_PENDING_WRITE_KEY, JSON.stringify({ schema: 2, beforeHash: 5 })); assert.equal(commitScheduleRaw(m4.box, after, 'today-board').ok, false); assert.equal(lastScheduleFailure()?.code, 'E-PENDING-BAD')
})
