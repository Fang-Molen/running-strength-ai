import {analysisDay} from '../../health/coach-data'
import {isR4CourseCandidate} from './courses'
import {currentAthleteId} from '../../core/events'
import {currentStore} from '../../core/storage'
import {createPersonalStore} from '../personal/store'
import {readAnalysis} from '../../health/analysis-host'
import {deriveAnalysisFacts} from '../../health/analysis-derived'
import {analysisDigest,refOf} from '../../health/analysis-evidence'
import {localDay} from '../../health/observation'
import {loadSchedule,readScheduleDocument} from '../../ui/day-schedule'
import {buildR4Review,suggestR4Tasks} from './assessment'
import {retrieveR4,scaleR4Reference} from './reference'
import {resolveR4Conditions} from './conditions'
import {loadEntries,nutrientOf} from '../../nutrition/log'
import {detectRedFlags} from '../../core/coach-red-flags'
import {readEffectiveProfile} from '../loop/effective-host'
import {withEffectivePersonal} from '../loop/effective-profile'

/** Union of requested modalities; neither service masks the other. */
export function selectR4CourseTasks(tasks:readonly string[],modality:string):boolean {
 if(tasks.includes('planning')||tasks.includes('warmup'))return true
 return tasks.includes('strength')&&modality==='strength'||tasks.includes('running')&&modality==='run'
}
const goals={HYPERTROPHY:'增肌',FAT_LOSS:'减脂',WEIGHT_MAINTENANCE:'维持体重',RUN_PERFORMANCE:'跑步表现'}
const labels:Record<string,string>={event:'专项',start:'起跑方式',timing:'计时方式',surface:'场地',restSeconds:'组间休息',purpose:'训练目的',approvedSession:'可信审批的课程',mainSession:'所选主课',trainingPhase:'训练阶段',trainingDuration:'实际训练时长',trainingIntensity:'训练强度口径',weightKg:'当前体重',symptoms:'当前症状',weeklySchedule:'本周完整安排',missedSessions:'实际漏练的课',trainingHistory:'训练历史',goal:'目标',experience:'训练经验',equipment:'器材',foodEntries:'饮食记录',technique:'动作质量',effort:'用力程度',completedSets:'实际完成组数',restrictions:'身体限制',targetPattern:'原动作目的'}
/** Only host-read facts/profile reach applicability. Question text cannot approve anything. */
export function readR4CoachAnswer(question:string,asOf=new Date().toISOString(),day=analysisDay(question,null,localDay(new Date(asOf)))){
 if(!/饮食|营养|蛋白|碳水|热量|力量|增肌|跑步|配速|分段|疲劳|恢复|基线|HRV|RMSSD|静息心率|热身|漏练|课表|安排|更正|能力|对调|调换|换课|改期/i.test(question)||detectRedFlags(question).level!=='NONE'||/朋友|队友|他人|假设|举例|案例/.test(question))return null
 // Use the explicit analysis date, not the wall clock, when reproducing a saved answer.
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(asOf)))throw Error('R4_INVALID_DATE')
 const owner=currentAthleteId(),store=currentStore();if(!store)throw Error('R4_STORAGE_UNAVAILABLE')
 const stored=createPersonalStore(store,currentAthleteId).read()
 // Same current weight/age/sex/height as the diet and health pages.
 const effective=readEffectiveProfile()
 const personal={...stored,profile:stored.profile?withEffectivePersonal(stored.profile,effective):null}
 const conditions=resolveR4Conditions({athleteId:owner,asOf,...personal})
 const tasks=suggestR4Tasks(question),foodOnly=tasks.every(t=>t==='nutrition')
 const a=readAnalysis(day,asOf,question),facts=a.snapshot.facts,training=facts.filter(f=>f.kind==='TRAINING'),responses=facts.filter(f=>f.kind==='RESPONSE')
 const foods=loadEntries().filter(f=>(f.athleteId??'local')===owner&&f.date===day&&!!f.recordedAt&&Date.parse(f.recordedAt)<=Date.parse(asOf))
 const nutrients=foods.map(f=>({kcal:nutrientOf(f,'kcal'),protein:nutrientOf(f,'protein'),carb:nutrientOf(f,'carb'),fat:nutrientOf(f,'fat'),fiber:nutrientOf(f,'fiber')}))
 const review=buildR4Review(a.snapshot,question,{tasks,population:conditions.population,foods:nutrients})
 const p=conditions.profile,fields:Record<string,unknown>={athleteId:owner,recordRevision:p?.revision??0,dependencies:facts.map(refOf)}
 if(p){fields.goal=goals[p.goal];fields.experience=p.experience;fields.equipment=p.equipment==='NONE'?[]:['哑铃'];fields.availableMinutes=p.minutes;if(p.weightKg!==null)fields.weightKg=p.weightKg;if(p.goal==='HYPERTROPHY')fields.trainingContext='muscle building/recovery'}
 if(training.length){fields.trainingHistory=training.map(f=>({ref:refOf(f),at:f.startedAt}));fields.recentTraining=fields.trainingHistory}
 if(responses.length)fields.symptoms=responses.map(f=>({measure:f.measure,value:f.value,ref:refOf(f)}))
 if(foods.length)fields.foodEntries=nutrients
 if(facts.length||foods.length)fields.verifiedFacts=[...facts.map(refOf),...foods.map(f=>({id:f.id,revision:f.revisionId??f.recordedAt}))]
 const baseline=review.baselines.find(b=>b.device&&b.protocol&&b.sampleDays>0)
 if(baseline){fields.metric=baseline.metric;fields.device=baseline.device;fields.measurementProtocol=baseline.protocol}
 const calendar=readScheduleDocument(),entries=calendar.ok?loadSchedule().entries.filter(e=>(e.athleteId??'local')===owner):[]
 // Saved course candidates carry user ownership, not a fabricated knowledge approval.
 const courses=entries.filter(e=>isR4CourseCandidate(e)&&e.date>=day).filter(e=>selectR4CourseTasks(tasks,e.modality)||e.trainingType==='mixed'&&tasks.some(t=>t==='strength'||t==='running')).map(e=>({id:e.id,title:e.title,date:e.date,minutes:e.minutes,components:e.runComponents??[],version:analysisDigest(e),authority:'USER_SAVED_COURSE' as const}))
 if(calendar.ok&&p){fields.priority=goals[p.goal];if(entries.length)fields.weeklySchedule=entries.map(e=>({id:e.id,date:e.date,status:e.status}));const missed=entries.filter(e=>e.actual?.outcome==='missed');if(missed.length)fields.missedSessions=missed.map(e=>({id:e.id,date:e.date}))}
 const selection=retrieveR4({question,tasks,population:conditions.population,fields,limit:4})
 const knowledge=selection.cards.filter(c=>{
  if(!p||conditions.population!=='healthy_adult'||['HOLD_ACTIVE','ESCALATION_REQUIRED'].includes(a.assessment.safetyState))return false
  // Presence alone is insufficient: check meaning, freshness and the requested service.
  switch(c.id){
   case 'K02':return training.some(f=>f.startedAt&&Date.parse(asOf)-Date.parse(f.startedAt)<=28*86400000)
   case 'K03':return !!baseline&&baseline.conflictingDays===0
   case 'K04':return training.length>0&&responses.some(f=>Date.parse(asOf)-Date.parse(f.occurredAt)<=7*86400000)
   case 'K11':return false // This profile records strength experience, not running experience.
   case 'K12':return p.services.includes('STRENGTH')
   case 'K14':return entries.some(e=>e.modality==='run')&&entries.some(e=>e.modality==='strength')
   case 'K17':return entries.some(e=>e.actual?.outcome==='missed')
   case 'K19':return foods.length>0
   case 'K22':return p.goal==='HYPERTROPHY'&&p.weightKg!==null&&p.weightKg>0
   case 'K24':return responses.some(f=>Date.parse(asOf)-Date.parse(f.occurredAt)<=7*86400000)
   case 'K25':case 'K26':return facts.length>0||foods.length>0
   default:return false // Unimplemented protocol/approval requirements remain unestablished.
  }
 }).map(c=>({...c,applicability:'EDUCATIONAL_APPLICABLE' as const,conditions:[`个人条件版本 ${p?.revision}，由用户保存`,`仅解释本机已保存证据与目标；未核对外部课表或课程审批`]}))
 const lines:string[]=[],calculations=deriveAnalysisFacts({...a.snapshot,facts:facts.filter(f=>f.kind!=='TRAINING'||localDay(new Date(f.startedAt))===day)})
 if(conditions.population!=='healthy_adult')lines.push(conditions.population==='special'?'当前条件不适用通用健康成人方案。保留记录说明，训练或饮食处方需按实际限制另行评估。':conditions.reasons.join('；')+'。在“私人教练”核对并保存条件后，再匹配个人参考。')
 if(foodOnly||tasks.includes('nutrition')){
  const n=review.nutrition
  lines.push(foods.length?`${day} 已记录 ${foods.length} 条食物：能量已知合计 ${n.kcal.missing===foods.length?'未知':n.kcal.knownSum??'未知'} kcal，缺 ${n.kcal.missing} 项；蛋白已知合计 ${n.protein.missing===foods.length?'未知':n.protein.knownSum??'未知'} g，缺 ${n.protein.missing} 项。`:`${day} 还没有可核对的饮食记录；先确认食物和份量，营养缺项保持未知。`)
  lines.push('这只覆盖已记录的食物，不能用目标减去已知小计推断全天热量缺口。')
  if(knowledge.some(c=>c.id==='K22')&&p?.goal==='HYPERTROPHY'&&p.weightKg!==null&&/蛋白|增肌/.test(question)){
   const ref=scaleR4Reference({referenceId:'N-PROTEIN-USADA',contextIndex:0,weightKg:p.weightKg,population:'healthy_adult'})
   lines.push(`按已保存的增肌目标与 ${p.weightKg} kg 体重，USADA 增肌/恢复情境的蛋白教育参考为 ${ref.range[0]}–${ref.range[1]} g/天（${p.weightKg} × 1.6–1.8；S09）。不默认取上限，也没有改写饮食目标。`)
  }
 }
 if(!foodOnly){
  const relevant=calculations.filter(c=>tasks.includes('strength')&&c.metric.startsWith('STRENGTH_')||tasks.includes('running')&&['RUN_DISTANCE_M','RUN_WORK_SECONDS','RUN_TIME_CHANGE_SECONDS'].includes(c.metric)).slice(-5)
  lines.push(...relevant.map(c=>`${day} 训练记录：${c.text.slice(c.text.indexOf('：')+1).replace(' sets','组').replace(' reps','次')}`))
  if(tasks.includes('strength'))for(const t of training.filter(f=>f.modality==='STRENGTH'&&localDay(new Date(f.startedAt))===day)){
   const completed=t.strengthSets.filter(s=>s.completion==='COMPLETED')
   if(completed.length)lines.push(`${localDay(new Date(t.startedAt))} 已记录的完成组：`+completed.map((s,i)=>`第${i+1}组 ${s.reps??'次数未知'}${s.reps===null?'':'次'}，已记负重 ${s.loadKg??'未知'} kg${s.loadBasis==='UNKNOWN'?'（负重口径未知，不据此计算总负重次数积）':s.loadBasis==='PER_HAND'?'（每手）':s.loadBasis==='TOTAL_EXTERNAL'?'（外部总负重）':''}`).join('；')+'。')
  }
  if(tasks.includes('baseline')||tasks.includes('fatigue'))lines.push(...review.baselines.slice(0,3).map(b=>`${b.metric}：${b.provider}/${b.device??'设备未知'}/${b.protocol??'协议未知'}，${b.sampleDays} 个独立日，均值 ${b.mean??'未知'} ${b.unit}；缺 ${b.missingDays} 日、冲突 ${b.conflictingDays} 日。这是暂定参照，不是疲劳诊断。`))
  if(['HOLD_ACTIVE','ESCALATION_REQUIRED'].includes(a.assessment.safetyState))lines.push('当前疼痛或安全限制优先，不能用准备度、HRV或知识参考解除。暂停诱发症状的内容，先核对实际限制。')
  if(courses.length)lines.push('可核对的已保存课程：'+courses.slice(0,3).map(c=>`${c.date} ${c.title}（${c.minutes}分钟）`).join('；')+'。保留原课程参数；选择后先预览日历变更，再由你确认。')
  else if(tasks.some(t=>['strength','running','warmup','planning'].includes(t)))lines.push('尚无匹配且未开始的结构化已保存课程。先选择或导入课程，不从知识参考生成已批准剂量。')
 }
 for(const c of knowledge)lines.push(`${c.title}：${c.text}\n依据：${c.sourceIds.length?c.sourceIds.map(id=>{const source=selection.sources.find(s=>s.id===id);return source?`${source.title}（${id}）`:id}).join('；'):'产品操作规则（不是科学结论）'}。`)
 if(conditions.population==='healthy_adult'&&!knowledge.length){const gap=selection.needsInput[0];if(gap)lines.push('下一步请核对：'+gap.missing.slice(0,2).map(k=>labels[k]??k).join('、')+'。这些条件会改变知识或课程的选择。')}
 if(currentAthleteId()!==owner)throw Error('R4_SUBJECT_CHANGED')
 const basisVersion=analysisDigest([owner,day,conditions.version,a.revision,foods,entries,question,selection.version,knowledge.map(c=>c.id)])
 return {question,day,athleteId:owner,text:lines.join('\n'),basisVersion,conditions,knowledge,courses,review,calculations,safety:a.assessment.safetyState,modelCalled:false as const,planWritten:false as const}
}
