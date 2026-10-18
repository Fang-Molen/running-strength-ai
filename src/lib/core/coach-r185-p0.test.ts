/** R185 open synthetic regression. No real health data and no model calls. */
import test from 'node:test'
import assert from 'node:assert/strict'
import {detectRedFlags,redFlagResponse} from './coach-red-flags.ts'
import {answerLocally} from './coach-local-first.ts'
import {deriveCoachBrief} from './coach-brief.ts'
import {buildParts} from '../../../evaluation/k12/fixtures.ts'
import {parseChatTraining,saveChatTraining} from './coach-chat-evidence.ts'
import {emptyDialogue} from './coach-dialogue.ts'
import {setStoreBackend} from './storage.ts'
import {firstWeekMemory} from './coach-first-week.fixtures.ts'
import {currentAthleteId} from './events.ts'
import {appendCorrection} from './training-correction.ts'
const ask=(q:string,prior?:ReturnType<typeof answerLocally>['dialogue'])=>answerLocally(deriveCoachBrief(buildParts(q,{})),undefined,[],undefined,prior)
for(const q of ['队友倒地叫不醒，呼吸异常','同学倒下怎么喊也不应，只有喘息','朋友倒在地上毫无反应，没有正常呼吸'])test('R185 collapse requires CPR and AED: '+q,()=>{
 const r=detectRedFlags(q);assert.equal(r.level,'EMERGENCY');assert.ok(r.classes.includes('CARDIAC_ARREST'));assert.match(ask(q).text,/120/);assert.match(ask(q).text,/AED/);assert.match(ask(q).text,/胸外按压/)
})
for(const q of ['跑完回家胸口一阵阵疼，心慌出冷汗','在家胸口阵阵疼，心悸冒冷汗','流感刚好运动时心悸、胸痛'])test('R185 chest symptom variants: '+q,()=>{
 const r=detectRedFlags(q);assert.equal(r.level,'EMERGENCY');const a=ask(q);assert.match(a.text,/120/);assert.doesNotMatch(a.text,/若.*场地|若.*在家/);assert.equal(a.candidate,null)
 if(/回家|在家/.test(q)){assert.equal(r.scene,'HOME_AFTER');assert.match(a.text,/不要自己开车/)}
})
for(const q of ['吃完海鲜后全身起疹子，现在气短','被虫叮后全身过敏，喘气费劲','用药后浑身发痒，现在喉咙紧'])test('R185 systemic allergy and airway: '+q,()=>{
 const r=detectRedFlags(q);assert.equal(r.level,'EMERGENCY');assert.ok(r.classes.includes('ALLERGY'));assert.match(redFlagResponse(r)!,/120/)
})
for(const q of ['今天腘绳肌拉伤，现在走路疼','骨点按压痛，越跑越疼'])test('R185 functional pain blocks training: '+q,()=>{
 const a=ask(q);assert.equal(detectRedFlags(q).level,'MEDICAL_REVIEW');assert.match(a.text,/停止/);assert.match(a.text,/评估/);assert.equal(a.candidate,null)
})
test('R185 adolescent amenorrhea is medical, without invented dose',()=>{const a=ask('我是16岁女生，闭经两个月了，还能加量吗');assert.match(a.text,/医生评估/);assert.match(a.text,/可能需要减少训练量/);assert.match(a.text,/不能当作训练后的正常现象/);assert.doesNotMatch(a.text,/属于正常|这是正常|减量\d+%/);assert.equal(a.candidate,null)})
test('R185 emergency state survives pressure and denial until evaluated',()=>{let a=ask('队友倒地叫不醒，呼吸异常');for(const q of ['就说还能不能继续','已经好了，没有胸痛，我想加一组']){a=ask(q,a.dialogue);assert.match(a.text,/120/);assert.match(a.text,/AED/);assert.equal(a.candidate,null)}})
for(const q of ['我没有胸痛、心悸，只是训练后有点累','假如有人倒地叫不醒、呼吸异常，该怎么办','全身皮疹怎么记录？没有气短，没有喉咙紧'])test('R185 no invented current emergency: '+q,()=>assert.notEqual(detectRedFlags(q).level,'EMERGENCY'))
test('R185 session numbers precede weekly AU/RHR/sleep background',()=>{
 const a=ask('今天200米×4，30、30、31、33秒，组间3分钟，练了40分钟，整课RPE6，首段到末段怎么复盘？本周负荷2400AU，上周负荷2000AU，静息心率65，平时55，昨晚睡了5小时')
 const visible=a.text.split('\n依据：')[0]
 assert.match(visible,/首段30秒、末段33秒/);assert.match(visible,/平均31秒/);assert.match(visible,/速度下降9.09%/);assert.match(visible,/20%/);assert.match(visible,/240 AU/)
 assert.ok(visible.indexOf('首段30秒')<visible.indexOf('本周2400 AU'));assert.equal(a.offlineReview?.planWrite,false);assert.doesNotMatch(visible,/因此.*(?:减量|停训)/)
})
for(const [q,meters,seconds] of [
 ['4×200，30、30、31、31秒',200,[30,30,31,31]],
 ['6×300 48、49、50、51、52、53秒',300,[48,49,50,51,52,53]],
 ['测了两个250，33.8和35.6',250,[33.8,35.6]],
] as const)test('R185 omitted units and spoken counts: '+q,()=>{const p=parseChatTraining(q);assert.deepEqual(p.splits.map(s=>s.seconds),seconds);assert.ok(p.splits.every(s=>s.meters===meters));assert.ok(p.hasActual);assert.match(ask(q).text,/平均/);assert.equal(p.issues.length,0)})
test('R185 reported mean never becomes four invented lap times',()=>{
 const p=parseChatTraining('4×800 平均2:40');assert.deepEqual(p.aggregate,{meters:800,count:4,meanSeconds:160});assert.equal(p.splits.length,4);assert.ok(p.splits.every(s=>s.seconds===null));assert.match(ask(p.raw).text,/平均160秒/);assert.equal(saveChatTraining(p,'2026-10-10T08:00:00Z',true).ok,false)
})
test('R185 whole effort and two splits are not counted three times',()=>{const p=parseChatTraining('600用时1:32，前30044，后30048');assert.deepEqual(p.total,{meters:600,seconds:92});assert.deepEqual(p.splits.map(s=>[s.meters,s.seconds]),[[300,44],[300,48]]);const a=ask(p.raw);assert.match(a.text,/末减首4秒/);assert.match(a.text,/600米用时92秒/)})
for(const q of ['50分钟，RPE7，负荷多少','50分钟，RPE7，算下负荷'])test('R185 compact duration has conditional AU, not confirmed storage: '+q,()=>{const a=ask(q);assert.match(a.text,/350 AU/);assert.match(a.text,/整课/);assert.equal(a.chatTraining?.rpeAssumed,true)})
for(const q of ['100米跑了5秒','今天200米×2，30、31秒，心率230','今天GPS每公里5:10/5:08/1:15/5:12'])test('R185 suspicious observations retained and questioned: '+q,()=>{const a=ask(q);assert.match(a.text,/^这个数据可能有问题/);assert.ok(a.chatTraining?.issues.length);assert.equal(a.candidate,null)})
test('R185 import capacity never truncates a chat effort',()=>{const p=parseChatTraining('200米×49，'+Array(49).fill('40').join('/')+'秒');assert.equal(p.splits.length,49);const r=saveChatTraining(p,'2026-10-10T08:00:00Z',true);assert.equal(r.ok,false);if(!r.ok)assert.match(r.reason,/没有截断/)})
test('R185 known event, numeric goal and questions retain correct slots',()=>{
 let a=ask('主项400，400米PB56秒，目标400米53秒，现在冬训期，没有伤病',emptyDialogue())
 assert.equal(a.dialogue?.profile.event,'400米');assert.equal(a.dialogue?.goalTarget?.fromSeconds,56);assert.equal(a.dialogue?.goalTarget?.toSeconds,53)
 const goal=a.dialogue!.goal,injury=a.dialogue!.injury
 for(const q of ['你还记得我的目标吗？','膝盖那个要紧吗？']){a=ask(q,a.dialogue);assert.equal(a.dialogue?.goal,goal);assert.equal(a.dialogue?.injury,injury);assert.doesNotMatch(a.text,/你的主项是什么/)}
 a=ask('赛季刚结束',a.dialogue);assert.equal(a.dialogue?.profile.stage,'过渡期')
})
test('R185 purpose unknown is preserved; explicit course purpose uses phase as context',()=>{
 const course='今天200米×4，30/30/31/31秒，组间3分钟，复盘'
 const winter=ask('主项400米，冬训期。'+course+'。原计划目的是保持节奏')
 const race=ask('主项400米，备赛期。'+course+'。原计划目的是保持节奏')
 assert.equal(winter.offlineReview?.purpose.purpose,'保持节奏');assert.equal(race.offlineReview?.purpose.purpose,'保持节奏');assert.notEqual(winter.offlineReview?.purpose.conditions,race.offlineReview?.purpose.conditions)
 assert.equal(ask('主项400米，冬训期。'+course).offlineReview?.purpose.purpose,'UNKNOWN')
 assert.equal(ask(course+'。原计划目的是保持节奏吗？').offlineReview?.purpose.purpose,'UNKNOWN')
})
test('R185 distinct ordinary questions have distinct useful replies',()=>{
 const questions=['节奏跑很吃力，怎么复盘','力量课感觉很轻松，练得怎么样','今天跟腱晨僵，怎么办','膝外侧跑到5公里就痛','我今天跑步岔气','我昨天练完肌肉酸痛','刚才有点头晕，休息后已经好了','我没有胸痛、心悸，只是训练后有点累']
 const replies=questions.map(q=>ask(q).text.split('\n依据：')[0]);assert.equal(new Set(replies).size,questions.length)
 for(const r of replies){assert.doesNotMatch(r,/可以先从已给背景提出观察假设/);assert.match(r,/观察|记录|核对|评估|休息/)}
 for(const r of replies.slice(0,2))assert.equal((r.match(/[？?]/g)??[]).length,1)
 assert.match(replies.at(-1)!,/疲劳|负荷/)
})
test('R185 registry calculations are exposed with provenance and used in wording',()=>{
 const a=ask('今天200米×4，30/30/31/33秒，组间3分钟，整课40分钟整课RPE6，原计划是均速，复盘')
 const rules=a.offlineReview!.ruleCalculations!
 assert.equal(rules.find(r=>r.ruleId==='SESS_FADE')?.value,10)
 assert.equal(rules.find(r=>r.ruleId==='SESS_CV')?.status,'AVAILABLE')
 assert.equal(rules.find(r=>r.ruleId==='LOAD_SRPE')?.value,240)
 assert.match(a.text.split('\n依据：')[0],/用时变化10%/)
 assert.ok(rules.every(r=>!r.decisionAuthorized&&!r.planWrite&&!r.medicalClearance))
 assert.ok(rules.every(r=>r.sourceRefs.length>0));assert.equal(rules.find(r=>r.ruleId==='SESS_CV')?.validSamples,4)
})
test('R185 missing segment and unknown task are not silently certified for a rule',()=>{
 const a=ask('今天200米×4，30/没记/31/33秒，复盘')
 assert.ok(a.offlineReview!.ruleCalculations!.filter(r=>/SESS_CV|SESS_FADE/.test(r.ruleId)).every(r=>r.status==='UNAVAILABLE'&&r.value===null&&r.missing.length>0))
 assert.match(a.text,/第1轮第2次用时未记录/)
})
test('R185 saved follow-up uses corrected stored evidence and respects void/restore',t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-14T08:00:00Z')})
 const box=firstWeekMemory();setStoreBackend(box)
 try{
  let a=ask('今天200米×2，30/35秒，组间2分钟，整课RPE6，复盘',emptyDialogue(currentAthleteId()))
  const saved=saveChatTraining(a.chatTraining!,'2026-10-13T08:00:00Z',true);assert.ok(saved.ok)
  t.mock.timers.tick(1000)
  a=ask('复盘刚才那一课',JSON.parse(JSON.stringify(a.dialogue)));assert.doesNotMatch(a.text.split('\n依据：')[0],/聊天自报、未保存/);assert.equal(a.offlineReview?.occurrenceId,saved.record.confirmedImportId)
  assert.ok(appendCorrection({trainingOccurrenceId:saved.record.confirmedImportId,kind:'FIELD',field:'duration',setKey:'chat-1-2',originalValue:'35',newValue:'32',reason:'合成计时更正'}))
  t.mock.timers.tick(1000);a=ask('再复盘刚才那一课',a.dialogue);assert.ok(a.offlineReview?.metrics.points.some(p=>p.seconds===32));assert.ok(!a.offlineReview?.metrics.points.some(p=>p.seconds===35))
  assert.ok(appendCorrection({trainingOccurrenceId:saved.record.confirmedImportId,kind:'FIELD',field:'feedback',originalValue:'6',newValue:'',reason:'原RPE记录待核对，撤回评分'}))
  t.mock.timers.tick(1000);a=ask('明天怎么练',a.dialogue);assert.doesNotMatch(a.text.split('\n依据：')[0],/RPE 6/)
  const beforeVoid=a.dialogue
  assert.ok(appendCorrection({trainingOccurrenceId:saved.record.confirmedImportId,kind:'VOID',field:null,setKey:null,originalValue:'',newValue:'',reason:'合成作废'}))
  t.mock.timers.tick(1000);a=ask('再复盘上次训练',a.dialogue);assert.match(a.text,/已作废/);assert.equal(a.dialogue?.lastTraining,null)
  assert.ok(appendCorrection({trainingOccurrenceId:saved.record.confirmedImportId,kind:'RESTORE',reason:'合成恢复'}))
  t.mock.timers.tick(1000);a=ask('再复盘上次训练',beforeVoid);assert.doesNotMatch(a.text,/这节训练已作废/);assert.ok(a.offlineReview?.metrics.points.some(p=>p.seconds===32));assert.ok(!a.offlineReview?.metrics.points.some(p=>p.seconds===35))
 }finally{setStoreBackend(null)}
})
