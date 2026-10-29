import test from 'node:test'
import assert from 'node:assert/strict'
import {context,training,set} from './analysis-fixtures'
import {projectAnalysisEvidence} from './analysis-evidence'
import {buildLoadSummary,loadOccurrences,type SessionLoadEvidence} from './load-evidence'
const proof:SessionLoadEvidence={origin:'CONFIRMED_IMPORT',completed:true,durationBasis:'FULL_SESSION',ratingScope:'SESSION',ratingCollectedAt:'2026-10-22T08:45:00Z',ratingRecordedAt:'2026-10-22T09:00:00Z',ratingScale:'CR10',sourceIds:['synthetic-proof']}
const run=(o:Parameters<typeof training>[0]={})=>training({id:'run',sourceRecordId:'run',componentId:'run',modality:'RUN',endedAt:'2026-10-22T08:30:00Z',actualDurationSeconds:1800,sessionRpe:6,sessionRpeScale:'CR10',sessionLoadEvidence:proof,strengthSets:[],runSegments:[{id:'s',blockId:'b',roundIndex:null,stepIndex:1,kind:'CONTINUOUS',distanceM:5000,durationSeconds:1800,completion:'COMPLETED',restAfterSeconds:null,rawResolutionSeconds:null,gradePercent:null,surface:null}],...o})
const snap=(facts:ReturnType<typeof training>[])=>projectAnalysisEvidence({context,facts})
test('同一混合课整课AU只一次；跑步和力量保留独立外部量',()=>{
 const r=run(),lift=training({sessionRpe:6,sessionRpeScale:'CR10',actualDurationSeconds:1800,endedAt:r.endedAt,sessionLoadEvidence:proof})
 const o=loadOccurrences(snap([r,lift]))[0];assert.equal(o.sessionAU,180);assert.equal(o.knownDistanceM,5000);assert.equal(o.strength[0].knownKgReps,300);assert.equal(loadOccurrences(snap([r,lift])).length,1)
})
test('未结束原生、移动时长、末组评分以及未来采集不能生成整课AU',()=>{
 for(const patch of [{endedAt:null,sessionLoadEvidence:{...proof,origin:'NATIVE' as const,completed:false}},{sessionLoadEvidence:{...proof,durationBasis:'MOVING' as const}},{sessionLoadEvidence:{...proof,ratingScope:'SET' as const}},{sessionLoadEvidence:{...proof,ratingCollectedAt:'2026-10-23T09:00:00Z'}}]){
  const o=loadOccurrences(snap([run(patch)]))[0];assert.equal(o.sessionAU,null);assert.equal(o.candidateAU,null)
 }
})
test('明确完成的导入可缺结束时刻；口径证明不足仅候选，未知量表不计算',()=>{
 assert.equal(loadOccurrences(snap([run({endedAt:null})]))[0].sessionAU,180)
 assert.equal(loadOccurrences(snap([run({sessionLoadEvidence:undefined})]))[0].sessionAU,null)
 assert.equal(loadOccurrences(snap([run({sessionLoadEvidence:undefined})]))[0].candidateAU,180)
 assert.equal(loadOccurrences(snap([run({sessionRpeScale:'UNKNOWN'})]))[0].candidateAU,null)
})
test('部分跑步距离保留已知量；未知与跳过分开；力量不同口径不相加',()=>{
 const r=run();r.runSegments.push({...r.runSegments[0],id:'missing',distanceM:null,completion:'NOT_RECORDED'})
 const sets=[set({id:'hand',loadBasis:'PER_HAND',loadKg:20}),set({id:'total',loadKg:40}),set({id:'skip',completion:'SKIPPED'}),set({id:'unknown',completion:'NOT_RECORDED'})]
 const o=loadOccurrences(snap([r,training({strengthSets:sets})]))[0]
 assert.equal(o.knownDistanceM,5000);assert.equal(o.distanceComplete,false)
 assert.equal(o.strength.find(s=>s.loadBasis==='PER_HAND')!.knownKgReps,100)
 assert.equal(o.strength.find(s=>s.loadBasis==='TOTAL_EXTERNAL')!.knownKgReps,200)
 assert.equal(o.strength.find(s=>s.loadBasis==='TOTAL_EXTERNAL')!.unknownSets,1)
})
test('空白不为零；确认仅匹配本人/时区/版本/截止时间，相关修改失效',()=>{
 const s=snap([run()]),a=buildLoadSummary(s,'2026-10-21','2026-10-22'),coverage=a.days.map(d=>({athleteId:context.athleteId,timeZone:context.timeZone,day:d.day,sourceVersion:d.sourceVersion,knownAt:'2026-10-22T10:00:00Z'}))
 assert.deepEqual(a.days.map(d=>d.sessionAU),[null,null]);const b=buildLoadSummary(s,a.startDay,a.endDay,coverage)
 assert.deepEqual(b.days.map(d=>d.sessionAU),[0,180]);assert.equal(b.days[0].coverage,'CONFIRMED_REST')
 const c=buildLoadSummary(snap([run({revision:2,sessionRpe:7})]),a.startDay,a.endDay,coverage);assert.deepEqual(c.days.map(d=>d.sessionAU),[0,null])
 assert.equal(buildLoadSummary(s,a.startDay,a.endDay,coverage.map(c=>({...c,athleteId:'OTHER'}))).days[0].sessionAU,null)
 assert.equal(buildLoadSummary(s,a.startDay,a.endDay,coverage.map(c=>({...c,knownAt:'2026-10-23T00:00:00Z'}))).days[0].sessionAU,null)
})
test('同版本重复幂等，晚同步不可污染历史；跨午夜按开始日一次归属',()=>{
 const r=run({startedAt:'2026-10-21T16:00:00Z',occurredAt:'2026-10-21T16:00:00Z',endedAt:'2026-10-22T01:00:00Z'}),s=projectAnalysisEvidence({context:{...context,timeZone:'Asia/Shanghai'},facts:[r,r,run({id:'late',sourceRecordId:'late',canonicalActivityId:'late',knownAt:'2026-10-23T00:00:00Z',receivedAt:'2026-10-23T00:00:00Z'})]})
 const rows=loadOccurrences(s);assert.equal(rows.length,1);assert.equal(rows[0].day,'2026-10-22')
})

test('原生训练没有结束事件时，即使completed标记为真也不能生成AU',()=>{
 const row=loadOccurrences(snap([run({endedAt:null,sessionLoadEvidence:{...proof,origin:'NATIVE'}})]))[0];assert.equal(row.candidateAU,null)
})
test('不同评分量表不合并为同口径日AU',()=>{
 const a=run(),b=run({id:'other',sourceRecordId:'other',canonicalActivityId:'other',sessionRpeScale:'0-10_SESSION_RPE',sessionLoadEvidence:{...proof,ratingScale:'0-10_SESSION_RPE'}}),s=snap([a,b]),raw=buildLoadSummary(s,'2026-10-22','2026-10-22')
 const covered=buildLoadSummary(s,raw.startDay,raw.endDay,[{athleteId:context.athleteId,timeZone:context.timeZone,day:raw.startDay,sourceVersion:raw.days[0].sourceVersion,knownAt:'2026-10-22T12:00:00Z'}]);assert.equal(covered.days[0].sessionAU,null);assert.ok(covered.days[0].gaps.some(g=>g.includes('量表')))
})
