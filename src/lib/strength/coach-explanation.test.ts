import test from 'node:test'
import assert from 'node:assert/strict'
import { explainWithOneRepair,reviewCoachExplanation,localSafetyForTexts,type ExplainInput } from './coach-explanation'

const input=(patch:Partial<ExplainInput>={}):ExplainInput=>({text:'为什么先保持现有安排？',decision:'先维持现有安排',band:'ready',goals:'动作稳定',notes:'',energy:'',...patch})
const clean='先保持现有安排有助于观察训练反应。是否调整仍需核对真实记录和身体反馈，不能仅凭描述判断已经恢复。'
const completion=(text:string,citations:string[]=[])=>JSON.stringify({text,citations})

test('R11 explanation accepts structured bounded prose through one mock completion',async()=>{
 const calls:number[]=[]
 const result=await explainWithOneRepair(input(),async(attempt)=>{calls.push(attempt);return completion(clean)})
 assert.deepEqual(calls,[0])
 assert.equal(result.repair.attempts,0)
 assert.equal(result.repair.failed,false)
 assert.match(result.text,/观察训练反应/)
 assert.match(result.text,/没有结合你的训练记录/)
})
test('R11 explanation repairs malformed schema once and accepts the checked result',async()=>{
 const calls:number[]=[]
 const result=await explainWithOneRepair(input(),async(attempt,flags)=>{
  calls.push(attempt)
  if(attempt===1)assert.ok(flags.includes('MODEL_SCHEMA_INVALID'))
  return attempt===0?'plain unstructured text':completion(clean)
 })
 assert.deepEqual(calls,[0,1])
 assert.equal(result.repair.attempts,1)
 assert.equal(result.repair.failed,false)
 assert.match(result.text,/观察训练反应/)
})
test('R11 explanation never makes a third attempt after two malformed completions',async()=>{
 let calls=0
 const result=await explainWithOneRepair(input(),async()=>{calls++;return '{"text":77,"citations":[]}'})
 assert.equal(calls,2)
 assert.equal(result.repair.attempts,1)
 assert.equal(result.repair.failed,true)
 assert.match(result.text,/沿用现有规则.*真实|沿用现有规则.*已核对/)
 assert.doesNotMatch(result.text,/77|已移除|未通过核对/)
})
for(const [field,text,expected] of [
 ['text','刚跑完胸口痛，如果缓解能继续吗？',/120/],
 ['notes','队友刚跑完胸口痛且晕倒',/120/],
 ['notes','我现在心跳一直乱',/今天停止训练.*尽快就医/],
 ['energy','每天只吃1200大卡还在跑步训练',/运动医学和营养/],
 ['notes','膝盖痛还想继续训练',/停止诱发疼痛/],
] as const)test(`R11 explanation ${field} red flag bypasses all mock calls: ${text}`,async()=>{
 let calls=0
 const result=await explainWithOneRepair(input({[field]:text}),async()=>{calls++;throw Error('MUST_NOT_CALL')})
 assert.equal(calls,0)
 assert.equal(result.repair.attempts,0)
 assert.match(result.text,expected)
})
test('R11 separate fields cannot let a knowledge question suppress an acute note',async()=>{
 let calls=0
 const result=await explainWithOneRepair(input({text:'请讲解训练安排的知识',notes:'跑步时胸口发紧'}),async()=>{calls++;return completion(clean)})
 assert.equal(calls,0)
 assert.match(result.text,/立即.*120/)
})
test('R11 model-generated emergency overrides explanation without requesting repair',async()=>{
 const calls:number[]=[]
 const result=await explainWithOneRepair(input(),async(attempt)=>{calls.push(attempt);return completion('你现在跑完胸口痛，应该休息后继续下一组。')})
 assert.deepEqual(calls,[0])
 assert.equal(result.repair.attempts,0)
 assert.match(result.text,/立即.*120/)
 assert.doesNotMatch(result.text,/继续下一组/)
})
for(const text of ['本次完成400m，用时80秒。','本次深蹲重量是六十公斤。','你的整课RPE为6，所以可以恢复训练。','规则要求使用50kg，所以明天照做。'])test(`R11 explanation rejects quantities without formal evidence: ${text}`,()=>{
 const result=reviewCoachExplanation(input({decision:'规则暂定50kg',notes:'自述做了400m'}),completion(text))
 assert.equal(result.accepted,false)
 assert.ok(result.flags.includes('UNVERIFIED_EXPLANATION_QUANTITY'))
 assert.doesNotMatch(result.text,/400m|80秒|六十公斤|RPE为6|50kg/)
})
test('R11 explanation does not treat invented source identifiers as evidence',async()=>{
 const calls:number[]=[]
 const result=await explainWithOneRepair(input(),async(attempt,flags)=>{
  calls.push(attempt)
  if(attempt===1)assert.ok(flags.includes('UNKNOWN_OR_REVOKED_SOURCE'))
  return completion(clean,attempt===0?['invented:session:1']:[])
 })
 assert.deepEqual(calls,[0,1])
 assert.equal(result.repair.failed,false)
 assert.doesNotMatch(result.text,/invented/)
})
test('R11 explanation diagnosis wording is repaired once and never displayed',async()=>{
 let calls=0
 const result=await explainWithOneRepair(input(),async()=>{calls++;return completion('你可能是髌腱炎，所以先减少训练。')})
 assert.equal(calls,2)
 assert.equal(result.repair.failed,true)
 assert.ok(result.repair.initialFlags.includes('DIAGNOSIS_WORDING_FILTERED'))
 assert.doesNotMatch(result.text,/髌腱炎/)
})
test('R11 explanation rejects fabricated doctor attribution even when the wording filter permits attribution',()=>{
 const result=reviewCoachExplanation(input(),completion('按你提供的医生诊断，髌腱炎需要按原医生的要求处理。'))
 assert.equal(result.accepted,false)
 assert.ok(result.flags.includes('UNVERIFIED_DIAGNOSIS_ATTRIBUTION'))
 assert.doesNotMatch(result.text,/髌腱炎/)
})
test('R11 explanation preserves an explicitly supplied doctor diagnosis as attribution only',()=>{
 const result=reviewCoachExplanation(input({notes:'医生诊断为髌腱炎。'}),completion('按你提供的医生诊断，髌腱炎的处理应遵循原医生要求；这段解释不能代替就诊。'))
 assert.equal(result.accepted,true)
 assert.match(result.text,/按你提供的医生诊断/)
})
test('R11 explanation cannot turn a denied doctor diagnosis into an attributed diagnosis',()=>{
 const result=reviewCoachExplanation(input({notes:'我没有被医生诊断为髌腱炎。'}),completion('按你提供的医生诊断，髌腱炎需要按原医生的要求处理。'))
 assert.equal(result.accepted,false)
 assert.ok(result.flags.includes('UNVERIFIED_DIAGNOSIS_ATTRIBUTION'))
 assert.doesNotMatch(result.text,/髌腱炎/)
})
test('R11 explanation failed repair transport retains the meaningful local explanation',async()=>{
 let calls=0
 const result=await explainWithOneRepair(input({band:'tired'}),async(attempt)=>{calls++;if(attempt===1)throw Error('mock timeout');return completion('建议再加一组，提高训练重量。')})
 assert.equal(calls,2)
 assert.equal(result.repair.failed,true)
 assert.match(result.text,/疲劳偏高.*增加要求/)
 assert.doesNotMatch(result.text,/建议再加一组/)
})
test('R11 shared transport preflight returns local medical review for nonemergency pain',()=>{
 const turn=localSafetyForTexts(['膝盖痛，还能继续训练吗？'])
 assert.ok(turn)
 assert.equal(turn.medicalReferral,true)
 assert.equal(turn.nextStep,null)
 assert.equal(turn.planChanged,false)
 assert.match(turn.text,/停止诱发疼痛/)
})
