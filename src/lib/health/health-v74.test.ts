import assert from 'node:assert/strict'
import test,{beforeEach,afterEach} from 'node:test'
import {setStoreBackend,type MemoryStore} from '../core/storage'
import {saveVital,loadVitals,VITALS_KEY,type VitalRecord} from '../nutrition/vitals'
import {saveDeviceRows,loadExtras,DEVICE_EXTRA_KEY,hrvMethodOf,extrasUnreadable} from '../ui/device-store'
import {buildHealthSnapshot,loadHealthSnapshot,saveHealthSource} from './snapshot'
import {reviewFatigue,reviewBalance,dailyCheckin} from './analysis'
import {garminHealthDay,syncOutcome} from './garmin-health'
import {deviceEvidenceHealthRows} from './device-evidence-bridge'
import {analysisDay,readCoachData,assertCoachData,answerFromAppData} from './coach-data'
import {assembleCoachBrief,assertCoachPacket} from '../core/coach-brief'
import {answerLocally} from '../core/coach-local-first'
import {compactSingleCoachPacket} from '../core/coach-model-packet'
import {localDay,shiftDay,valueText,validObservation} from './observation'
import type {DeviceHealthRow} from '../ui/device-parse'
import type {DeviceConfirmed} from '../core/device-image-evidence'
import type {ScheduleEntry} from './legacy-inputs'

const day='2026-10-17',at=day+'T08:00:00Z'
let box:MemoryStore&{dump:Map<string,string>};const oldStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage')
beforeEach(()=>{const dump=new Map<string,string>();box={dump,keys:()=>[...dump.keys()],getItem:k=>dump.get(k)??null,setItem:(k,v)=>{dump.set(k,v)}};setStoreBackend(box);Object.defineProperty(globalThis,'localStorage',{configurable:true,value:box})})
afterEach(()=>{setStoreBackend(null);if(oldStorage)Object.defineProperty(globalThis,'localStorage',oldStorage);else delete (globalThis as any).localStorage})
function row(metric:DeviceHealthRow['metric'],value:number,date=day,source='watch-a',statistic='日汇总'):DeviceHealthRow{return {key:metric+date,source,metric,value,day:date,hrvMethod:metric==='HRV'?'RMSSD':undefined,observation:{key:`${source}:${metric}:${date}:${statistic}`,sourceId:source,statistic,syncedAt:at}}}
function metric(s:ReturnType<typeof loadHealthSnapshot>,m:string){return s.metrics.find(x=>x.metric===m)!}
function seed(metric:DeviceHealthRow['metric'],values:number[]){saveDeviceRows(values.map((v,i)=>row(metric,v,shiftDay(day,i-values.length+1))),[])}
function entry(extra:Partial<ScheduleEntry>={}):ScheduleEntry{return {id:'a',date:day,kind:'run',modality:'run',title:'训练',focus:[],minutes:60,intensity:'HARD',lowerHeavy:false,source:'custom',refId:null,status:'planned',...extra}}
function evidence():DeviceConfirmed{return {id:'image-a',schemaVersion:1,deviceLabel:'截图表',recordedAt:day,confirmedAt:at,imageName:null,imageSha256:null,textOrigin:'USER_TRANSCRIBED',rawText:'',consent:'USER_CONFIRMED',destination:'DEVICE_EVIDENCE_ONLY',readings:[{id:'r1',metric:'SLEEP_HOURS',value:7.25,unit:'h',rawLine:'',sourceLine:1,provenance:'USER_EDITED'},{id:'r2',metric:'AVERAGE_HR_BPM',value:155,unit:'bpm',rawLine:'',sourceLine:2,provenance:'USER_EDITED'}]}}

