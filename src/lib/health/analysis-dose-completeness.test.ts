import test from 'node:test'
import assert from 'node:assert/strict'
import {context,training,set} from './analysis-fixtures'
import {projectAnalysisEvidence} from './analysis-evidence'
import {buildMuscleExposure} from './muscle-exposure'
import {evaluateRecoveryEvidence} from './recovery-assessment'
import {buildCoachAnalysisPacket,validateCoachAnalysisReply} from './analysis-packet'
import {composeVerifiedAnalysisAnswer} from './analysis-reply-validation'
import type {TrainingFact} from './analysis-contract'

const run=():TrainingFact=>training({modality:'RUN',componentId:'running',strengthSets:[],runSegments:[30,40].map((durationSeconds,i)=>({id:'segment-'+i,blockId:'main',roundIndex:1,stepIndex:i+1,distanceM:200,durationSeconds,restAfterSeconds:120,rawResolutionSeconds:1,gradePercent:null,surface:null,completion:'COMPLETED'}))})
function packet(t:TrainingFact,question:string){const s=projectAnalysisEvidence({context,facts:[t]});return buildCoachAnalysisPacket(s,evaluateRecoveryEvidence(s),buildMuscleExposure(s),{question})}
test('missing segment distance cannot escape as an authoritative full-course total',()=>{
 const t=run();t.runSegments[1].distanceM=null
 const p=packet(t,'这次跑步的总距离是多少？')
 assert.equal(p.derivedFacts!.some(d=>d.metric==='RUN_DISTANCE_M'),false)
 assert.ok(p.requirements!.genuinelyMissing.some(x=>/总距离|distance/i.test(x)))
 const observation=p.assessment.observations.find(o=>/200 m/.test(o.text))!
 assert.match(observation.text,/小计|已知部分/)
 assert.match(observation.text,/总距离未知|总距离.*不可用/)
 const reply={answer:observation.text,factualClaims:[{text:observation.text,refs:observation.evidenceRefs}],derivedFactIds:p.requirements!.requiredDerivedFactIds,selectedCandidateId:null,hypotheses:[],unknowns:[],followup:null,memoryClaim:'NOT_SAVED' as const}
 const result=validateCoachAnalysisReply(reply,p)
 if(result.status==='ACCEPTED_STRUCTURALLY')assert.match(composeVerifiedAnalysisAnswer(reply,p),/总距离未知|总距离.*不可用/)
})
test('unknown time stays a labelled subtotal while full known distance remains usable',()=>{
 const t=run();t.runSegments[1].durationSeconds=null
 const p=packet(t,'跑步总距离和总用时各多少？'),text=p.assessment.observations.map(o=>o.text).join('\n')
 assert.ok(p.derivedFacts!.some(d=>d.metric==='RUN_DISTANCE_M'&&d.value===400))
 assert.equal(p.derivedFacts!.some(d=>d.metric==='RUN_WORK_SECONDS'),false)
 assert.match(text,/已知.*用时.*小计|已知用时小计/)
 assert.match(text,/总用时未知|总用时.*不可用/)
})
test('strength missing repetitions are not silently replaced with a complete repetition total',()=>{
 const t=training({strengthSets:[set({id:'first',reps:8}),set({id:'second',reps:null})]})
 const p=packet(t,'力量训练总共完成几组几次？'),text=p.assessment.observations.map(o=>o.text).join('\n')
 assert.equal(p.derivedFacts!.some(d=>d.metric==='STRENGTH_REPS'),false)
 assert.match(text,/已知次数小计|已知.*次数.*小计/)
 assert.match(text,/总次数未知|总次数.*不可用/)
})
test('explicit skipped segment is distinct from an unrecorded completion',()=>{
 const t=run();t.runSegments[1].completion='SKIPPED'
 assert.ok(packet(t,'跑步总距离多少？').derivedFacts!.some(d=>d.metric==='RUN_DISTANCE_M'&&d.value===200))
 t.runSegments[1].completion='NOT_RECORDED'
 const p=packet(t,'跑步总距离多少？')
 assert.equal(p.derivedFacts!.some(d=>d.metric==='RUN_DISTANCE_M'),false)
 assert.match(p.assessment.observations.map(o=>o.text).join('\n'),/小计|总距离未知/)
})
