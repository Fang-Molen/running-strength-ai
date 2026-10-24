import test from 'node:test'
import assert from 'node:assert/strict'
import {setStoreBackend} from '../../core/storage'
import {currentAthleteId,setEventContext} from '../../core/events'
import {createPersonalStore} from '../personal/store'
import {defaultPersonalProfile} from '../personal/host'
import {loadSchedule,updateSchedule,SCHEDULE_KEY} from '../../ui/day-schedule'
import {previewR4CourseMove,confirmR4CourseMove,undoR4CourseMove} from './course-flow'

test('preview and cancellation write nothing; confirmation updates the shared calendar with an auditable reversible receipt',async t=>{
 const owner=currentAthleteId(),local=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),nav=Object.getOwnPropertyDescriptor(globalThis,'navigator'),data=new Map<string,string>()
 const box={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v)},keys:()=>[...data.keys()]}
 let tail:Promise<unknown>=Promise.resolve()
 setStoreBackend(box);setEventContext({athleteId:'course-owner'});Object.defineProperty(globalThis,'localStorage',{value:box,configurable:true});Object.defineProperty(globalThis,'navigator',{value:{locks:{request:(_name:string,work:()=>unknown)=>{const run=tail.then(work);tail=run.catch(()=>{});return run}}},configurable:true})
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-24T12:00:00Z')})
 t.after(()=>{setStoreBackend(null);setEventContext({athleteId:owner});for(const [key,descriptor] of [['localStorage',local],['navigator',nav]] as const){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key)}})
 const personal=createPersonalStore(box,currentAthleteId)
 personal.saveProfile({...defaultPersonalProfile('course-owner'),age:30,screen:'CLEAR',days:[1,3,5],services:['STRENGTH']})
 const entry={id:'owned-course',athleteId:'course-owner',date:'2026-10-26',kind:'strength',modality:'strength',title:'已保存的20分钟力量课',focus:[],minutes:20,exercises:[{id:'synthetic-move',name:'合成测试深蹲',sets:'1',reps:'5',weight:'0',unit:'reps',restSec:60}],intensity:'EASY',lowerHeavy:false,source:'custom',refId:null,status:'planned',runComponents:[{componentId:'strength',modality:'STRENGTH',strengthSessionId:'saved-session'}]}
 const foreign={...entry,id:'foreign',athleteId:'another-person'}
 box.setItem(SCHEDULE_KEY,JSON.stringify({entries:[entry,foreign],acks:[]}))
 const before=[...data],proposal=previewR4CourseMove('安排力量课程','owned-course','2026-10-28')
 assert.deepEqual([...data],before)
 const saved=await confirmR4CourseMove(proposal,'CONFIRM_THIS_CHANGE');assert.equal(saved.ok,true)
 assert.equal(loadSchedule().entries[0].date,'2026-10-28')
 assert.deepEqual(JSON.parse(box.getItem(SCHEDULE_KEY)!).entries.find((e:{id:string})=>e.id==='foreign'),foreign)
 assert.equal(JSON.parse(box.getItem(SCHEDULE_KEY)!).r4Receipts.length,1)
 const undo=await undoR4CourseMove(proposal.id,'UNDO_THIS_CHANGE');assert.equal(undo.ok,true)
 assert.equal(loadSchedule().entries[0].date,'2026-10-26');assert.equal(JSON.parse(box.getItem(SCHEDULE_KEY)!).r4Receipts.length,2)
 const stale=previewR4CourseMove('安排力量课程','owned-course','2026-10-28')
 personal.saveProfile({...personal.read().profile!,minutes:20})
 const unchanged=[...data],rejected=await confirmR4CourseMove(stale,'CONFIRM_THIS_CHANGE')
 assert.equal(rejected.ok,false);assert.deepEqual([...data],unchanged)
 const fresh=previewR4CourseMove('安排力量课程','owned-course','2026-10-28'),oldPage=loadSchedule()
 const [moved,stalePage]=await Promise.all([confirmR4CourseMove(fresh,'CONFIRM_THIS_CHANGE'),updateSchedule(()=>oldPage,'today-board',oldPage)])
 assert.equal(moved.ok,true);assert.equal(stalePage,false);assert.equal(loadSchedule().entries[0].date,'2026-10-28')
 assert.deepEqual(JSON.parse(box.getItem(SCHEDULE_KEY)!).entries.find((e:{id:string})=>e.id==='foreign'),foreign)
 const snap=[...data];setEventContext({athleteId:'another-person'})
 assert.equal((await undoR4CourseMove(fresh.id,'UNDO_THIS_CHANGE')).ok,false);assert.deepEqual([...data],snap)
 setEventContext({athleteId:'course-owner'})
 const currentDoc=JSON.parse(box.getItem(SCHEDULE_KEY)!),second={...entry,id:'weather-indoor',title:'室内合成课程',date:'2026-10-30'}
 box.setItem(SCHEDULE_KEY,JSON.stringify({...currentDoc,entries:[...currentDoc.entries,second]}))
 const swapBefore=[...data],swap=previewR4CourseMove('天气原因，调换两节课','owned-course','2026-10-30','用户说明：天气原因')
 assert.equal(swap.kind,'SWAP');assert.equal(swap.second?.after.date,'2026-10-28');assert.deepEqual([...data],swapBefore)
 const swapped=await confirmR4CourseMove(swap,'CONFIRM_THIS_CHANGE');assert.equal(swapped.ok,true)
 const swappedEntries=loadSchedule().entries;assert.equal(swappedEntries.find(e=>e.id==='owned-course')?.date,'2026-10-30');assert.equal(swappedEntries.find(e=>e.id==='weather-indoor')?.date,'2026-10-28')
 assert.deepEqual(swappedEntries.find(e=>e.id==='owned-course')?.exercises,entry.exercises)
 const undone=await undoR4CourseMove(swap.id,'UNDO_THIS_CHANGE');assert.equal(undone.ok,true)
 assert.equal(loadSchedule().entries.find(e=>e.id==='weather-indoor')?.date,'2026-10-30')
 assert.equal(loadSchedule().entries.find(e=>e.id==='owned-course')?.date,'2026-10-28')

})