test('same observation refreshes corrected watch values, retains prior value and independent manual record',()=>{
 assert.equal(saveVital({kind:'SLEEP',value:8,observedOn:day,source:'MANUAL'}).ok,true)
 assert.equal(saveDeviceRows([row('SLEEP',7)],[]).saved,1)
 const initial=loadVitals().records.find(v=>v.observation)!
 assert.equal(saveDeviceRows([row('SLEEP',7.25)],[]).saved,1)
 assert.equal(loadVitals().records.length,2)
 const corrected=loadVitals().records.find(v=>v.observation)!
 assert.equal(corrected.id,initial.id);assert.equal(corrected.value,7.25);assert.deepEqual(corrected.observation!.previous,[{value:7,syncedAt:at}])
 assert.equal(saveDeviceRows([row('SLEEP',7.25)],[]).skipped,1)
 assert.equal(loadVitals().records.length,2)
})
test('independent device sources do not overwrite or average each other',()=>{
 saveDeviceRows([row('HRV',50),row('HRV',70,day,'watch-b')],[])
 const m=metric(loadHealthSnapshot(day),'HRV');assert.equal(m.state,'CONFLICT');assert.equal(m.current,null);assert.equal(m.baseline,null)
 assert.equal(saveHealthSource('HRV',m.availableSources.find(x=>x.label.startsWith('watch-a'))!.id),true)
 const chosen=metric(loadHealthSnapshot(day),'HRV');assert.equal(chosen.state,'AVAILABLE');assert.equal(chosen.current?.source,'watch-a');assert.equal(loadVitals().records.length,2)
})
test('unknown HRV method is not inferred from a brand, and cannot become a mixed-method baseline',()=>{
 assert.equal(hrvMethodOf('Garmin Apple SDNN RMSSD'),'UNSPECIFIED')
 saveDeviceRows([0,1,2,3].map(i=>({...row('HRV',50,shiftDay(day,-i)),hrvMethod:'UNSPECIFIED',observation:{...row('HRV',50,shiftDay(day,-i)).observation!,statistic:'统计口径未提供'}})),[])
 assert.equal(metric(loadHealthSnapshot(day),'HRV').baseline,null)
 const different={...row('HRV',45),hrvMethod:'SDNN' as const,observation:{...row('HRV',45).observation!,key:'sdnn'}};saveDeviceRows([different],[])
 assert.equal(metric(loadHealthSnapshot(day),'HRV').state,'CONFLICT')
})
test('descriptive baseline uses only preceding calendar days in the same stream and never fills gaps',()=>{
 saveDeviceRows([row('SLEEP',8,shiftDay(day,-9)),row('SLEEP',7,shiftDay(day,-6)),row('SLEEP',8,shiftDay(day,-3)),row('SLEEP',6,shiftDay(day,-1)),row('SLEEP',6)],[])
 const b=metric(loadHealthSnapshot(day),'SLEEP').baseline!;assert.equal(b.count,3);assert.equal(b.mean,7);assert.equal(b.delta,-1)
})
test('stale values and future samples are excluded from current fatigue review',()=>{
 saveDeviceRows([row('RHR',90,shiftDay(day,-1)),row('RHR',40,shiftDay(day,1))],[])
 assert.equal(metric(loadHealthSnapshot(day),'RHR').state,'STALE')
 const r=reviewFatigue(loadHealthSnapshot(day),null);assert.equal(r.state,'INSUFFICIENT');assert.equal(r.signals.length,0)
})
test('choosing a missing source does not silently fall back to another device',()=>{
 saveDeviceRows([row('RHR',50)],[]);saveHealthSource('RHR','missing');assert.equal(metric(loadHealthSnapshot(day),'RHR').state,'MISSING')
})
test('Garmin retains sleep seconds, names daily-maximum Body Battery, and accepts zero steps',()=>{
 const x=garminHealthDay(day,'a',{status:200,body:{calendarDate:day,restingHeartRate:50,totalSteps:0,bodyBatteryHighestValue:95}},{status:200,body:{hrvSummary:{calendarDate:day,lastNightAvg:51}}},{status:200,body:{dailySleepDTO:{calendarDate:day,sleepTimeSeconds:26137}}},at)
 assert.equal(x.failures.length,0);assert.equal(x.rows.find(x=>x.metric==='SLEEP')?.value,26137/3600)
 assert.equal(x.rows.find(x=>x.metric==='STEPS')?.value,0);assert.match(x.rows.find(x=>x.metric==='BODY_BATTERY')!.observation!.statistic,/非当前/)
 assert.equal(valueText('SLEEP',26137/3600),'7小时16分')
 saveDeviceRows(x.rows,[]);assert.equal(loadVitals().records.find(v=>v.kind==='SLEEP')?.value,26137/3600)
 assert.equal(reviewFatigue(loadHealthSnapshot(day),null).state,'INSUFFICIENT')
})
test('partial endpoint failures and calendar mismatches never claim complete sync',()=>{
 const x=garminHealthDay(day,'a',{status:200,body:{calendarDate:'2026-10-16',restingHeartRate:60}},{status:503,body:{}},{status:0,body:{}},at)
 assert.equal(x.rows.length,0);assert.equal(x.failures.length,3)
 assert.equal(syncOutcome(x.failures,{saved:0,skipped:0,errors:[]},14).status,'partial')
 assert.equal(syncOutcome([],{saved:2,skipped:1,errors:['failed']},14).status,'partial')
 assert.equal(syncOutcome([],{saved:2,skipped:1,errors:[]},0).status,'partial')
})
test('corrupt health stores are preserved and exposed as unreadable',()=>{
 box.setItem(VITALS_KEY,'{');box.setItem(DEVICE_EXTRA_KEY,'{')
 const out=saveDeviceRows([row('RHR',50),row('STEPS',0)],[]);assert.equal(out.saved,0);assert.equal(out.errors.length,2)
 assert.equal(box.getItem(VITALS_KEY),'{');assert.equal(box.getItem(DEVICE_EXTRA_KEY),'{');assert.equal(loadHealthSnapshot(day).unreadable,true);assert.equal(extrasUnreadable(),true)
})
test('failed persistence never reports a saved vital',()=>{
 setStoreBackend({getItem:()=>null,setItem:()=>{}})
 assert.equal(saveDeviceRows([row('RHR',50)],[]).saved,0)
})
test('extras update in place with revision history and retain zero values',()=>{
 saveDeviceRows([row('STEPS',0)],[]);saveDeviceRows([row('STEPS',12)],[])
 assert.equal(loadExtras().length,1);assert.equal(loadExtras()[0].observation?.previous?.[0].value,0)
})
test('only explicitly confirmed screenshot health fields are bridgeable; activity HR is not resting HR',()=>{
 const e=evidence();const rows=deviceEvidenceHealthRows(e);assert.equal(rows.length,1);assert.equal(rows[0].metric,'SLEEP')
 assert.equal(loadVitals().records.length,0);assert.equal(saveDeviceRows(rows,[]).saved,1);assert.equal(saveDeviceRows(rows,[]).skipped,1)
 assert.equal(deviceEvidenceHealthRows({...e,consent:'NO' as any}).length,0)
})
test('self-reported sleep is clearly separate from watch sleep and does not silently win',()=>{
 saveDeviceRows([row('SLEEP',8)],[]);box.setItem('fk-checkin-v1',JSON.stringify([{date:day,at,sleep:6.5}]))
 const m=metric(loadHealthSnapshot(day),'SLEEP');assert.equal(m.state,'CONFLICT');assert.ok(m.availableSources.some(x=>/区间/.test(x.label)))
})
test('HRV and resting HR together count as one autonomic family, not independent confirmation',()=>{
 seed('HRV',[60,60,60,45]);seed('RHR',[50,50,50,57]);seed('SLEEP',[8,8,8,8])
 const r=reviewFatigue(loadHealthSnapshot(day),{date:day,at,fatigue:'ok',pain:'none'});assert.equal(r.state,'WATCH');assert.equal(r.signals.length,2)
})
test('subjective fatigue plus reduced sleep supports a conditional recovery-pressure review',()=>{
 seed('SLEEP',[8,8,8,6.5]);const r=reviewFatigue(loadHealthSnapshot(day),{date:day,at,fatigue:'tired'})
 assert.equal(r.state,'MULTI_SIGNAL');assert.equal(r.planChanged,false);assert.equal(r.diagnosis,false);assert.match(r.followup,/次日/)
})
test('pain overrides otherwise stable health signals and remains a review rather than diagnosis',()=>{
 for(const [m,v] of [['SLEEP',8],['HRV',60],['RHR',50]] as const)seed(m,[v,v,v,v])
 box.setItem('fk-pain-log-v1',JSON.stringify([{date:day,part:'足部',score:3}]))
 const r=reviewFatigue(loadHealthSnapshot(day),dailyCheckin(day));assert.equal(r.state,'PAIN_REVIEW');assert.match(r.action,/不能解除/)
})
test('no recorded adverse signal is not a claim of full recovery or permission to increase',()=>{
 for(const [m,v] of [['SLEEP',8],['HRV',60],['RHR',50]] as const)seed(m,[v,v,v,v])
 const r=reviewFatigue(loadHealthSnapshot(day),{date:day,at,fatigue:'ok',pain:'none'});assert.equal(r.state,'NO_ADVERSE_SIGNAL');assert.match(r.action,/不等于确认完全恢复/)
})
test('missing data and watch composite scores alone never produce a normal-training verdict',()=>{
 saveDeviceRows([row('READINESS',99),row('BODY_BATTERY',100)],[])
 assert.equal(reviewFatigue(loadHealthSnapshot(day),null).state,'INSUFFICIENT')
 assert.equal(reviewFatigue(buildHealthSnapshot([],[],day),null).state,'INSUFFICIENT')
})
test('training balance separates planned from performed and does not use completion-only rows as load',()=>{
 const e=entry({status:'done'});const b=reviewBalance([e],day);assert.equal(b.planned.run,1);assert.equal(b.actual.sessions,0);assert.equal(b.actual.knownMinutes,0);assert.match(b.gaps.join(''),/完成标记/)
})
test('actual unknown duration is counted as missing, and only entered intensity is distributed',()=>{
 const a=entry({actual:{outcome:'different',minutes:null,intensity:null,note:'',reasons:[],at}})
 const b=entry({id:'b',actual:{outcome:'different',minutes:30,km:5,intensity:'EASY',note:'',reasons:[],at}})
 const r=reviewBalance([a,b],day);assert.equal(r.actual.unknownMinutes,1);assert.equal(r.actual.knownMinutes,30);assert.equal(r.actual.intensityMinutes.hard,0);assert.equal(r.actual.intensityMinutes.easy,30);assert.equal(r.actual.knownRunKm,5)
})
test('consecutive planned hard days and same-day strength overlap are questions to review, not diagnosed overload',()=>{
 const r=reviewBalance([entry({date:shiftDay(day,-1)}),entry({id:'b'}),entry({id:'c',kind:'strength',modality:'strength'})],day)
 assert.match(r.observations.join(''),/连续两日/);assert.match(r.observations.join(''),/先后顺序/);assert.equal(r.planChanged,false)
})
test('planned muscle coverage requires known exercises; unknown actions do not invent muscle involvement',()=>{
 const r=reviewBalance([entry({kind:'strength',modality:'strength',exercises:[{catalogId:'back-squat',name:'蹲',sets:'3',reps:'8',weight:'60',rpe:''},{name:'未知',sets:'3',reps:'8',weight:'',rpe:''}]})],day)
 assert.equal(r.planned.unknownExercises,1);assert.ok(r.planned.muscleGroups.length);assert.match(r.gaps.join(''),/不是实际刺激量/)
})
test('analysis date follows the question; a selected old session does not hijack today',()=>{
 assert.equal(analysisDay('今天疲劳怎么样','2026-10-01T12:00:00Z',day),day)
 assert.equal(analysisDay('昨天健康',null,day),'2026-10-16');assert.equal(analysisDay('分析2026-10-12训练',null,day),'2026-10-12')
})
test('daily health reaches the coach without creating a training event or binding daily sleep to a session',()=>{
 saveDeviceRows([row('SLEEP',7.25)],[]);const before=[...box.dump]
 const brief=assembleCoachBrief(null,day+' 健康疲劳',null)
 assert.equal(brief.occurrenceId,null);assert.equal(brief.sleepHours,null);assert.ok(brief.appData);assertCoachPacket(brief);assert.deepEqual([...box.dump],before)
 const answer=answerLocally(brief);assert.match(answer.text,/7小时15分/);assert.match(answer.text,/证据不足/);assert.match(answer.text,/watch-a/);assert.equal(answer.sources?.includes(brief.appData!.sourceId),true)
})
test('coach data re-reads corrected measurements on the next turn and preserves selection source',()=>{
 saveDeviceRows([row('RHR',50)],[]);const first=readCoachData(day);saveDeviceRows([row('RHR',54)],[]);const second=readCoachData(day)
 assert.match(first.health.find(x=>x.metric==='RHR')!.detail,/50/);assert.match(second.health.find(x=>x.metric==='RHR')!.detail,/54/)
})
test('emergency and existing pain constraints take priority over app-data answers',()=>{
 saveDeviceRows([row('SLEEP',8)],[])
 const b=assembleCoachBrief(null,day+' 现在胸痛呼吸困难，还能训练吗',null);assert.match(answerLocally(b).text,/急诊|急救/)
 b.question=day+' 疲劳恢复';b.pain=true;b.constraints.medicalReferral=true;assert.doesNotMatch(answerLocally(b).text,/分析日期/)
})
test('known food totals remain partial and no confirmed training import is added twice to schedule totals',()=>{
 box.setItem('fr255-food-log-v1',JSON.stringify([{id:'f',date:day,meal:'早餐',name:'食物',grams:100,kcal:200}]))
 const b=assembleCoachBrief(null,day+' 今天饮食摄入',null);assert.match(answerFromAppData(b)!,/200 kcal/);assert.match(answerFromAppData(b)!,/不能据此判断吃得不足/)
 assert.equal(b.appData!.balance.actualSessions,0);assert.match(b.appData!.warnings.join(''),/不重复累加/)
})
test('app context remains sourced and bounded in compact model packet',()=>{
 saveDeviceRows([row('SLEEP',7)],[]);const b=assembleCoachBrief(null,day+' 下一次训练怎么安排',null);const p=compactSingleCoachPacket(b,[],[])
 assert.ok(p.current.appData);assert.ok(p.current.sourceIds.includes(b.appData!.sourceId))
 assert.throws(()=>assertCoachData({...b.appData,health:Array(17).fill(b.appData!.health[0])}))
 assert.throws(()=>assertCoachPacket({...b,sourceIds:b.sourceIds.filter(s=>s!==b.appData!.sourceId)}))
})
test('malformed provenance is rejected before imported health writes',()=>{
 assert.equal(validObservation({...row('RHR',50).observation!,previous:[{value:NaN,syncedAt:at}]}),false)
 assert.equal(saveDeviceRows([{...row('RHR',50),observation:{...row('RHR',50).observation!,sourceId:''}}],[]).saved,0)
})

