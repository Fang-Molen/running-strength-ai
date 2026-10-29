import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { context, training, set } from './analysis-fixtures'
import { projectAnalysisEvidence } from './analysis-evidence'
import { buildLoadPrototype } from './load-prototype'

const segment={id:'seg',blockId:'a',roundIndex:1,stepIndex:1,distanceM:5000,durationSeconds:1800,restAfterSeconds:null,rawResolutionSeconds:1,gradePercent:null,surface:null,completion:'COMPLETED' as const}
const run=(o:Parameters<typeof training>[0]={})=>training({id:'run',sourceRecordId:'run',canonicalActivityId:'run',occurrenceId:'run',componentId:'run',modality:'RUN',endedAt:'2026-10-22T08:30:00Z',strengthSets:[],runSegments:[segment],actualDurationSeconds:1800,sessionRpe:6,sessionRpeScale:'CR10',...o})
const snap=(facts:ReturnType<typeof training>[])=>projectAnalysisEvidence({context,facts})
test('分项显示实际跑量及整课负荷，保留证据版本',()=>{const x=buildLoadPrototype(snap([run()]));assert.equal(x.sessions[0].distanceM,5000);assert.equal(x.sessions[0].sessionLoadAU,180);assert.deepEqual(x.sessions[0].ref,{id:'run',revision:1})})
test('缺评分和缺距离不能填零',()=>{const x=buildLoadPrototype(snap([run({sessionRpe:null,runSegments:[{...segment,distanceM:null}]})]));assert.equal(x.sessions[0].sessionLoadAU,null);assert.equal(x.sessions[0].distanceM,null)})
test('混合课整课评分不拆分、不重复计算',()=>{const x=buildLoadPrototype(snap([run(),training({occurrenceId:'run',canonicalActivityId:'strength',sessionRpe:6,sessionRpeScale:'CR10',actualDurationSeconds:1800})]));assert.deepEqual(x.sessions.map(s=>s.sessionLoadAU),[null,null])})
test('剔除他人记录，更正只使用最新版本',()=>{const other=training({id:'foreign',sourceRecordId:'foreign',athleteId:'OTHER'});const updated=run({revision:2,runSegments:[{...segment,distanceM:6000}]});const x=buildLoadPrototype(snap([run(),other,updated]));assert.equal(x.sessions.length,1);assert.equal(x.sessions[0].distanceM,6000);assert.equal(x.sessions[0].ref.revision,2)})
test('力量只统计完成组，未记录的组保持不完整',()=>{const x=buildLoadPrototype(snap([training({strengthSets:[set(),set({id:'s2',completion:'NOT_RECORDED'})]})]));assert.equal(x.sessions[0].strengthSets,1);assert.equal(x.sessions[0].strengthComplete,false)})
test('未知评分口径不推算整课负荷',()=>{assert.equal(buildLoadPrototype(snap([run({sessionRpeScale:'UNKNOWN'})])).sessions[0].sessionLoadAU,null)})
test('尚未结束的课不能计算整课负荷',()=>{assert.equal(buildLoadPrototype(snap([run({endedAt:'2026-10-23T09:00:00Z'})])).sessions[0].sessionLoadAU,null)})
test('按用户时区归属日期，不纳入未来训练',()=>{const late=run({startedAt:'2026-10-21T17:00:00Z',occurredAt:'2026-10-21T17:00:00Z',knownAt:'2026-10-21T17:00:00Z',receivedAt:'2026-10-21T17:00:00Z'});const s=projectAnalysisEvidence({context:{...context,timeZone:'Asia/Shanghai'},facts:[late,training({id:'future',sourceRecordId:'future',occurredAt:'2026-10-23T08:00:00Z',startedAt:'2026-10-23T08:00:00Z',knownAt:'2026-10-23T08:00:00Z',receivedAt:'2026-10-23T08:00:00Z'})]});const x=buildLoadPrototype(s);assert.equal(x.sessions.length,1);assert.equal(x.sessions[0].day,'2026-10-22')})

test('未结束原生训练即使有时长和评分也不能产生整课AU',()=>{
 const result=buildLoadPrototype(snap([run({provider:'APP',endedAt:null})]));
 assert.equal(result.sessions[0].sessionLoadAU,null)
})
