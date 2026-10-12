import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { TEACHING_RULES, TEACHING_SOURCES, TEACHING_EXAMPLES } from './coach-curriculum-data.ts'
import { retrieveCurriculum, retrieveTeachingExamples, buildCurriculumModelContext, calculateStatedSessionLoads } from './coach-curriculum.ts'
import { retrieveCognitionKnowledge } from './coach-cognition-knowledge.ts'
import { answerLocally } from './coach-local-first.ts'
import { assembleCoachBrief } from './coach-brief.ts'
import { setStoreBackend } from './storage.ts'
const ask=(question:string)=>answerLocally(assembleCoachBrief(null,question,null))
const has=(q:string,id:string)=>retrieveCurriculum(q).lessons.some(r=>r.originalId===id)

test('intake retains 30 author rules, 19 sources and 10 synthetic examples',()=>{
 assert.equal(TEACHING_RULES.length,30);assert.equal(TEACHING_SOURCES.length,19);assert.equal(TEACHING_EXAMPLES.length,10)
 for(const group of ['01','02','03','04','05'])assert.equal(TEACHING_RULES.filter(r=>r.core.startsWith(group)).length,6)
})
test('all imported references and case rule links resolve',()=>{
 const s=new Set(TEACHING_SOURCES.map(x=>x.id)),r=new Set(TEACHING_RULES.map(x=>x.id))
 for(const rule of TEACHING_RULES)assert.ok(rule.evidenceRefs.every(id=>s.has(id)))
 for(const e of TEACHING_EXAMPLES){assert.ok(e.evidenceRefs.every(id=>s.has(id)));assert.ok(e.ruleRefs.every(id=>r.has(id)))}
})
test('import never promotes author rules to approved medical or athlete knowledge',()=>{
 assert.ok(TEACHING_RULES.every(r=>r.authority==='AUTHOR_TEACHING_CANDIDATE'&&!r.prescriptionApproved))
 assert.ok(TEACHING_SOURCES.every(r=>r.independentlyReverifiedDuringImport===false))
 assert.ok(TEACHING_EXAMPLES.every(e=>e.dataOrigin==='SYNTHETIC_TEACHING'&&!e.eligibleForAthleteMemory))
})
test('reported verification depths remain 8 body excerpts, 7 abstracts, 4 search excerpts',()=>{
 for(const [name,n] of [['BODY_EXCERPTS_REPORTED',8],['ABSTRACT_REPORTED',7],['SEARCH_EXCERPT_REPORTED',4]] as const)assert.equal(TEACHING_SOURCES.filter(s=>s.reportedCheckDepth===name).length,n)
})
const checks:[string,string][]=[
 ['400米只有目标和周频，先告诉我方向，缺什么再问','P01'],
 ['两位800米同样成绩，需要用同一计划吗','P02'],
 ['我没有手表，如何用训练感受看恢复','R04'],
 ['HRV回升是否就是恢复好','R03'],
 ['间歇由6分钟缩为3分钟，变慢代表什么','C03'],
 ['训练都完成了，成绩未改善，适应是什么','C04'],
 ['论文里80次试跳是80名受试者吗，只有摘要','A02'],
 ['两个AI赞同就能当证据吗','A04'],
 ['倒班漏课，要把欠的补上吗','D04'],
 ['第四次恢复差是反例，固定48小时恢复规律还成立吗','D05'],
]
for(const [q,id] of checks)test(`retrieval variation: ${id}`,()=>assert.ok(has(q,id)))
test('weekly frequency is not a personal recovery pattern',()=>assert.equal(has('一周三次400米，只有目标，缺什么先问','D05'),false))
test('unrelated question is not force-fed training curriculum',()=>assert.equal(retrieveCurriculum('帮我翻译这句话').lessons.length,0))
test('the actual local entry uses imported recovery rules without a saved occurrence',()=>{const a=ask('我没有手表，如何用训练感受看恢复');assert.ok(a.sources.includes('FK5R1:R04'));assert.match(a.text,/降低量化精度而不是取消服务/);assert.equal(a.cognition?.decisionAuthorization??false,false)})
test('existing event cognition actually contains the selected imported rule',()=>{const a=ask('400米休息从8分钟缩为3分钟，变慢说明什么');assert.ok(a.cognition?.knowledge.some(k=>k.id==='FK5R1:C03'&&k.verification==='CANDIDATE'));assert.ok(a.cognition?.curriculum)})
test('device audit remains, with HRV principles rather than recovery clearance',()=>{const a=ask('手表HRV回升，和主观感觉不一致，能说明恢复好吗');assert.ok(a.deviceAudit);assert.ok(a.sources.includes('FK5R1:R03'));assert.match(a.text,/不与恢复许可画等号/)})
test('full-session calculations use question numbers, not demonstration numbers',()=>{const q='整课负荷：40分钟RPE6，80分钟RPE3';assert.equal(calculateStatedSessionLoads(q).length,2);const a=ask(q);assert.match(a.text,/240任意单位/);assert.doesNotMatch(a.text,/270/)})
test('missing, OCR and invalid session inputs are not filled or computed',()=>{for(const q of ['主段40分钟RPE6','OCR整课40分钟RPE6','整课-40分钟RPE6','整课40分钟RPE15','整课40分钟RPE0'])assert.deepEqual(calculateStatedSessionLoads(q),[])})
test('arithmetic-only request does not force causal hypotheses or plan changes',()=>{const a=ask('400米重复跑实际70,73,76秒，只计算平均用时');assert.match(a.text,/平均73秒/);assert.deepEqual(a.cognition?.hypotheses,[]);assert.deepEqual(a.cognition?.options,[])})
test('explicit synthetic example is clearly separated from personal evidence',()=>{const a=ask('给我一个合成的400米教学案例，说明新证据如何改变判断');assert.ok(a.teachingExampleIds?.length);assert.match(a.text,/不是你的训练记录或能力/);assert.equal(a.cognition,undefined)})
test('ordinary recovery answer does not copy the example athlete numbers',()=>{const a=ask('HRV回升能否说明完全恢复');assert.doesNotMatch(a.text,/29\.2|31\.3|2分08|71次|255次/)})
test('all retrievals are read-only and network-free',()=>{
 const data=new Map<string,string>([['sentinel','keep']]);setStoreBackend({getItem:k=>data.get(k)??null,setItem:()=>{throw Error('WRITE_FORBIDDEN')}})
 const before=JSON.stringify([...data]);for(const [q] of checks)ask(q);assert.equal(JSON.stringify([...data]),before);setStoreBackend(null)
})
test('returned teaching data cannot mutate the embedded catalog',()=>{const a=retrieveCurriculum('HRV回升');a.lessons[0].guidance='MUTATED';assert.notEqual(retrieveCurriculum('HRV回升').lessons[0].guidance,'MUTATED')})
test('safety response cannot be replaced by a teaching answer',()=>{const a=ask('400米冲刺时突然胸痛，还想跑下一组');assert.match(a.text,/急诊|急救/);assert.equal(a.teachingExampleIds,undefined);assert.equal(a.cognition,undefined);assert.equal(a.escalationAvailable,false)})
test('source check depths are not confused with candidate rule verification',()=>{assert.ok(retrieveCognitionKnowledge(['400米'],'怎么安排训练目标').filter(k=>k.teachingRuleId).every(k=>k.verification==='CANDIDATE'&&k.prescriptionApproved===false));assert.equal(retrieveCognitionKnowledge(['400米']).filter(k=>k.verification==='FULL_TEXT_CHECKED').length,2)})
test('online context is bounded and pending sources are not usable as checked evidence',()=>{
 const q='倒班睡眠压力补给不适恢复，论文引用研究样本，调整计划反例，400米教学案例'
 for(const budget of [1000,3000,7000]){const c=buildCurriculumModelContext(q,budget);assert.ok(JSON.stringify(c).length<=budget);assert.ok(c.references.every(s=>s.reportedCheckDepth!=='SEARCH_EXCERPT_REPORTED'));assert.ok(c.pendingResearch.every(s=>!s.usableAsVerifiedEvidence));assert.equal(c.decisionAuthorization,false)}
})
test('model context has no hidden exam answers or copied personal source IDs',()=>{const c=buildCurriculumModelContext('400米重复跑间歇变慢如何调整');const text=JSON.stringify(c);assert.doesNotMatch(text,/public_variations|expected_assertions|blind_test|trainingOccurrenceId/);if(c.syntheticExample)assert.equal(c.syntheticExample.eligibleForAthleteMemory,false)})
test('the real server handler uses curriculum only after existing authorization',()=>{
 const source=readFileSync(new URL('../strength/coach-ai.ts',import.meta.url),'utf8');assert.ok(source.includes('buildCurriculumModelContext(data.brief.question)'));assert.ok(source.includes('JSON.stringify({ ...basePacket, knowledgeContext })'));assert.ok(source.indexOf('beginModelCall()',source.indexOf('export const askCoach'))<source.indexOf('buildCurriculumModelContext(data.brief.question)'));assert.match(source,/coachSystemPrompt\(kind, intent, recoveryConflict, highRpeGap, sorenessOnly\) \+ CURRICULUM_SYSTEM_BOUNDARY/)
})
test('public evaluation variants stay outside runtime source imports',()=>{const source=readFileSync(new URL('./coach-curriculum.ts',import.meta.url),'utf8');assert.doesNotMatch(source,/evaluation\/|public-variations\.json|input-only\.json/);assert.equal(retrieveTeachingExamples('400米间歇变慢调整',1).every(e=>e.dataOrigin==='SYNTHETIC_TEACHING'),true)})
