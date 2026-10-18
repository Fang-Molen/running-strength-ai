import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,readdirSync} from 'node:fs'
import {detectRedFlags,redFlagResponse, type RedFlagLevel} from './coach-red-flags.ts'
import {request} from '../../../evaluation/r6/fixtures.ts'
import {interpretCoachModelOutput,coachLocalSafetyTurn,normalizeAskCoachInput} from '../strength/coach-pipeline'
import {deriveCoachBrief} from './coach-brief'
import {buildParts} from '../../../evaluation/k12/fixtures.ts'
const dir=new URL('./__fixtures__/red-flags/',import.meta.url)
for(const file of readdirSync(dir))for(const [i,line] of readFileSync(new URL(file,dir),'utf8').trim().split('\n').entries()){
 const row=JSON.parse(line)
 test(`R11 red flags ${file}/${i}: ${row.text}`,()=>{
  const result=detectRedFlags(row.text)
  assert.equal(result.level,row.expectLevel)
  for(const cls of row.expectClasses)assert.ok(result.classes.includes(cls),cls)
  if(row.subject!=='UNKNOWN')assert.equal(result.subject,row.subject)
  if(result.level==='EMERGENCY'){
   const text=redFlagResponse(result)!
   assert.match(text,/立即.*120|立即.*当地急救/)
   assert.doesNotMatch(text,/若.{0,15}(?:120|急救)|不缓解再|RPE|睡眠|下一课|补记录|配速|心肌|热射病/)
  }
 })
}
for(const q of ['队友在34度跑完皮肤干热且答非所问','我今天跑完胸口疼，左臂发麻，歇后缓解了','我练完腰疼，右腿发麻','我女儿16岁停经还在每天训练'])for(const bad of ['休息后继续下一组，RPE多少？','若不缓解再打120，明天减量。','可能是心肌炎，今天轻松跑。'])test(`R11 full pipeline safety overrides ${q}/${bad}`,()=>{
 const d=request([],undefined,undefined,q),prior=coachLocalSafetyTurn(d)
 assert.ok(prior)
 const result=interpretCoachModelOutput(d,JSON.stringify({mode:'answer',text:bad,nextStep:'下一课再跑',citations:[]}))
 assert.equal(result.turn.nextStep,null);assert.equal(result.turn.medicalReferral,true)
 assert.doesNotMatch(result.turn.text,/RPE|明天|下一课|心肌炎|轻松跑/)
 if(detectRedFlags(q).level==='EMERGENCY')assert.match(result.turn.text,/120/)
})
for(const q of ['我非常累且胸口痛','我觉得没事儿但胸口发紧','我不一定晕倒但今天眼前发黑','我没有胸痛，不过心跳一直乱'])test(`R11 pseudo-negation ${q}`,()=>assert.notEqual(detectRedFlags(q).level,'NONE'))
test('R11 a historical nonmedical activity is not a historical symptom',()=>assert.equal(detectRedFlags('我去年曾经极限测试，现在完全没有不适').level,'NONE'))
test('R11 sustained resting numeric heart rate gets prompt medical review',()=>assert.equal(detectRedFlags('我运动后静坐休息20分钟，心率是145次，今天还这样').level,'URGENT_MEDICAL'))

for(const q of [
 '跑步时胸口发紧，如果休息后缓解能继续吗？',
 '刚跑完胸闷，如果不难受了还用看医生吗？',
 '跑步时胸口发紧。如何预防下次再发生？',
 '上周感冒，现在跑步胸口发紧。',
 '去年曾经头晕；现在队友跑完胸口发紧。',
 '请解释胸痛的知识；我现在跑完胸口发紧。',
 '假如跑步胸闷怎么办？我现在刚跑完胸口发紧。',
 '我现在跑完胸口发紧；去年也曾经胸闷。',
 '上周感冒现在跑步胸口发紧',
 '跑步时胸口发紧如果休息后缓解能继续吗',
 '刚跑完胸闷想了解怎么处理',
 '上周感冒现在跑步胸口发紧如果缓解能继续吗',
])test(`R11 clause scope retains actual symptoms: ${q}`,()=>{
 const result=detectRedFlags(q)
 assert.equal(result.level,'EMERGENCY')
 assert.equal(result.temporal,'CURRENT')
 assert.ok(result.classes.includes('CARDIOVASCULAR'))
 assert.match(redFlagResponse(result)!,/立即.*120/)
})