test('an initially unset UI date does not crash empty-state rendering',()=>{
 const s=buildHealthSnapshot([],[],'');assert.equal(s.asOf,localDay());assert.equal(s.metrics.every(x=>x.state==='MISSING'),true)
})
test('daily pain constrains coach suggestions without falsely binding pain to a training occurrence',()=>{
 box.setItem('fk-pain-log-v1',JSON.stringify([{date:day,part:'脚',score:4}]))
 const b=assembleCoachBrief(null,day+' 健康和疲劳',null)
 assert.equal(b.pain,false);assert.equal(b.constraints.increaseBlocked,true);assert.equal(b.constraints.medicalReferral,true)
 assert.match(answerLocally(b).text,/先核对疼痛/);assert.equal(b.occurrenceId,null)
})
test('new fatigue mentioned in conversation is not dismissed by saved measurements',()=>{
 seed('SLEEP',[8,8,8,8]);seed('HRV',[60,60,60,60]);seed('RHR',[50,50,50,50]);box.setItem('fk-checkin-v1',JSON.stringify([{date:day,at,pain:'none',fatigue:'ok'}]))
 const b=assembleCoachBrief(null,day+' 今天很累，健康数据正常能恢复吗',null)
 assert.match(answerLocally(b).text,/不能用手表数据抵消你的感受/)
})

