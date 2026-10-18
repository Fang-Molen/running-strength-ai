import test,{beforeEach,afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {setStoreBackend} from './storage'
import {setEventContext,loadEvents} from './events'
import {savePlanDraft} from '../ui/fieldwork-plan-drafts'
import {saveFieldworkPreferences} from '../ui/fieldwork-host'
import {recordManualFood} from '../nutrition/log'
import {upsertCheck,todayDate} from '../nutrition/body'
import {readFieldworkCoachSources} from './coach-fieldwork-context'
import {assembleCoachBrief} from './coach-brief'
import {linkedContextText} from './coach-linked-context'
import {answerLocally} from './coach-local-first'
import {emptyDialogue} from './coach-dialogue'
import {detectRedFlags} from './coach-red-flags'
let values:Map<string,string>
beforeEach(()=>{values=new Map();const box={keys:()=>[...values.keys()],getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v)}};setStoreBackend(box);Object.defineProperty(globalThis,'localStorage',{value:box,configurable:true});setEventContext({athleteId:'synthetic-fieldwork-link'})})
afterEach(()=>{setStoreBackend(null);setEventContext({athleteId:'local'})})
const later=()=>new Date(Date.now()+1000).toISOString()
test('coach reads a draft as traceable context without completed-training facts',()=>{
 const d=savePlanDraft({id:'fk-run-tech-007',date:todayDate(),slot:'warmup',sets:null,amount:null,unit:'m',restSec:null,intent:'create',plannedOnly:true});assert.equal(d.ok,true)
 const sources=readFieldworkCoachSources('查看我的待练草稿',later());assert.equal(sources.length,1);assert.equal(sources[0].kind,'CONTEXT');assert.match(sources[0].detail,/不是已完成训练/);assert.match(sources[0].detail,/数量待确认/);assert.equal(loadEvents().length,0)
})
test('unrelated questions do not pull meal, body, appearance or draft records',()=>{savePlanDraft({id:'pushup',date:todayDate(),slot:'strength',sets:2,amount:8,unit:'次',restSec:60,intent:'create',plannedOnly:true});recordManualFood({date:todayDate(),meal:'加餐',name:'合成餐',kcal:321});upsertCheck({date:todayDate(),weight:65.4});assert.deepEqual(readFieldworkCoachSources('解释间歇训练原理',later()),[])})
test('meal context uses recorded numbers with unknown macros and no energy-deficit diagnosis',()=>{const row=recordManualFood({date:'2026-01-02',meal:'午餐',name:'合成餐',kcal:321,protein:20,eatenAt:'2026-01-02T04:17:00Z'})!;assert.ok(row.recordedAt);const sources=readFieldworkCoachSources('查看我的饮食记录',later());assert.equal(sources.length,1);assert.match(sources[0].detail,/321千卡/);assert.match(sources[0].detail,/碳水未记录/);assert.match(sources[0].detail,/不代表全天记录完整/);assert.equal(sources[0].kind,'CONTEXT')})
test('body context uses measured weight and never includes scenario or presentation gender',()=>{upsertCheck({date:todayDate(),weight:65.4});saveFieldworkPreferences({scenario:59.1,gender:'female',goal:'cut'});const sources=readFieldworkCoachSources('查看我的体重实测记录',later());assert.equal(sources.length,1);assert.match(sources[0].detail,/65.4公斤/);assert.match(sources[0].detail,/腰围未记录/);assert.doesNotMatch(sources[0].detail,/59\.1|female|减脂目标/);assert.equal(sources[0].kind,'CONTEXT')})
test('future-saved observations do not leak into an earlier as-of view',()=>{recordManualFood({date:'2026-01-02',meal:'午餐',name:'合成餐',kcal:321});upsertCheck({date:todayDate(),weight:65.4});savePlanDraft({id:'pushup',date:todayDate(),slot:'strength',sets:2,amount:8,unit:'次',restSec:60,intent:'create',plannedOnly:true});assert.deepEqual(readFieldworkCoachSources('查看我的饮食、体重、待练草稿记录','2026-01-01T00:00:00Z'),[])})
test('coach packet carries new read-only sources and leaves occurrence unbound',()=>{
 recordManualFood({date:'2026-01-02',meal:'午餐',name:'合成餐',kcal:321});const brief=assembleCoachBrief(null,'查看我的饮食记录',null);assert.equal(brief.occurrenceId,null);const sources=brief.sources?.filter(s=>s.id.startsWith('linked:meal:'))??[];assert.equal(sources.length,1);assert.match(sources[0].detail,/321千卡/);assert.match(linkedContextText(brief),/321千卡/);assert.ok(sources.every(s=>s.kind==='CONTEXT'))
})
test('source views stay scoped to the current athlete',()=>{recordManualFood({date:'2026-01-02',meal:'午餐',name:'合成餐',kcal:321});upsertCheck({date:todayDate(),weight:65.4});setEventContext({athleteId:'synthetic-other'});assert.deepEqual(readFieldworkCoachSources('我的饮食和体重记录',later()),[])})
test('actual dialogue route answers record inspection with saved numbers instead of intake',()=>{
 recordManualFood({date:'2026-01-02',meal:'午餐',name:'合成餐',kcal:321});upsertCheck({date:todayDate(),weight:65.4});
 const dialogue=emptyDialogue('synthetic-fieldwork-link'),before=new Map(values);
 const answer=answerLocally(assembleCoachBrief(null,'请核对我的本地饮食和体重实测记录，区分记录与缺失信息；训练调整只给待确认候选。',null),undefined,[],undefined,dialogue);
 assert.match(answer.text,/321千卡/);assert.match(answer.text,/65.4公斤/);assert.match(answer.text,/碳水未记录/);assert.doesNotMatch(answer.text,/主项是什么|目前最想达到/);assert.equal(answer.candidate,null);assert.deepEqual(answer.dialogue,dialogue);assert.deepEqual(values,before);
})
test('medical safety and a prior emergency override read-only record inspection',()=>{
 recordManualFood({date:'2026-01-02',meal:'午餐',name:'合成餐',kcal:321});
 const brief=assembleCoachBrief(null,'我现在胸痛呼吸困难，请查看我的饮食记录',null),answer=answerLocally(brief,undefined,[],undefined,emptyDialogue('synthetic-fieldwork-link'));
 assert.match(answer.text,/急救|120|急诊/);assert.doesNotMatch(answer.text,/321千卡/);
 const held={...emptyDialogue('synthetic-fieldwork-link'),emergency:detectRedFlags('我现在胸痛呼吸困难')};const next=answerLocally(assembleCoachBrief(null,'请查看我的饮食记录',null),undefined,[],undefined,held);assert.match(next.text,/急救|120|急诊/);assert.doesNotMatch(next.text,/321千卡/);
})
