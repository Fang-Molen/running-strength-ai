import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { commitScheduleRaw, readScheduleRevision, withScheduleLock, SCHEDULE_WRITERS } from './schedule-writer.ts'
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