test('health UI renders without date hydration and shows source conflicts rather than a fabricated value',async()=>{
 const {createElement}=await import('react');const {renderToStaticMarkup}=await import('react-dom/server');const {HealthTiles}=await import('../../components/health-tiles')
 assert.match(renderToStaticMarkup(createElement(HealthTiles,{vitals:[],checks:[],today:'',revision:0,onJump:()=>{}})),/未记录/)
 saveDeviceRows([row('RHR',50),row('RHR',70,day,'watch-b')],[])
 const html=renderToStaticMarkup(createElement(HealthTiles,{vitals:loadVitals().records,checks:[],today:day,revision:1,onJump:()=>{}}))
 assert.match(html,/来源待核对/);assert.doesNotMatch(html,/60 次/)
})
test('source detail UI renders actual dates, statistic and the shared comparison coverage',async()=>{
 const {createElement}=await import('react');const {renderToStaticMarkup}=await import('react-dom/server');const {HealthSourceDetails}=await import('../../components/health-source-details')
 seed('SLEEP',[8,8,8,7]);const html=renderToStaticMarkup(createElement(HealthSourceDetails,{view:metric(loadHealthSnapshot(day),'SLEEP')}))
 assert.match(html,/watch-a/);assert.match(html,/7小时0分/);assert.match(html,/缺失日不补0/);assert.match(html,/接收时间/)
})

