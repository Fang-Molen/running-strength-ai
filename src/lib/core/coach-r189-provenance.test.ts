/** Synthetic provenance regressions. No network, real athletes, or plan writes. */
import test from 'node:test'
import assert from 'node:assert/strict'
import {parseChatTraining} from './coach-chat-evidence.ts'
import {intervalTargetAnalysis,reportedRace,explicitlyReviewsRecord} from './coach-specialty-analysis.ts'

for(const q of [
 '今天计划400米×4，目标60、61、62、63秒，明天做',
 '我准备明天400米×4，60、61、62、63秒',
 '这节课计划400米×4，目标60、61、62、63秒，还没完成',
 '我明天计划练50分钟，整课RPE7',
 '今天400米×4，目标60、61、62、63秒',
 '今天400米×4，目标平均65秒，整课RPE7',
])test('R189 provenance planned values never become actual: '+q,()=>{
 const c=parseChatTraining(q);assert.equal(c.hasActual,false);assert.equal(c.rpe,null);assert.equal(c.minutes,null);assert.ok(c.splits.every(s=>s.seconds===null))
})
for(const q of [
 '原计划400米×4目标60秒，实际65、66、67、68秒，组间3分钟',
 '今天400米×4，65、66、67、68秒，明天练什么',
 '今天400米×4，实际65、66、67、68秒，明天目标60、61、62、63秒',
])test('R189 provenance actual reports survive separate plan clauses: '+q,()=>{
 const c=parseChatTraining(q);assert.equal(c.hasActual,true);assert.deepEqual(c.splits.map(s=>s.seconds),[65,66,67,68])
})
test('R189 provenance clock-form time is already seconds, never multiplied twice',()=>{
 const c=parseChatTraining('今天实际距离依次200、400米，用时依次0:30、1:05分');assert.deepEqual(c.splits.map(s=>s.seconds),[30,65])
 assert.equal(parseChatTraining('今天800米用时1:54.32分').splits[0].seconds,114.32)
 assert.deepEqual(parseChatTraining('今天实际距离依次200、400米，用时依次0.5、1分').splits.map(s=>s.seconds),[30,60])
})
const actual=()=>parseChatTraining('今天400米×4，实际65、66、67、68秒')
test('R189 provenance actual per-rep time cannot override explicit target',()=>{
 const r=intervalTargetAnalysis(actual(),'首组每次用时65秒，目标60秒','节奏控制')!;assert.equal(r.targetSeconds,60);assert.deepEqual(r.deviations.map(d=>d.deltaSeconds),[5,6,7,8])
 assert.equal(intervalTargetAnalysis(actual(),'每次用时65秒','UNKNOWN'),null)
})
test('R189 provenance slower than target is not called an overspeed start',()=>{
 const r=intervalTargetAnalysis(actual(),'目标60秒','节奏控制')!;assert.match(r.text,/首段已慢于目标/);assert.doesNotMatch(r.text,/首段偏快|首段比目标快/)
})
test('R189 provenance fast start explanation cites the measured target difference',()=>{
 const r=intervalTargetAnalysis(parseChatTraining('今天400米×4，实际58、60、62、64秒'),'目标60秒','UNKNOWN')!;assert.match(r.text,/首段比目标快2秒/);assert.match(r.text,/课程目的 UNKNOWN/)
})
test('R189 provenance target clocks and minute units are explicit',()=>{
 assert.equal(intervalTargetAnalysis(actual(),'每组目标1:05','UNKNOWN')?.targetSeconds,65)
 assert.equal(intervalTargetAnalysis(actual(),'计划每组1分钟','UNKNOWN')?.targetSeconds,60)
 assert.equal(intervalTargetAnalysis(actual(),'计划400米×4，目标60秒','UNKNOWN')?.targetSeconds,60)
 assert.equal(intervalTargetAnalysis(actual(),'目标60秒，目标65秒','UNKNOWN'),null)
})
test('R189 provenance invalid or excluded actual inputs never reach target arithmetic',()=>{
 const c=actual();c.splits.forEach(s=>{s.seconds=Number.NaN});assert.equal(intervalTargetAnalysis(c,'目标60秒','UNKNOWN'),null)
 c.splits.forEach(s=>{s.seconds=65;s.excluded='待核对'});assert.equal(intervalTargetAnalysis(c,'目标60秒','UNKNOWN'),null)
})
for(const q of [
 '今天800米用时1:54.32，前400米累计54.1秒，目标成绩1:52，请复盘今天',
 '目标800米成绩1:52，今天800米用时1:54.32，前400米累计54.1秒，复盘',
])test('R189 provenance actual race survives a distinct goal: '+q,()=>{
 const r=reportedRace(q)!;assert.equal(r.totalSeconds,114.32);assert.equal(r.splits[0].seconds,54.1);assert.ok(Math.abs(r.calculation.halfDifferenceSeconds!-6.12)<1e-9)
})
for(const q of ['明天800米成绩1:54.32，前400米累计54.1秒','我的朋友800米用时1:54.32，前400米累计54.1秒','目标800米成绩1:54.32，前400米累计54.1秒'])test('R189 provenance future or another athlete race is not self actual: '+q,()=>assert.equal(reportedRace(q),null))
for(const q of ['刚才的分段说明什么','再复盘一下这节课','复盘','帮我复盘今天'])test('R189 provenance explicit prior-course reference: '+q,()=>assert.equal(explicitlyReviewsRecord(q),true))
for(const q of ['复盘时为什么要记录RPE','为什么要复盘','什么是训练复盘','复盘需要哪些数据','明天练什么'])test('R189 provenance coaching concepts do not bind prior course: '+q,()=>assert.equal(explicitlyReviewsRecord(q),false))
