import test from 'node:test'
import assert from 'node:assert/strict'
import {setStoreBackend} from '../../core/storage'
import {setEventContext,currentAthleteId} from '../../core/events'
import {createPersonalStore} from '../personal/store'
import {defaultPersonalProfile} from '../personal/host'
import {readR4CoachAnswer} from './answer'
test('formal answer changes with saved conditions and nutrient corrections without model calls or automatic writes',t=>{
 const previous=currentAthleteId(),old=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),map=new Map<string,string>()
 const box={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v)},keys:()=>[...map.keys()]}
 setStoreBackend(box);setEventContext({athleteId:'r4-answer'});Object.defineProperty(globalThis,'localStorage',{value:box,configurable:true})
 t.after(()=>{setStoreBackend(null);setEventContext({athleteId:previous});if(old)Object.defineProperty(globalThis,'localStorage',old);else Reflect.deleteProperty(globalThis,'localStorage')})
 const at='2026-10-24T12:00:00Z',q='只问饮食，增肌需要多少蛋白？'
 const before=readR4CoachAnswer(q,at)!
 assert.match(before.text,/个人条件|健康筛查/);assert.doesNotMatch(before.text,/96.*108/)
 createPersonalStore(box,currentAthleteId,()=>at).saveProfile({...defaultPersonalProfile('r4-answer'),age:30,screen:'CLEAR',weightKg:60,goal:'HYPERTROPHY'})
 const after=readR4CoachAnswer(q,at)!
 assert.match(after.text,/96.*108/);assert.match(after.text,/USADA|S09/);assert.notEqual(after.basisVersion,before.basisVersion)
 assert.ok(after.knowledge.some(k=>k.id==='K22'&&k.applicability==='EDUCATIONAL_APPLICABLE'))
 map.set('fr255-food-log-v1',JSON.stringify([{id:'food',athleteId:'r4-answer',date:'2026-10-24',meal:'早餐',name:'合成餐',kcal:400,source:'MANUAL',recordedAt:at}]))
 const unknown=readR4CoachAnswer('只问饮食，今天蛋白记录完整吗？',at)!
 assert.match(unknown.text,/蛋白.*缺|蛋白.*未知/)
 const food=JSON.parse(map.get('fr255-food-log-v1')!);food[0].protein=25;map.set('fr255-food-log-v1',JSON.stringify(food))
 const corrected=readR4CoachAnswer('只问饮食，今天蛋白记录完整吗？',at)!
 assert.match(corrected.text,/25 g/);assert.notEqual(unknown.basisVersion,corrected.basisVersion)
 const frozen=[...map];readR4CoachAnswer(q,at);assert.deepEqual([...map],frozen)
 assert.doesNotMatch(corrected.text,/HRV|静息心率/)
 const yesterday=readR4CoachAnswer('只问饮食，昨天蛋白记录完整吗？',at)!
 assert.equal(yesterday.day,'2026-10-23');assert.doesNotMatch(yesterday.text,/25 g/)
})