test('an empty subjective check-in cannot stand in for a report of feeling normal',()=>{
 for(const [m,v] of [['SLEEP',8],['HRV',60],['RHR',50]] as const)seed(m,[v,v,v,v])
 assert.equal(reviewFatigue(loadHealthSnapshot(day),{date:day,at}).state,'INSUFFICIENT')
})

test('the same workout in device imports and a schedule remains two separately reported streams, never summed',()=>{
 const start=day+'T00:00:00Z'
 const saved=saveDeviceRows([],[{key:'workout-1',source:'测试手表',sport:'RUNNING',sportLabel:'跑步',startIso:start,durationSec:1800,distanceM:5000,avgHr:150,maxHr:170,calories:300,avgCadence:170,avgPower:null,verticalOscMm:null,groundContactMs:null,sets:[]}])
 assert.equal(saved.saved,1)
 box.setItem('fk-schedule-v1',JSON.stringify({entries:[entry({actual:{outcome:'as_planned',minutes:30,km:5,intensity:'EASY',note:'',reasons:[],at}})],acks:[]}))
 const d=readCoachData(day);assert.equal(d.imports.count,1);assert.equal(d.balance.actualSessions,1);assert.equal(d.balance.knownMinutes,30);assert.equal(d.balance.knownRunKm,5)
 assert.equal(d.imports.latest[0].durationSec,1800);assertCoachData(d)
})

