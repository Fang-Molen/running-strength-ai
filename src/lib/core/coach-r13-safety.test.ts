/** R13 examples are 自行生成; these are open regression cases, not unseen acceptance questions. */
import test from 'node:test'
import assert from 'node:assert/strict'
import {detectRedFlags,redFlagResponse,type RedFlagLevel} from './coach-red-flags.ts'
import {normalizeAskCoachInput,interpretCoachModelOutput,coachLocalSafetyTurn} from '../strength/coach-pipeline.ts'
import {deriveCoachBrief} from './coach-brief.ts'
import {buildParts} from '../../../evaluation/k12/fixtures.ts'
import {answerLocally} from './coach-local-first.ts'
import {presentCoachAnswer} from './coach-persona.ts'
const data=(q:string)=>normalizeAskCoachInput({brief:deriveCoachBrief(buildParts(q,{}))})
const groups:[string,RedFlagLevel,string[]][]=[
 ['arrest','EMERGENCY',['心跳突然停了，人叫不醒','倒在地上毫无反应，没有正常呼吸','倒地后怎么叫都没反应']],
 ['allergy','EMERGENCY',['吃了花生后嗓子眼堵住了，嘴唇也肿起来','被蜂蜇了之后脸肿，喘气费劲','进食后喉咙越来越紧，呼吸越来越困难']],
 ['stroke','EMERGENCY',['左手忽然无力，拿不住杯子，讲话含混','半边脸发麻，舌头打结','右腿突然抬不起来，眼前的东西有重影','左手使不上力，手机总是掉下去']],
 ['breathing','EMERGENCY',['呼吸非常困难，指甲变紫了','呼吸费力，口唇已经发紫','喘不上气，嘴唇青紫']],
 ['heat','EMERGENCY',['闷热场地里吐了好几次，皮肤干烫','在烈日下跑，开始胡言乱语','炎热天气运动后一直吐']],
 ['rhythm','EMERGENCY',['心率200一直下不来，感觉快晕过去了','病刚好就心悸，胸口一阵疼','流感后心脏乱跳，胸前像压了石头']],
 ['cauda','EMERGENCY',['腰剧痛，两条腿都无力，排尿控制不住','腰部疼得厉害，双腿发麻，大便失禁','腰痛，双腿没劲，排便失控']],
 ['lumbar','URGENT_MEDICAL',['腰里像过电一样，右腿发麻','腰有电击感，左腿麻木']],
 ['bone','MEDICAL_REVIEW',['胫骨有一点按着疼，而且越跑越痛','足背局部压痛，跑起来越来越疼']],
]
for(const [name,level,texts] of groups)for(const text of texts)for(const subject of ['我现在','我的同伴现在'])test(`自行生成 R13 ${name}/${subject}${text}`,()=>{
 const q=subject+text,r=detectRedFlags(q)
 assert.equal(r.level,level);assert.equal(r.subject,subject.includes('同伴')?'OTHER':'SELF')
 const local=coachLocalSafetyTurn(data(q));assert.ok(local);assert.equal(local.planChanged,false)
 if(level==='EMERGENCY'){
  assert.match(local.text,/120/);assert.doesNotMatch(local.text,/RPE|睡眠|配速|下一组|保护头部|冷水|湿毛巾|吞咽/)
  const sentences=local.text.split(/[。！？]/).filter(Boolean);assert.ok(sentences.length>=2&&sentences.length<=4)
 }
})
for(const text of ['刚才有点头晕，休息后已经好了','刚跑完轻微头晕，现在完全缓解了','刚才轻度头晕，目前恢复正常','跑后肌肉酸痛','运动时抽筋','慢跑有点岔气','训练后有点疲劳'])test(`自行生成 R13 ordinary discomfort: ${text}`,()=>{
 assert.equal(detectRedFlags('我'+text).level,'NONE')
 const reply=answerLocally(data('我'+text).brief)
 assert.doesNotMatch(reply.text,/拨打120/)
})
for(const q of ['我刚跑完胸口疼，休息后已经好了','我刚才晕倒了，现在完全缓解了','我轻微头晕，休息后已经好了，但是右手无力、口齿不清'])test(`自行生成 resolved severe symptom retained: ${q}`,()=>assert.equal(detectRedFlags(q).level,'EMERGENCY'))
test('scenario replies remain 2–4 sentences through every persona',()=>{
 for(const [q,required] of [
  ['我正在操场跑步，胸口痛',/原地坐下或躺下.*不要继续跑.*陪着/],
  ['我跑完几小时后晚上在家胸口痛',/不要自己开车.*家人或室友.*门别反锁/],
  ['我胸口痛',/停止活动.*120/],
  ['同伴倒地，心跳停了',/你现在就拨打120.*留在.*AED/],
 ] as const){
  const r=redFlagResponse(detectRedFlags(q))!;assert.match(r,required)
  for(const persona of ['balanced','strict','gentle','analytical'] as const)assert.equal(presentCoachAnswer(r,persona),r)
 }
 assert.doesNotMatch(redFlagResponse(detectRedFlags('同伴胸口痛'))!,/AED/)
})
const counterexamples=[
 '是否出现胸痛？','有没有胸口发紧？','请问呼吸是否困难？','请问有头晕、心慌吗？',
 '现在有无单侧无力？','请确认有没有口齿不清。','你的嘴唇有没有发紫？','是否有皮肤干烫的情况？',
 '有无喉咙发紧、面部肿胀？','请问是否拿不住东西？','有没有排尿失控？','请问是否曾晕倒？',
 '确认没有胸痛之前，不安排强度。','确认没有头晕、心慌之前，先核对反馈。',
 '在确认没有呼吸困难之前，暂缓讨论训练。','确认没有腰痛和腿麻之后再核对记录。',
 '如果出现胸痛，立即停止活动并求助。','若有口唇发紫，立即联系急救。',
 '一旦出现口齿不清，应停止活动并求助。','假如发生喉咙发紧，应及时求助。',
 '万一出现单侧无力，不继续运动。','出现疼痛时停止相关动作。',
 '头晕加重时应停止运动。','停止条件：胸痛、呼吸困难、晕倒。',
 '没有胸痛。','你没有心悸。','目前没有头晕。','你现在没有口齿不清。',
 '并无呼吸困难。','没有喉咙发紧，也没有嘴唇肿胀。','没有意识不清、没有晕倒。','你否认腰痛和腿麻。',
 '胸痛是否发生还需要确认。','头晕记录未知。','呼吸不适的情况尚需核对。','疼痛评分未记录。',
 '你有胸痛吗？','你会出现心慌吗？','心跳异常属于需要留意的信号。','讲解如何识别严重过敏。',
]
for(const [i,prose] of counterexamples.entries())test(`自行生成 full pipeline nonassertion ${i+1}: ${prose}`,()=>{
 const d=data('怎样记录每天的训练感受？')
 assert.equal(detectRedFlags(d.brief.question).level,'NONE')
 assert.equal(coachLocalSafetyTurn(d,undefined,prose),null)
 const original='记录训练反应和日常活动变化。'+prose
 const r=interpretCoachModelOutput(d,JSON.stringify({mode:'answer',text:original,citations:[],nextStep:null,medicalReferral:false}))
 assert.ok(!r.v4.flags.includes('RED_FLAG_PRE_AND_POST'));assert.ok(!r.v4.flags.includes('RED_FLAG_POST_REVIEW'))
 assert.match(r.turn.text,/记录训练反应和日常活动变化/);assert.equal(r.turn.medicalReferral,false)
})
for(const prose of ['你现在胸口疼。','你已经出现口齿不清。','目前嘴唇发紫，呼吸非常困难。','当事人现在晕倒了。','你仍然心慌。'])test(`自行生成 generated present assertion escalates: ${prose}`,()=>{
 const d=data('怎样记录每天的训练感受？')
 const r=interpretCoachModelOutput(d,JSON.stringify({mode:'answer',text:prose,citations:[],nextStep:null}))
 assert.equal(r.turn.medicalReferral,true);assert.equal(r.turn.nextStep,null);assert.ok(r.v4.flags.includes('RED_FLAG_PRE_AND_POST'))
})
test('generated question never cancels preflight emergency or changes affected person',()=>{
 const d=data('我朋友现在倒地没有反应')
 const r=interpretCoachModelOutput(d,JSON.stringify({mode:'answer',text:'你是否有胸痛？',citations:[],nextStep:'确认没有胸痛之前先休息。'}))
 assert.match(r.turn.text,/当事人.*你现在就拨打120/);assert.equal(r.turn.nextStep,null)
})
