import test from 'node:test'
import assert from 'node:assert/strict'
import {buildKnownAtModelContext,snapshotKnownEvents,validTimestamp,type KnownEvent} from './asof-event-ledger'
import {projectAsOfAppEvents,readAsOfAppEvents} from './asof-app-events'
import {setStoreBackend} from './storage'
import {appendJournal,readJournal} from './storage-journal'
import {EVENT_JOURNAL_PREFIX} from './events'
import {appendCorrection,type TrainingCorrection} from './training-correction'
import type {AppEvent} from './types'
const cutoff='2026-09-05T12:00:00+08:00'
const fact=(id:string,at:string,operation:KnownEvent['operation']='ASSERT',parent?:string):KnownEvent=>({eventId:id,observedAt:at,fact:{id:'f1',kind:'SESSION',date:'2026-09-01',value:70,unit:'s',source:'SELF_REPORT'},operation,replacesEventId:parent})
const start:AppEvent={event_id:'occ-1',event_type:'TRAINING_STARTED',athlete_id:'athlete',timestamp:'2026-09-01T10:00:00+08:00',payload:{sessionId:'s'},source:'MANUAL',confidence:1,data_quality:'HIGH',context:{},cycle_id:'c',schema_version:1}
const correction:TrainingCorrection={correctionId:'c1',trainingOccurrenceId:'occ-1',schemaVersion:1,kind:'FIELD',field:'reps',setKey:'move:1',originalValue:'8',newValue:'9',reason:'更正',at:'2026-09-02T10:00:00+08:00',recordedAt:'2026-09-10T10:00:00+08:00'}
test('future malformed fact cannot change any earlier model context',()=>{
 const known=fact('old','2026-09-02T10:00:00+08:00');const future={...fact('future','2026-09-10T10:00:00+08:00'),fact:{...known.fact,date:'2026-02-30',value:999}}
 assert.equal(buildKnownAtModelContext([known,future],cutoff),buildKnownAtModelContext([known],cutoff))
})
test('quarantined revision branches cannot leave accepted descendants',()=>{
 const root=fact('root','2026-09-01T10:00:00+08:00');const a=fact('a','2026-09-02T10:00:00+08:00','CORRECT','root');const b=fact('b','2026-09-03T10:00:00+08:00','CORRECT','root');const child=fact('child','2026-09-02T11:00:00+08:00','CORRECT','a')
 const r=snapshotKnownEvents([root,a,b,child],cutoff);assert.equal(r.facts.length,0);assert.ok(r.quarantinedEventIds.includes('child'))
})
test('identical retransmission is deduplicated but differing same-id facts are quarantined',()=>{
 const e=fact('id','2026-09-02T10:00:00+08:00');assert.equal(snapshotKnownEvents([e,structuredClone(e)],cutoff).facts.length,1)
 assert.equal(snapshotKnownEvents([e,{...e,fact:{...e.fact,value:69}}],cutoff).facts.length,0)
})
test('the same instant gives the same Shanghai training day, malformed calendar timestamps fail',()=>{
 const e={...fact('id','2026-09-01T23:00:00+08:00'),fact:{...fact('id','x').fact,date:'2026-09-02'}}
 assert.equal(snapshotKnownEvents([e],'2026-09-01T17:00:00Z').facts.length,1)
 assert.equal(buildKnownAtModelContext([e],'2026-09-01T17:00:00Z'),buildKnownAtModelContext([e],'2026-09-02T01:00:00+08:00'))
 assert.equal(validTimestamp('2026-02-30T12:00:00Z'),false)
})
test('actual event timestamp never substitutes for missing or later submission time',()=>{
 assert.equal(projectAsOfAppEvents([{event:start,recordedAt:null}],[],cutoff).events.length,0)
 const past=projectAsOfAppEvents([{event:start,recordedAt:'2026-09-10T10:00:00+08:00'}],[],cutoff);assert.equal(past.events.length,0)
 const now=projectAsOfAppEvents([{event:start,recordedAt:'2026-09-02T10:00:00+08:00'}],[correction],cutoff);assert.equal(now.events.length,1);assert.equal(now.corrections.length,0)
})
test('only committed corrections bound to a visible start can enter the historical snapshot',()=>{
 const rows=[{event:start,recordedAt:'2026-09-02T10:00:00+08:00'}]
 const r=projectAsOfAppEvents(rows,[{...correction,recordedAt:'2026-09-03T10:00:00+08:00'}],cutoff);assert.equal(r.corrections.length,1)
 const wrong=projectAsOfAppEvents(rows,[{...correction,trainingOccurrenceId:'other',recordedAt:'2026-09-03T10:00:00+08:00'}],cutoff);assert.equal(wrong.corrections.length,0)
 assert.equal(projectAsOfAppEvents(rows,[{...correction,recordedAt:undefined}],cutoff).corrections.length,0)
})
test('new immutable journal commits record physical time and legacy journal rows stay unknown',()=>{
 const box=new Map<string,string>();setStoreBackend({keys:()=>[...box.keys()],getItem:k=>box.get(k)??null,setItem:(k,v)=>{box.set(k,v)}})
 try{
  assert.equal(appendJournal(EVENT_JOURNAL_PREFIX,start.event_id,start),true)
  const saved=readJournal<AppEvent>(EVENT_JOURNAL_PREFIX)[0];assert.ok(validTimestamp(saved.recordedAt!))
  assert.equal(readAsOfAppEvents(cutoff).events.length,0)
  assert.equal(readAsOfAppEvents(saved.recordedAt!).events.length,1)
  const row=appendCorrection({...correction,at:'2026-09-02T10:00:00+08:00'});assert.ok(row?.recordedAt);assert.notEqual(row.recordedAt,row.at)
  const old=[...box.keys()].find(k=>k.startsWith(EVENT_JOURNAL_PREFIX))!;const raw=JSON.parse(box.get(old)!);delete raw.recordedAt;box.set(old,JSON.stringify(raw));assert.equal(readAsOfAppEvents(saved.recordedAt!).events.length,0)
 }finally{setStoreBackend(null)}
})
test('historical snapshots do not mutate originals or allow cross-athlete same-id conflicts',()=>{
 const rows=[{event:start,recordedAt:'2026-09-02T10:00:00+08:00'},{event:{...start,athlete_id:'other'},recordedAt:'2026-09-03T10:00:00+08:00'}];const before=JSON.stringify(rows)
 const r=projectAsOfAppEvents(rows,[],cutoff);assert.equal(r.events.length,0);assert.equal(JSON.stringify(rows),before);assert.equal(r.trainingDecisionAuthorized,false)
})