for(const mode of ['pro','basic','none'] as const)test(`${mode}: device selection keeps records and the same valid signals yield the same fatigue review`,async()=>{
 const {saveWatch}=await import('./legacy-inputs');saveWatch(mode,box)
 seed('SLEEP',[8,8,8,6.5]);box.setItem('fk-checkin-v1',JSON.stringify([{date:day,at,fatigue:'tired',pain:'none'}]))
 const d=readCoachData(day);assert.equal(d.mode.mode,mode);assert.equal(d.fatigue.state,'MULTI_SIGNAL');assert.equal(d.health.find(x=>x.metric==='HRV')?.state,'MISSING');assertCoachData(d)
 const raw=box.getItem(VITALS_KEY);saveWatch(mode==='none'?'pro':'none',box);assert.equal(box.getItem(VITALS_KEY),raw)
})
test('absent HRV is optional: comparable sleep plus explicit subjective feedback gives a limited observation',()=>{
 seed('SLEEP',[8,8,8,8]);const r=reviewFatigue(loadHealthSnapshot(day),{date:day,at,fatigue:'ok',pain:'none'})
 assert.equal(r.state,'NO_ADVERSE_SIGNAL');assert.match(r.action,/不等于确认完全恢复/);assert.ok(r.excluded.some(x=>x.includes('HRV')))
})
test('watch users with missing sleep can enter a separate self-report; selecting a brand does not claim connectivity',async()=>{
 const {createElement}=await import('react');const {renderToStaticMarkup}=await import('react-dom/server');const {CheckinCard}=await import('../../components/health-extras');const {healthModeSummary}=await import('./mode')
 for(const watch of ['pro','basic','none'] as const){const html=renderToStaticMarkup(createElement(CheckinCard,{today:day,watch,onSaved:()=>{},onPain:()=>{}}));assert.match(html,/自报睡眠/);assert.match(html,/疲劳/);assert.match(html,/疼痛/)}
 assert.match(healthModeSummary(null,loadHealthSnapshot(day)).description,/不等于已经连接/)
})