for(const [q,expected] of [
 ['如果跑步胸闷，左臂发麻，应该怎么办？','NONE'],
 ['假设我今天跑步胸闷，心跳很快，休息后缓解了。','NONE'],
 ['请解释运动后胸闷，左臂发麻的一般知识。','NONE'],
 ['科普：有人今天跑完胸口发紧，心跳很快，应该怎样处理？','NONE'],
 ['上周跑步胸口发紧，左臂发麻，休息后缓解了。','MEDICAL_REVIEW'],
 ['我现在没有胸痛；如果跑步胸闷，左臂发麻，应该怎么办？','NONE'],
 ['假设静坐休息20分钟，心率是145次；我现在没有不适。','NONE'],
 ['上周静坐休息20分钟，心率是145次；现在心率是70次且没有不适。','NONE'],
 ['如果现在跑步胸口发紧怎么办','NONE'],
 ['请解释现在运动后胸口发紧应当怎么处理','NONE'],
 ['我现在读了跑步胸闷的知识，想了解怎样应对。','NONE'],
 ['如果现在静坐休息20分钟心率145次怎么办','NONE'],
 ['假设34度时跑步，皮肤干热；我现在没有不适。','NONE'],
 ['假设跑步者每天摄入1200大卡，我现在训练后没有不适。','NONE'],
] as const)test(`R11 clause scope retains nonactual symptoms: ${q}`,()=>{
 const result=detectRedFlags(q)
 assert.equal(result.level,expected)
 assert.ok(!result.classes.includes('CARDIOVASCULAR'))
 assert.doesNotMatch(redFlagResponse(result)??'',/120|立即.*急救/)
})

test('R11 urgent reply covers concurrent cardiovascular and neurological symptoms',()=>{
 const result=detectRedFlags('我现在腰痛，左腿发麻，心慌一直没缓解。')
 assert.equal(result.level,'URGENT_MEDICAL')
 assert.deepEqual(new Set(result.classes),new Set(['CARDIOVASCULAR','NEUROLOGICAL']))
 const reply=redFlagResponse(result)!
 assert.match(reply,/今天停止训练.*尽快就医/)
 assert.match(reply,/心跳异常/)
 assert.match(reply,/腰背、肢体感觉或力量变化/)
 assert.match(reply,/不安排补课/)
})
test('R11 urgent reply retains respiratory, illness, energy and youth actions together',()=>{
 const result=detectRedFlags('女儿16岁，今天病后心慌，气短，膝盖痛，节食后闭经还想加量。')
 assert.equal(result.level,'URGENT_MEDICAL')
 for(const cls of ['CARDIOVASCULAR','RESPIRATORY','POST_ILLNESS','ENERGY','YOUTH','PAIN'] as const)assert.ok(result.classes.includes(cls),cls)
 const reply=redFlagResponse(result)!
 for(const phrase of ['心跳异常','呼吸异常','近期生病','运动医学和营养评估','监护人','疼痛部位','不要加量'])assert.ok(reply.includes(phrase),phrase)
 assert.doesNotMatch(reply,/轻松跑|下一课|强度建议/)
})

for(const q of ['跑步时胸口发紧，如果休息后缓解能继续吗？','跑步时胸口发紧。如何预防下次再发生？','上周感冒，现在跑步胸口发紧。'])test(`R11 mixed temporal context keeps full pipeline emergency override: ${q}`,()=>{
 const data=request([],undefined,undefined,q)
 const prior=coachLocalSafetyTurn(data)
 assert.ok(prior)
 const result=interpretCoachModelOutput(data,JSON.stringify({mode:'answer',text:'休息后继续下一组，明天轻松跑。',nextStep:'下一课再跑',citations:[]}))
 assert.equal(result.turn.nextStep,null)
 assert.equal(result.turn.medicalReferral,true)
 assert.match(result.turn.text,/立即.*120/)
 assert.doesNotMatch(result.turn.text,/下一组|明天|轻松跑|下一课/)
})

