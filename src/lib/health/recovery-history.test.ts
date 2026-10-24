import test from 'node:test'
import assert from 'node:assert/strict'
import { setStoreBackend } from '../core/storage'
import { currentAthleteId, setEventContext } from '../core/events'
import { createTrainingImportDraft, confirmTrainingImport } from '../core/training-import'
import { readRecoveryTrainingHistory } from './recovery-history'

const field = <T>(value:T) => ({value,status:'RECORDED' as const,sourceIds:['user-confirmed']})
test('history reads older confirmed strength and runs without labelling them current muscle load or leaking owners', t => {
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-24T12:00:00Z')})
  const owner=currentAthleteId(), descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage')
  const map=new Map<string,string>(), store={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v)},keys:()=>[...map.keys()]}
  setStoreBackend(store);setEventContext({athleteId:'history-a'})
  Object.defineProperty(globalThis,'localStorage',{value:store,configurable:true})
  t.after(()=>{setStoreBackend(null);setEventContext({athleteId:owner});if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);else Reflect.deleteProperty(globalThis,'localStorage')})
  for (const [date,sport] of [['2026-10-24','RUNNING'],['2026-10-23','RUNNING'],['2026-10-18','STRENGTH'],['2026-10-14','RUNNING']] as const) {
    const d=createTrainingImportDraft({sport,totalDistanceMeters:sport==='RUNNING'?field(3000):undefined,durationSeconds:field(1200),occurredAt:field(date+'T08:00:00Z'),title:field('合成历史训练 '+date),strengthSets:sport==='STRENGTH'?[{id:'s1',exerciseName:field('深蹲'),setOrdinal:field(1),weightKg:field(40),repetitions:field(8),completion:'COMPLETED',sourceIds:['user-confirmed']}]:[]},'TEXT',['user-confirmed'])
    const saved = confirmTrainingImport(d); assert.ok(saved.ok, JSON.stringify(saved))
  }
  const before=[...map],short=readRecoveryTrainingHistory('2026-10-24','2026-10-24T12:00:00Z',72),long=readRecoveryTrainingHistory('2026-10-24','2026-10-24T12:00:00Z',336)
  assert.equal(short.rows.length,2);assert.equal(long.rows.length,4)
  assert.equal(long.rows.filter(r=>r.status==='HISTORICAL').length,2)
  assert.equal(long.rows.filter(r=>r.status==='DETAILS_NEEDED').length,2)
  assert.equal(long.projection.review.regions.some(r=>r.strengthEventIds.length),false)
  assert.equal(long.rows.find(r=>r.modality==='STRENGTH')?.actualSets,1)
  assert.deepEqual(long.projection.review.regions, short.projection.review.regions)
  assert.deepEqual(long.projection.exposure.training, short.projection.exposure.training)
  assert.deepEqual([...map],before)
  setEventContext({athleteId:'history-b'})
  assert.equal(readRecoveryTrainingHistory('2026-10-24','2026-10-24T12:00:00Z',336).rows.length,0)
})