test('multi-file preview preserves different health sources before any storage writes',async()=>{
 const {mergeResults}=await import('../ui/device-parse')
 const a=row('HRV',50),b=row('HRV',70,day,'watch-b')
 const result=mergeResults([{kind:'csv',brand:'a',activities:[],health:[a,b,a],notes:[]}])
 assert.equal(result.health.length,2);assert.notEqual(result.health[0].key,result.health[1].key)
 saveDeviceRows(result.health,[]);assert.equal(metric(loadHealthSnapshot(day),'HRV').state,'CONFLICT')
})

test('v76: Garmin 204/empty day is no-data, not a sync failure; Body Battery uses most recent like Connect',()=>{
 const x=garminHealthDay(day,'a',{status:200,body:{calendarDate:day,restingHeartRate:50,bodyBatteryHighestValue:95,bodyBatteryMostRecentValue:41}},{status:204,body:{}},{status:200,body:{}},at)
 assert.equal(x.failures.length,0)
 const bb=x.rows.find(r=>r.metric==='BODY_BATTERY')!; assert.equal(bb.value,41); assert.equal(bb.observation!.statistic,'同步时最近值')
 assert.equal(x.rows.some(r=>r.metric==='HRV'||r.metric==='SLEEP'),false)
 const bad=garminHealthDay(day,'a',{status:500,body:{}},{status:204,body:{}},{status:204,body:{}},at); assert.equal(bad.failures.length,1)
})
test('batch99: independent Garmin/manual readings stay conflicting until source choice',()=>{
 assert.equal(saveVital({kind:'SLEEP',value:8,observedOn:day,source:'MANUAL'}).ok,true)
 const g=garminHealthDay(day,'acct',{status:200,body:{calendarDate:day,bodyBatteryHighestValue:90}},{status:200,body:{hrvSummary:{calendarDate:day,lastNightAvg:48}}},{status:200,body:{dailySleepDTO:{calendarDate:day,sleepTimeSeconds:6.5*3600}}},at)
 saveDeviceRows(g.rows,[])
 const later=garminHealthDay(day,'acct',{status:200,body:{calendarDate:day,bodyBatteryHighestValue:90,bodyBatteryMostRecentValue:35}},{status:204,body:{}},{status:204,body:{}},day+'T12:00:00Z')
 saveDeviceRows(later.rows,[])
 const s=loadHealthSnapshot(day), sleep=metric(s,'SLEEP'), bb=metric(s,'BODY_BATTERY')
 assert.equal(sleep.state,'CONFLICT'); assert.equal(sleep.current,null); assert.equal(sleep.candidates.length,2)
 assert.equal(bb.state,'CONFLICT'); assert.equal(bb.current,null)
 const manual=sleep.candidates.find(p=>p.value===8)!; saveHealthSource('SLEEP',manual.stream)
 assert.equal(metric(loadHealthSnapshot(day),'SLEEP').current!.value,8)
})
