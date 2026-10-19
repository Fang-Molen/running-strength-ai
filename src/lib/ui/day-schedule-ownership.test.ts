import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadSchedule, saveSchedule, saveScheduledEntry, readScheduleDocument, SCHEDULE_KEY } from './day-schedule'
import type { ScheduleEntry } from './day-schedule-rules'
import { setStoreBackend } from '../core/storage'
import { setEventContext } from '../core/events'

let data: Map<string, string>
const entry = (id: string, owner?: string): ScheduleEntry => ({ id, ...(owner ? { athleteId: owner } : {}), date: '2026-10-21', kind: 'strength', modality: 'strength', title: id, focus: [], minutes: 30, intensity: 'MODERATE', lowerHeavy: false, source: 'custom', refId: null, status: 'planned' })
beforeEach(() => {
  data = new Map()
  setStoreBackend({ getItem: k => data.get(k) ?? null, setItem: (k,v) => { data.set(k,v) }, keys: () => [...data.keys()] })
  setEventContext({ athleteId: 'athlete-A' })
})
afterEach(() => { setStoreBackend(null); setEventContext({ athleteId: 'local' }) })
test('reads only this athlete; unowned history stays in the local read-only namespace', () => {
  data.set(SCHEDULE_KEY, JSON.stringify({ entries: [entry('A','athlete-A'), entry('B','athlete-B'), entry('old')], acks: ['old-private-ack'] }))
  assert.deepEqual(loadSchedule().entries.map(x=>x.id), ['A']); assert.deepEqual(loadSchedule().acks, [])
  setEventContext({ athleteId: 'local' }); assert.deepEqual(loadSchedule().entries.map(x=>x.id), ['old'])
})
test('saving this athletes calendar preserves all other owners and unowned historical rows', () => {
  const legacy = entry('legacy'), other = entry('B','athlete-B')
  data.set(SCHEDULE_KEY, JSON.stringify({ entries: [legacy,other], acks:['legacy-ack'] }))
  assert.equal(saveSchedule({ entries:[entry('A')], acks:['A-ack'] }), true)
  const raw = JSON.parse(data.get(SCHEDULE_KEY)!)
  assert.deepEqual(raw.entries.find((x:ScheduleEntry)=>x.id==='legacy'), legacy)
  assert.deepEqual(raw.entries.find((x:ScheduleEntry)=>x.id==='B'), other)
  assert.equal(raw.entries.find((x:ScheduleEntry)=>x.id==='A').athleteId,'athlete-A')
  assert.deepEqual(loadSchedule().acks,['A-ack'])
  setEventContext({ athleteId:'athlete-B' }); assert.deepEqual(loadSchedule().acks,[])
})
test('legacy history cannot be silently claimed, edited, or deleted by a normal save', () => {
  const legacy=entry('legacy'); data.set(SCHEDULE_KEY,JSON.stringify({entries:[legacy],acks:[]}))
  const before=data.get(SCHEDULE_KEY)
  assert.equal(saveSchedule({entries:[{...legacy,athleteId:'athlete-A'}],acks:[]}),false)
  assert.equal(data.get(SCHEDULE_KEY),before)
  // C03 合并口径（Grok）：旧无归属行属于本机 local 历史；local 可原地编辑，但不补写 athleteId（不迁移）。
  setEventContext({athleteId:'local'})
  assert.equal(saveSchedule({entries:[{...legacy,title:'rewritten'}],acks:[]}),true)
  const raw=JSON.parse(data.get(SCHEDULE_KEY)!).entries[0]
  assert.equal(raw.title,'rewritten'); assert.equal('athleteId' in raw,false)
})
test('stale in-memory calendar and forged ownership are rejected after account switch', () => {
  assert.equal(saveSchedule({entries:[entry('A')],acks:[]}),true)
  const stale=loadSchedule(),before=data.get(SCHEDULE_KEY)
  setEventContext({athleteId:'athlete-B'})
  assert.equal(saveSchedule(stale),false)
  assert.equal(saveSchedule({entries:[entry('A')],acks:[]}),false)
  assert.equal(data.get(SCHEDULE_KEY),before)
})
test('owner stamping preserves duplicate-save idempotency and rejects stale edits', async () => {
  const original=entry('new')
  assert.equal((await saveScheduledEntry(original)).ok,true)
  assert.equal((await saveScheduledEntry(original)).ok,true)
  assert.equal((await saveScheduledEntry({...original,title:'updated'},original)).ok,true)
  assert.equal((await saveScheduledEntry({...original,title:'stale'},original)).ok,false)
  assert.equal(loadSchedule().entries[0].title,'updated')
})
test('unreadable calendar is not a complete empty query and cannot be overwritten', () => {
  data.set(SCHEDULE_KEY,'{broken')
  assert.equal(readScheduleDocument().ok,false)
  assert.equal(saveSchedule({entries:[entry('replacement')],acks:[]}),false)
  assert.equal(data.get(SCHEDULE_KEY),'{broken')
})
test('a draft queued for a Web Lock cannot be saved under the next athlete', async () => {
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator')
  let queued: (() => unknown) | null = null
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:(_key:string,work:()=>unknown)=>new Promise(resolve=>{queued=()=>resolve(work())})}}})
  try {
    const pending=saveScheduledEntry(entry('A-draft'))
    setEventContext({athleteId:'athlete-B'})
    assert.ok(queued); (queued as () => unknown)()
    const result=await pending
    assert.equal(result.ok,false); assert.equal(data.has(SCHEDULE_KEY),false)
  } finally {
    if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor)
    else delete (globalThis as {navigator?:unknown}).navigator
  }
})
