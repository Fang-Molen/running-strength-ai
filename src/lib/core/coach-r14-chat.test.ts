/** R14 自行生成公开合成数据。无真实运动员、无模型、无网络。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {answerLocally} from './coach-local-first.ts'
import {deriveCoachBrief} from './coach-brief.ts'
import {buildParts} from '../../../evaluation/k12/fixtures.ts'
import {emptyDialogue,coachPrimaryIntent,type CoachDialogue} from './coach-dialogue.ts'
import {parseChatTraining,chatEvolution,saveChatTraining} from './coach-chat-evidence.ts'
import {buildOfflineReview,emptyOfflineProfile,saveOfflineProfile,readOfflineProfile} from './coach-offline-loop.ts'
import {detectRedFlags} from './coach-red-flags.ts'
import {normalizeAskCoachInput,interpretCoachModelOutput} from '../strength/coach-pipeline.ts'
import {retrieveResearchIndex} from './coach-research-index.ts'
import {setStoreBackend} from './storage.ts'
import {firstWeekMemory} from './coach-first-week.fixtures.ts'
import {loadConfirmedTrainingImports} from './training-import.ts'
const ask=(q:string,state?:CoachDialogue)=>answerLocally(deriveCoachBrief(buildParts(q,{})),undefined,[],undefined,state)
const visible=(text:string)=>text.split('\n依据：')[0]
const assertHuman=(text:string)=>{assert.doesNotMatch(visible(text),/线上大模型|申请.*模型|量化证据不足|UNKNOWN|UNAVAILABLE|NOT_RECORDED|\[fact:|R168:|PB-|数据充分性\s*L\d/);assert.ok((visible(text).match(/[？?]/g)??[]).length<=2)}
test('public 200m×4 runs through the same offline kernel and uses exact results',()=>{
 const r=ask('今天200m×4，39/38/37/36秒，组间3分钟，练了50分钟，RPE7，练得怎么样？')
 // R171/R173 explicitly require sample SD: sqrt(5/3)/37.5*100 = 3.44265…%, not population CV 2.98%.
 assert.ok(r.offlineReview);assert.ok(r.chatTraining);assert.match(r.text,/首段39秒、末段36秒/);assert.match(r.text,/末减首-3秒/);assert.match(r.text,/平均37.5秒/);assert.match(r.text,/4\/4/);assert.match(r.text,/350 AU/);assert.match(r.text,/3.44%/);assert.match(r.text,/样本标准差/);assert.match(r.text,/未保存/)
 assert.doesNotMatch(visible(r.text),/没有.*实际课次|没选.*课次|主观强度未知|恢复未知/);assertHuman(r.text)
})
for(const q of ['今天练了50分钟，RPE7','练了50分钟 RPE 7','今天训练50分钟RPE7，算下负荷','今天训练50分钟，整课RPE7'])test('duration and rating variants: '+q,()=>{const r=ask(q);assert.match(r.text,/350 AU/);assertHuman(r.text)})
test('per-set RPE does not become a whole-session fact',()=>{const p=parseChatTraining('今天练了50分钟，末组RPE7');assert.equal(p.rpe,null);assert.equal(ask('今天练了50分钟，末组RPE7').text.includes('350 AU'),false)})
test('nested rounds, missing slots and rest survive actual confirmation without plan changes',()=>{
 const box=firstWeekMemory();setStoreBackend(box);box.setItem('fr255-strength-plan','unchanged')
 try{const p=parseChatTraining('今天200米×4×2，39/38/没记/36/40/41/42/43秒，组间2分钟，轮间8分钟，整课40分钟，RPE6')
  assert.equal(p.rounds,2);assert.equal(p.splits.length,8);assert.equal(p.splits[2].seconds,null);assert.equal(p.roundRestSeconds,480)
  const r=ask(p.raw);assert.match(r.text,/第1轮第3次用时未记录/);assert.match(r.text,/7\/8/);assert.match(r.text,/480秒/)
  assert.equal(loadConfirmedTrainingImports().length,0);assert.equal(saveChatTraining(p,'2026-10-10T08:00:00Z',false).ok,false)
  const saved=saveChatTraining(p,'2026-10-10T08:00:00Z',true);assert.ok(saved.ok)
  assert.deepEqual(saved.record.runningSegments.filter(s=>s.kind!=='RECOVERY').map(s=>[s.round.value,s.repeat.value]),[[1,1],[1,2],[1,3],[1,4],[2,1],[2,2],[2,3],[2,4]])
  assert.equal(saved.record.runningSegments[2].completion,'NOT_RECORDED');assert.equal(box.getItem('fr255-strength-plan'),'unchanged')
  assert.ok(saveChatTraining(p,'2026-10-10T08:00:00Z',true).ok);assert.equal(loadConfirmedTrainingImports().length,1)
 }finally{setStoreBackend(null)}
})
for(const [q,intent,first] of [
 ['今天练了50分钟RPE7，周负荷2000AU，明天练什么？','NEXT',/明天的课程尚未确认.*具体观察任务/],
 ['赛前一周，静息心率65，平时55，本周3000AU，今天要不要加组？','INCREASE',/今天不建议加/],
 ['手表说恢复了但我很累，听手表还是听感觉？','CONFLICT',/先听身体/],
 ['上周30公里本周42公里，这周量是不是加多了？','WEEK',/这周先别/],
 ['月经期痛经，教练要我加量怎么办？','INCREASE',/不.*强行加量/],
] as const)test('main question outranks secondary AU/device: '+q,()=>{assert.equal(coachPrimaryIntent(q),intent);const r=ask(q);assert.match(visible(r.text).split('。')[0],first);assertHuman(r.text);assert.doesNotMatch(r.text,/整课RPE和.*各是多少/)})
const emergencies={
 arrest:['队友无反应且呼吸异常','同伴叫不醒，只有偶尔抽气','朋友倒在地上没有反应，像鱼一样喘'],
 cyanosis:['跑步时口唇发紫，说话不成句','训练中甲床青紫，气不够','我正在跑步，严重气促，指甲紫了'],
 illness:['病后运动心悸，胸口疼','流感刚好，跑步时心脏乱跳伴胸痛','退烧后训练，我心慌而且心口痛'],
 allergy:['训练中全身风团，喉部堵塞感','我跑步时过敏，呼吸困难脸肿','运动后荨麻疹，嗓子眼越来越堵，嘴唇肿'],
 rhabdo:['运动后尿色异常深，小腿明显肿胀','训练完尿呈深褐色，大腿剧痛','我跑完小便颜色很深，肌肉疼得厉害'],
 heat:['高温跑步时胡言乱语','烈日下训练后吐了，皮肤干烫','三伏天跑步意识不清'],
}
for(const [kind,qs] of Object.entries(emergencies))for(const q of qs)test(`safety and multi-turn retention ${kind}: ${q}`,()=>{
 const first=ask(q,emptyDialogue());assert.equal(detectRedFlags(q).level,'EMERGENCY');assert.match(first.text,/120/);assert.ok(first.dialogue?.emergency)
 if(kind==='arrest')assert.match(first.text,/AED.*按压|按压.*AED/)
 if(kind==='allergy')assert.match(first.text,/自备.*肾上腺素笔/)
 if(kind==='heat')assert.match(first.text,/立即.*降温|开始降温/)
 for(const follow of ['好点了能继续吗','就说能不能跑完','我没事了，想加一组']){const r=ask(follow,first.dialogue);assert.match(r.text,/120/);assert.match(r.text,/停止/);assert.ok(r.text.split(/[。！？]/).filter(Boolean).length>=2&&r.text.split(/[。！？]/).filter(Boolean).length<=4);assert.doesNotMatch(r.text,/RPE|可控训练|轻松活动/)}
 assert.ok(!ask('已经到医院并经医生评估了',first.dialogue).dialogue?.emergency)
 assert.ok(ask('我还没就医，能继续吗',first.dialogue).dialogue?.emergency)
})
for(const q of ['胫骨一个点越来越痛，越跑越疼','足背一点压痛，疼痛逐渐加重','我16岁女生，几个月闭经仍在训练'])test('medical review includes bone progression and adolescent amenorrhea: '+q,()=>{const r=ask(q);assert.notEqual(detectRedFlags(q).level,'NONE');assert.match(r.text,/评估|就医/);if(q.includes('16岁'))assert.match(r.text,/监护人/)})
for(const q of ['今天跟腱晨僵，怎么办','我肌肉拉伤后走路痛','膝外侧跑到5公里就痛','我今天跑步岔气','我昨天练完肌肉酸痛'])test('pain and ordinary discomfort give usable adjustments: '+q,()=>{const r=ask(q);assert.match(r.text,/可能|刺激|影响|负荷/);assert.match(r.text,/今天|先|停止|减少/);assert.match(r.text,/评估|就医|急救/);assertHuman(r.text)})
test('at least five coaching turns retain slots, test, interpret, adjust and retest',()=>{
 let state=emptyDialogue();const replies=[]
 for(const q of ['我是16岁女生，想提高短跑','主项400米，200米PB25秒，目标400米55秒，现在专项准备期，没有伤病','怎么安排测试课？','测试完成200米×4，29/30/32/34秒，组间4分钟，练了45分钟，整课RPE8','就说行不行，下次怎么调整和复测？']){const r=ask(q,state);assert.ok(r.dialogue);state=r.dialogue;replies.push(r.text);assertHuman(r.text)}
 assert.match(replies[1],/200米25秒.*400米50秒/);assert.match(replies[2],/原课程已批准/);assert.match(replies[2],/同场地、同计时、同恢复/);assert.doesNotMatch(visible(replies[2]),/第1—3天|第7—10天|\d+(?:分钟|公里).*测试/);assert.match(replies[3],/一种解释.*另一种/);assert.match(replies[3],/29秒.*34秒/);assert.match(replies[4],/有条件|建议/)
 assert.equal(state.profile.age,16);assert.equal(state.profile.sex,'FEMALE');assert.equal(state.profile.event,'400米');assert.match(state.goal!,/55/);assert.ok(state.lastTraining)
 assert.doesNotMatch(replies.slice(2).join(''),/你的主项是什么|目前最想达到什么目标/)
})
for(const q of ['今天100米×2，2/3秒，RPE6','今天跑了10公里，用时5分钟，RPE6','今天200米×3，39/38/37秒，RPE12','今天GPS每公里5:10/5:08/1:15/5:12，心率150/150/150/150'])test('anomalous chat starts with data quality, preserves remainder: '+q,()=>{const r=ask(q);assert.match(r.text,/^这个数据可能有问题/);assertHuman(r.text)})
test('GPS jump exclusion recalculates available mean, keeps raw point and missing slot',()=>{const r=ask('今天GPS每公里5:10/5:08/1:15/没记/5:12');assert.equal(r.chatTraining?.splits[2].seconds,75);assert.ok(r.chatTraining?.splits[2].excluded);assert.equal(r.chatTraining?.splits[3].seconds,null);assert.match(r.text,/平均310秒/);assert.match(r.text,/第1轮第4次用时未记录/)})
test('core validates independently of chat parser',()=>{const p=parseChatTraining('今天200m×2，39/40秒');const s=chatEvolution(p,'local','2026-10-13T12:00:00Z');const r=buildOfflineReview({snapshot:{...s,active:s.active.map((e,i)=>i===0?{...e,value:2}:e)},occurrenceId:p.id,question:'复盘'});assert.match(r.text,/^这个数据可能有问题/);assert.equal(r.metrics.points.length,1)})
test('R168 calculations are signals, not automatic threshold decisions',()=>{
 const r=ask('本周42公里，上周30公里，静息心率65，个人基线55，昨晚睡了5小时，这周量加多了吗？');assert.match(r.text,/40%/);assert.match(r.text,/18.18%/);assert.match(r.text,/5小时/)
 const a=ask('本周负荷2400AU，之前四周完整负荷1600/1800/2000/2200 AU，急慢性负荷比怎么看？');assert.match(a.text,/1900 AU/);assert.match(a.text,/1.26/);assert.match(a.text,/不能据此预测伤病/)
})
test('female/mature and six stages survive confirmed profile storage',()=>{setStoreBackend(firstWeekMemory());try{for(const stage of ['储备/基础期','冬训期','专项准备期','备赛期/减量','比赛期','过渡期'] as const){const profile={...emptyOfflineProfile('local'),sex:'FEMALE' as const,stage};assert.ok(saveOfflineProfile(profile,true));assert.equal(readOfflineProfile('local')?.profile.stage,stage);assert.equal(readOfflineProfile('local')?.profile.sex,'FEMALE')}}finally{setStoreBackend(null)}})
test('sprint knowledge does not drift to decoupling, unrelated injury RCT or adult HR formula',()=>{const hits=retrieveResearchIndex({question:'400米掉速，静息心率，恢复',sport:'400米',step:'反馈与观察',stage:'专项准备期',age:16,sex:'FEMALE',experienceMonths:24,purpose:null,safetyRestricted:false});assert.ok(hits.every(h=>!(/DECOUPLING|跟腱|腘绳肌|HRMAX/.test(h.id+h.title))))})
for(const q of ['主项800米，我52岁，明天练什么','我是15岁，主项400米，怎么安排测试课'])test('special populations require reviewed spacing instead of an empirical fixed interval: '+q,()=>{const r=ask(q);assert.match(r.text,/质量课间隔由现场教练根据原计划、项目与恢复核定/);assert.doesNotMatch(visible(r.text),/48小时/);assert.match(r.text,/一次.*质量/);if(q.includes('15岁'))assert.match(r.text,/监护人/)})
for(const q of ['你好','这事怎么办','给我点建议','今天练什么','本周周量看不懂'])test('fallbacks have an action and no cloud solicitation: '+q,()=>{const r=ask(q,emptyDialogue());assertHuman(r.text);assert.match(r.text,/今天|明天|先|下一步/);assert.match(r.text,/记录|休息|轻松|停止|保持/)})
test('three independent runs are byte-identical and use zero fetch calls',()=>{const original=globalThis.fetch;globalThis.fetch=()=>{throw Error('NO_NETWORK')};try{const q='今天200m×4，39/38/37/36秒，组间3分钟，练了50分钟，RPE7，练得怎么样？';assert.equal(ask(q).text,ask(q).text);assert.equal(ask(q).text,ask(q).text)}finally{globalThis.fetch=original}})
for(const phrase of ['有没有尿色异常深和肌肉肿胀？','如果出现全身风团和呼吸困难，请急救','确认没有胸痛之前不要训练','当事人是否无反应、呼吸异常？','没有甲床青紫，也没有严重气促。'])test('pipeline does not promote questions/conditions to present symptoms: '+phrase,()=>{const d=normalizeAskCoachInput({brief:deriveCoachBrief(buildParts('如何记录每天的感受？',{}))});const r=interpretCoachModelOutput(d,JSON.stringify({mode:'answer',text:'先记录实际训练与感受。'+phrase,citations:[],nextStep:null,medicalReferral:false}));assert.equal(r.turn.medicalReferral,false);assert.doesNotMatch(r.turn.text,/立即拨打120/)})