for(const [q,boundary] of [
 ['我训练时膝盖痛。',/停止诱发疼痛/],
 ['我16岁，想做1RM极限测试。',/监护人.*不远程安排极限测试/],
] as const)test(`R11 unbound medical-review turn replaces model training advice: ${q}`,()=>{
 const data=normalizeAskCoachInput({brief:deriveCoachBrief(buildParts(q,{}))})
 assert.equal(data.brief.occurrenceId,null)
 const local=coachLocalSafetyTurn(data)
 assert.ok(local)
 assert.match(local.text,boundary)
 const result=interpretCoachModelOutput(data,JSON.stringify({mode:'answer',text:'休息后继续下一组，明天轻松跑，RPE多少？',nextStep:'下一课再加一组',citations:[]}))
 assert.match(result.turn.text,boundary)
 assert.doesNotMatch(result.turn.text,/继续下一组|明天轻松跑|RPE|再加一组/)
 assert.equal(result.turn.nextStep,null)
 assert.equal(result.turn.medicalReferral,true)
 assert.equal(result.turn.planChanged,false)
 assert.ok(result.v4.flags.includes('RED_FLAG_PRE_AND_POST'))
})
test('R11 generated same-level medical language cannot replace the input pain category',()=>{
 const data=normalizeAskCoachInput({brief:deriveCoachBrief(buildParts('我训练时膝盖痛。',{}))})
 const turn=coachLocalSafetyTurn(data,undefined,'你还持续恶心，休息后继续下一组。')
 assert.ok(turn)
 assert.match(turn.text,/停止诱发疼痛/)
 assert.doesNotMatch(turn.text,/继续下一组/)
})
for(const relation of ['妹妹','姐姐','弟弟','哥哥','母亲','父亲'])test(`R11 family report identifies the affected other person: ${relation}`,()=>{
 const result=detectRedFlags(`我${relation}跑步后皮肤干热，而且答非所问。`)
 assert.equal(result.level,'EMERGENCY')
 assert.equal(result.subject,'OTHER')
 assert.match(redFlagResponse(result)!,/请在场的人立即协助当事人/)
})
test('R11 a first-person symptom report remains SELF',()=>{
 assert.equal(detectRedFlags('我本人跑步后皮肤干热，而且答非所问。').subject,'SELF')
})

for(const q of ['所选训练记录：疼痛0/10，睡眠7小时。','疼痛评分：0分。','现在有无局部疼痛或不适？','出现疼痛时停止。','疼痛加重时应停止相关动作。','停止条件：疼痛加重、动作变形。','疼痛变化还需核对。','疼痛记录未知。','出现局部疼痛加重、动作变形、步态改变就停止相关训练。'])test(`R11 precaution or unknown pain is not an actual symptom: ${q}`,()=>{
 assert.equal(detectRedFlags(q).level,'NONE')
})
for(const q of ['我现在疼痛，程度还需核对。','我疼痛程度待核对。','我训练时膝盖痛。','疼痛0.5/10。','疼痛1/10。','膝盖痛，记录却是疼痛0/10。','我出现疼痛时停止了训练。'])test(`R11 actual or nonzero pain remains medical review: ${q}`,()=>{
 assert.equal(detectRedFlags(q).level,'MEDICAL_REVIEW')
})
test('R11 a conditional stop rule cannot downgrade an earlier actual emergency',()=>{
 assert.equal(detectRedFlags('我刚跑完胸口痛。停止条件：疼痛加重时停止。').level,'EMERGENCY')
})
test('R11 model stop conditions do not override valid unbound general analysis',()=>{
 const data=normalizeAskCoachInput({brief:deriveCoachBrief(buildParts('怎样记录训练反应？',{}))})
 const result=interpretCoachModelOutput(data,JSON.stringify({mode:'answer',text:'记录训练反应和日常活动变化。出现疼痛时停止相关动作，疼痛变化还需核对。',citations:[],nextStep:null}))
 assert.match(result.turn.text,/记录训练反应和日常活动变化/)
 assert.doesNotMatch(result.turn.text,/具体何时出现/)
 assert.equal(result.turn.medicalReferral,false)
})
