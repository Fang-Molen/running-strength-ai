import {asksLoadSummary,loadQuestionAnalysis,loadSummaryRecord} from './online-load-context'
import {calendarDate,type LoadSummary} from '../health/load-evidence'
import { localAnalysisRecords, dialogueRecords, contextualQuestion, type OnlineConversationTurn } from './online-handoff';
/** Read-only, question-scoped self reports. This is selection, not provider verification. */
import { contextRecordQuote, type CoachContextRecord, type CoachRequestContext } from './online-contract';
import type { AnalysisFact, TrainingFact, CoachAnalysisPacket } from '../health/analysis-contract';
import type { CycleGoal } from './cycle/types';
import type { ScheduleEntry } from '../ui/day-schedule-rules';
import type { FoodEntry } from '../nutrition/log';
import type { EffectiveProfile } from './loop/effective-profile';
import { readAnalysis } from '../health/analysis-host';
import { stableJson, validAnalysisFact } from '../health/analysis-evidence';
import { sha256Hex } from '../core/sha256-sync';
import { currentAthleteId } from '../core/events';
import { currentStore } from '../core/storage';
import { ownedBy } from '../core/ownership';
import { readEffectiveProfile } from './loop/effective-host';
import { readEffectiveTrainingProfile } from './loop/effective-training';
import { readScheduleDocument } from '../ui/day-schedule';
import { loadEntries, nutrientOf } from '../nutrition/log';
import { readCycleGoal } from './cycle/host';
import { profileStorageKey } from '../strength/profile';
import { parseCoachUtterance } from './utterance-semantics';
import { boundedContextRecord } from './context-fields';
import { contextPeriod, requestsCalendarPeriod } from './context-period';

type Field = CoachContextRecord['fields'][number];
type TrainingProfile = ReturnType<typeof readEffectiveTrainingProfile>;
export type OnlineContextInput = {
  loadSummary?:LoadSummary; packet?:CoachAnalysisPacket; conversation?:readonly OnlineConversationTurn[];
  owner: string; question: string; day: string; asOf: string; facts: AnalysisFact[]; timeZone?:string;
  goal?: CycleGoal | null; schedule?: ScheduleEntry[]; foods?: FoodEntry[];
  profile?: EffectiveProfile; trainingProfile?: TrainingProfile;
  unknowns?: string[]; conflictCount?: number;
  /** Explicit UI selection, resolved only against this athlete's audited facts. */
  selectedTrainingIds?: readonly string[];
};
const clean = (value: string, max = 256) => value.normalize('NFKC').replace(/[\u0000-\u001f<>]/g, ' ').slice(0, max);
const digest = (value: unknown) => sha256Hex(stableJson(value));
const id = (value: unknown) => 'ctx:' + digest(value);
const dayMs = 86400000;
const date = (value: unknown): string | null => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const instant = (value: unknown): string | null => typeof value === 'string' && /T\d{2}:\d{2}/.test(value) ? date(value) : null;
const field = (name: string, value: Field['value'] | undefined, unit: string | null = null): Field => ({
  name, value: value == null || typeof value === 'number' && !Number.isFinite(value) ? null : typeof value === 'string' ? clean(value,Number.MAX_SAFE_INTEGER) : value, unit,
});

/** Reserve at least 3200 bytes of the complex route's 8000-byte conservative
 * input bound for system instructions, safety, provider options and framing.
 * The server still checks its exact configured framing; this is not permission
 * to spend money, nor an assertion of a provider's exact token count. */
export const ONLINE_QUOTED_CONTEXT_BYTES = 4800;
export function quotedOnlineContextBytes(question:string,context:CoachRequestContext):number {
  // Source IDs in the real aliased prompt are shorter than these full IDs.
  // Nested JSON escaping must be counted because the request embeds JSON text.
  const facts=context.records.map(r=>({id:r.recordId,kind:'FACT',detail:contextRecordQuote(r)}));
  return new TextEncoder().encode(JSON.stringify([{role:'user',content:JSON.stringify({question,facts,coverage:context.coverage})}])).length;
}

/** General explanations have no private-data dependency, including negated symptoms. */
export function onlineContextNeeds(question: string, selectedTrainingIds:readonly string[] = []) {
  const q = question.normalize('NFKC'), semantic = parseCoachUtterance(q);
  const selfText=q.replace(/(?:我(?:的)?|你(?:的)?)?(?:朋友|同学|同事|队友|家人)/g,'他人');
  const selfClaim=/我(?:自己|跑|练|吃|昨天|今天|明天|最近|的(?:训练|记录|课表|身体|目标|情况)|想(?:知道|了解)(?:我的)?训练能力)/.test(selfText);
  // Third-person examples do not authorize attaching this account's private records.
  const otherOnly = /朋友|同学|同事|队友|家人|别人|他(?:的|昨天|今天)|她(?:的|昨天|今天)/.test(q)
    && !selfClaim;
  const contextualReview=/(?:这次(?:训练)?|这节(?:训练)?|刚才那节|刚才那次).*(?:怎么样|如何|呢|复盘|分析)/.test(q);
  const implicitReport=/^(?:跑的|跑了|练的|练了|完成了).*(?:公里|长距离|均速|配速|心率|组|次)/.test(q);
  const capabilityReview=/我想(?:知道|了解)(?:我的)?训练能力/.test(q)&&!/定义|是什么|什么意思/.test(q);
  const generalExplanation=/(?:是什么|什么意思|定义|原理|科普|解释一下|解释什么|介绍一下)/.test(q)&&!selfClaim&&!/我的|根据.*记录/.test(q)&&!contextualReview&&!semantic.personalSymptoms.length;
  const personalMarker = /我的|我(?:昨天|今天|上周|上个月|最近|目前|这次|明天|吃|跑|练)|我[^，。?!！？]{0,12}(?:能跑|能练|适合|成绩)|帮我(?:看|分析|安排|复盘)|根据.*(?:记录|数据|资料|课表)|(?:复盘|查看|调整|安排).*(?:训练|记录|课表|计划|状态)|(?:今天|明天|昨日|昨天|近期|最近|上周|上个月).*(?:训练|跑|练|状态|恢复|吃|饮食|睡|安排|HRV|RHR|心率)|(?:训练|跑|练).*(?:最近|这次|昨天|今天|上周)/i.test(q);
  const personalAdvice=/[给为帮]我(?:安排|制定|设计|推荐|分析|比较|复盘)|我(?:想|要|准备).*(?:比赛|参赛|双阈值|训练计划)|(?:适合我|我能|我可以).*(?:训练|练|跑|计划)/.test(q);
  const personalState=/我(?:自己)?(?:现在|今年|去年|前年|感觉|没有[^，。]{0,12}但|的).*(?:恢复|累|疲劳|训练|状态|跑步|变化)/.test(selfText);
  const personal = !otherOnly && !generalExplanation && (asksLoadSummary(q)&&/(?:我(?:的|\d{4}|今年|去年|前年|最近)|根据.*记录)/.test(q) || selectedTrainingIds.length>0 || personalMarker || personalState || personalAdvice || contextualReview || implicitReport || capabilityReview || /(?:未来|本周|下周).*(?:计划|总结|复盘)/.test(q) || semantic.personalSymptoms.length > 0 || semantic.writeRequested);
  const nutrition = personal && /饮食|营养|热量|吃|餐|补给|碳水|蛋白|减脂|体重|控重/.test(q);
  const plan = personal && /计划|课表|安排|课程|调换|交换|改|明天|下周|周期/.test(q);
  const historical = (requestsCalendarPeriod(q) || /以前|历史|过去|上周/.test(q)) && !/今天|明天|现在|当前/.test(q);
  const training = personal && (!nutrition || /训练|跑|力量|运动|消耗/.test(q));
  const recovery = personal && (!historical && (training || /恢复|疲劳|睡眠|HRV|静息|心率|酸痛|疼痛|腿疼|状态/i.test(q)));
  const goal = personal && (plan || /目标|比赛|成绩|能力|PB|阈值|LT[12]|VDOT|CS|专项/i.test(q));
  return {personal, training, recovery, nutrition, plan, goal, profile:nutrition || goal || plan,
    restrictions:personal && (training || plan || semantic.personalSymptoms.length > 0), historical};
}

const categoryOf = (f: AnalysisFact): CoachContextRecord['category'] => f.kind === 'TRAINING'
  ? f.modality === 'STRENGTH' ? 'STRENGTH' : 'TRAINING'
  : f.kind === 'RESPONSE' ? /PAIN|FUNCTION/.test(f.measure) ? 'RESTRICTION' : 'RECOVERY'
  : /LT1|LT2|VDOT|^CS$|VO2|PB|THRESHOLD/.test(f.metric) ? 'CAPABILITY' : 'RECOVERY';

function factRecords(f: AnalysisFact): CoachContextRecord[] {
  const recordId = id([f.athleteId, f.provider, f.accountRef, f.deviceId, f.id]);
  const base = {recordId, revision:String(f.revision), occurredAt:date(f.occurredAt), knownAt:date(f.knownAt),
    category:categoryOf(f), state:'ACTUAL' as const, source:'USER_DECLARED:' + f.provider};
  // Many legacy protocol keys are device/account stream IDs. Keep those opaque;
  // transmit only short scientific protocol labels, never the stream identifier.
  const protocol=f.protocolKey&&/^(?:LT[12]|VT[12]?|VDOT|CS_TEST|CRITICAL_SPEED|D_MAX|LACTATE|TRACK_REPETITION|CR10|HRV_RMSSD|HRV_SDNN|RMSSD|SDNN)(?:[_. -][A-Z0-9]+)*$/.test(f.protocolKey)?f.protocolKey:null;
  const common = [field('quality', f.quality), field('evidenceVersion',digest([f.id,f.revision]).slice(0,16)), field('sourceGroup', digest([f.provider,f.accountRef,f.deviceId,f.protocolKey])),
    field('protocolGroup', f.protocolKey ? digest(f.protocolKey) : null), field('protocol',protocol),field('provenanceVerified',false)];
  if (f.kind === 'METRIC') return [{...base, fields:[...common,field('metric',f.metric),field('value',f.value,clean(f.unit,32)),field('statistic',f.statistic),field('temporalResolution',f.temporalResolution ?? 'UNKNOWN'),field('energyKind',f.energyKind)]}];
  if (f.kind === 'RESPONSE') return [{...base,fields:[...common,field('measure',f.measure),field('value',f.value,clean(f.scale,32)),field('region',f.region),field('side',f.side),field('elapsed',f.elapsedHours,'h'),field('functionTask',f.functionTaskId),field('observationProtocol',f.observationProtocol)]}];
  const result:CoachContextRecord[] = [{...base,fields:[...common,field('modality',f.modality),field('observedType',f.observedType),field('actualDuration',f.actualDurationSeconds,'s'),field('sessionRpe',f.sessionRpe,clean(f.sessionRpeScale ?? 'UNKNOWN',32)),field('segmentCount',f.runSegments.length),field('setCount',f.strengthSets.length),field('jumpContacts',f.jumpContacts)]}];
  for (const s of f.runSegments) result.push({...base,recordId:id([recordId,'segment',s.id]), fields:[field('parent',recordId),field('structure','RUN_SEGMENT'),field('block',id([recordId,s.blockId])),field('round',s.roundIndex),field('step',s.stepIndex),field('kind',s.kind ?? 'UNKNOWN'),field('distance',s.distanceM,'m'),field('duration',s.durationSeconds,'s'),field('restAfter',s.restAfterSeconds,'s'),field('restScope',s.restScope ?? 'UNSPECIFIED'),field('completion',s.completion),field('surface',s.surface),field('grade',s.gradePercent,'%'),field('heartRate',s.averageHeartRateBpm,'bpm'),field('heartRateMethod',s.heartRateMethod)]});
  for (const [index,s] of f.strengthSets.entries()) result.push({...base,category:'STRENGTH',recordId:id([recordId,'set',s.id]),fields:[field('parent',recordId),field('structure','STRENGTH_SET'),field('setIndex',index+1),field('exercise',s.catalogId),field('catalogueVersion',s.catalogVersion),field('side',s.side),field('load',s.loadKg,'kg'),field('loadBasis',s.loadBasis),field('reps',s.reps,'reps'),field('hold',s.holdSeconds,'s'),field('setRpe',s.setRpe,clean(s.effortScale ?? 'UNKNOWN',32)),field('rir',s.rir,'reps'),field('eccentric',s.eccentricSeconds,'s'),field('rangeProtocol',s.rangeProtocol),field('completion',s.completion)]});
  return result;
}

/** Pure selector. Inputs may be synthetic, but ownership and state checks are identical. */
export function selectOnlineContext(input: OnlineContextInput) {
  const selection=[...new Set(input.selectedTrainingIds??[])].slice(0,6);
  const question=contextualQuestion(input.question,input.conversation);
  const needs=onlineContextNeeds(question,selection), unknowns:string[]=[], candidates:CoachContextRecord[]=[], selectedFacts:AnalysisFact[]=[];
  const period=contextPeriod(question,calendarDate(input.asOf,input.timeZone??input.packet?.context.timeZone??Intl.DateTimeFormat().resolvedOptions().timeZone),input.timeZone??input.packet?.context.timeZone??Intl.DateTimeFormat().resolvedOptions().timeZone);
  const assessment=input.packet?.context.athleteId===input.owner?input.packet.assessment:undefined;
  const analysisRefs=new Set((assessment?[
    ...assessment.observations.flatMap(o=>o.evidenceRefs),
    ...assessment.hypotheses.flatMap(h=>[...h.supportingRefs,...h.weakeningRefs]),
  ]:[]).map(r=>`${r.id}@${r.revision}`));
  if(!input.owner || !date(input.asOf))throw Error('联网资料身份或读取时间无效');
  const now=Date.parse(input.asOf), anchor=Date.parse(input.day+'T12:00:00Z');
  const note=(text:string)=>{const value=clean(text,160);if(!unknowns.includes(value)&&unknowns.length<24)unknowns.push(value)};
  if(needs.personal){
    if(period.error)note(period.error);
    if(period.label&&!period.error)note(`按${period.label}的本地日期检索已有训练；未找到的日期不以近期训练替代，覆盖不代表完整历史。`);
    for(const text of input.unknowns ?? [])note(text);
    if(input.conflictCount)note('相关资料存在未解决的来源冲突，冲突值未作为可用事实发送。');
    const personalFacts=input.facts.filter(f=>f.athleteId===input.owner);
    const selectionIndex=(f:AnalysisFact)=>f.kind==='TRAINING'?selection.findIndex(key=>[f.id,f.occurrenceId,f.canonicalActivityId,f.sourceRecordId].includes(key)):-1;
    const relevant=(f:AnalysisFact)=>{
      if(f.kind==='TRAINING'){
        if(selection.length)return selectionIndex(f)>=0;
        if(period.label&&!period.matches(f.occurredAt))return false;
        const strength=/力量|深蹲|硬拉|卧推|负重|组次|增肌/.test(input.question),run=/跑|间歇|冲刺|\d+\s*米/.test(input.question);
        return needs.training && (strength===run || strength&&f.modality==='STRENGTH' || run&&f.modality==='RUN');
      }
      if(f.kind==='RESPONSE' && /PAIN|FUNCTION/.test(f.measure))return needs.restrictions;
      if(f.kind==='METRIC' && categoryOf(f)==='CAPABILITY')return needs.goal;
      return needs.recovery && (analysisRefs.has(`${f.id}@${f.revision}`)||Date.parse(f.occurredAt)>=anchor-7*dayMs && Date.parse(f.occurredAt)<anchor+dayMs);
    };
    const eligible=personalFacts.filter(f=>relevant(f)&&validAnalysisFact(f)&&f.status==='CONFIRMED'&&['AVAILABLE','PARTIAL'].includes(f.quality)&&Date.parse(f.knownAt)<=now&&Date.parse(f.receivedAt)<=now&&Date.parse(f.occurredAt)<=now);
    if(personalFacts.some(f=>relevant(f)&&!eligible.includes(f)))note('部分相关记录因时间、状态、冲突或字段不完整而未选入，不按零处理。');
    // Prefer an explicitly named day or event, then recency. Older relevant history is retained.
    const explicitDay=input.question.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    const distance=input.question.match(/(\d+)\s*米/)?.[1];
    const score=(f:AnalysisFact)=>(selectionIndex(f)>=0?1000-selectionIndex(f)*100:0)+(explicitDay&&f.occurredAt.startsWith(explicitDay)?100:0)+(distance&&f.kind==='TRAINING'&&f.runSegments.some(s=>s.distanceM===Number(distance))?20:0)+(needs.restrictions&&categoryOf(f)==='RESTRICTION'?10:0);
    eligible.sort((a,b)=>score(b)-score(a)||b.occurredAt.localeCompare(a.occurredAt)||a.id.localeCompare(b.id));
    // In comparisons reserve one representative for each requested calendar
    // group before filling with recency, so last year cannot be crowded out.
    const groups=new Map<string,AnalysisFact>();
    if(period.label&&!selection.length)for(const f of eligible)if(f.kind==='TRAINING'&&!groups.has(period.group(f.occurredAt)))groups.set(period.group(f.occurredAt),f);
    const representatives=[...groups.values()];
    if(representatives.length>1)eligible.sort((a,b)=>(representatives.includes(a)?0:1)-(representatives.includes(b)?0:1));
    if(selection.length){note('按用户选择的顺序读取实际训练；未选择的其他训练不代替所选记录。');if(selection.some((_,i)=>!eligible.some(f=>selectionIndex(f)===i)))note('部分所选训练无法在本人可核对的资料中找到；比较依据不完整，不借用其他训练补齐。')}
    if(input.loadSummary&&!selection.length&&!period.error)candidates.push(loadSummaryRecord(input.loadSummary,question,input.day));
    for(const f of eligible){candidates.push(...factRecords(f));selectedFacts.push(f)}
    candidates.push(...localAnalysisRecords(input.packet,input.owner,input.question,eligible));
    if(input.packet)note("本机计算与解释按问题筛选传递，属于客户端申报；未独立核验，候选未确认，不构成医疗许可。");
    if(needs.training&&!eligible.some(f=>f.kind==='TRAINING'))note('本次读取范围内没有可用的本人实际训练结构；不从计划推断完成量。');
    if(needs.recovery)note('恢复背景含近期记录及分析引用的较早对照；旧数据是比较依据，不代表当前疲劳。');
    if(needs.goal){
      const g=input.goal;
      if(g&&g.athleteId===input.owner&&date(g.savedAt)&&Date.parse(g.savedAt)<=now)candidates.unshift({recordId:id([input.owner,'goal']),revision:String(g.revision),occurredAt:g.raceDate?date(g.raceDate):null,knownAt:date(g.savedAt),category:'GOAL',state:'TARGET',source:'USER_DECLARED:CONFIRMED_GOAL',fields:[field('eventDistance',g.eventMeters,'m'),field('targetDuration',g.targetSeconds,'s'),field('raceDate',g.raceDate),field('experience',g.experience),field('runningExperience',g.runningExperience??null),field('strengthExperience',g.strengthExperience??null),field('priority',g.priority),field('horizon',g.horizonWeeks,'week'),field('measuredPerformance',false)]});
      else note('比赛目标或目标保存时间未知；目标不作为实测能力。');
    }
    if(needs.plan){
      const rows=(input.schedule??[]).filter(e=>ownedBy(e,input.owner)&&Math.abs(Date.parse(e.date+'T12:00:00Z')-anchor)<=14*dayMs).sort((a,b)=>Math.abs(Date.parse(a.date)-anchor)-Math.abs(Date.parse(b.date)-anchor)||a.id.localeCompare(b.id));
      const plans=rows.map((e):CoachContextRecord=>({recordId:id([input.owner,'schedule',e.id]),revision:digest(e),occurredAt:date(e.date),knownAt:null,category:'PLAN',state:'PLANNED',source:'USER_DECLARED:SCHEDULE',fields:[field('title',e.title),field('modality',e.modality),field('plannedMinutes',e.minutes,'min'),field('plannedDistance',e.km,'km'),field('intensity',e.intensity),field('executionState',e.actual?.executionState??e.status),field('actualOutcome',e.actual?.outcome),field('plannedIsActual',false),field('structureAvailable',!!e.exercises?.length||!!e.runComponents?.length)]}));
      candidates.unshift(...plans);note('日历为计划上下文；保存时刻未记录。已开始/已完成课程不能当作未开始课程修改。');
      if(!rows.length)note('本次日期附近没有可读取的本人课表；不代表历史课表为空。');
    }
    if(needs.profile&&input.profile){
      const p=input.profile;
      const fields=needs.nutrition?(['weightKg','heightCm','age','sex','goal'] as const):(['goal'] as const);
      for(const name of fields){const f=p[name];if(!f){note(`${name}未知，未用默认值补齐。`);continue}
        const at=instant(f.at);if(f.at&&Date.parse(f.at)>now)continue;
        candidates.unshift({recordId:id([input.owner,'profile',name]),revision:digest([f.value,f.source,f.at]),occurredAt:at,knownAt:at,category:name==='goal'?'GOAL':'CAPABILITY',state:name==='goal'?'TARGET':'ACTUAL',source:'USER_DECLARED:'+f.source,fields:[field(name,f.value,({weightKg:'kg',heightCm:'cm',age:'year'} as Record<string,string>)[name]??null),field('timeKnown',at!==null),field('sourceDate',f.at),field('measurementVerified',false)]});
      }
      for(const c of p.conflicts.filter(c=>fields.some(name=>name===c.field)))note(`${c.field}有来源冲突；当前值仍需核对，不自动作为处方依据。`);
    }
    if(input.trainingProfile){
      const p=input.trainingProfile;
      if(needs.restrictions)for(const [index,r] of p.restrictions.entries()){if(r.at&&Date.parse(r.at)>now){note('限制记录时间有误，需要核对；未据此解除限制。');continue}candidates.unshift({recordId:id([input.owner,'restriction',index]),revision:digest([r.value,r.source,r.at]),occurredAt:instant(r.at),knownAt:instant(r.at),category:'RESTRICTION',state:'UNKNOWN',source:'USER_DECLARED:'+r.source,fields:[field('restriction',r.value),field('sourceDate',r.at),field('requiresReview',true),field('medicalClearance',false)]})}
      if(needs.plan)for(const [name,f] of [['daysPerWeek',p.daysPerWeek],['minutes',p.minutes],['equipment',p.equipment]] as const){if(!f){note(`${name}未知。`);continue}if(f.at&&Date.parse(f.at)>now)continue;candidates.unshift({recordId:id([input.owner,'availability',name]),revision:digest([f.value,f.source,f.at]),occurredAt:instant(f.at),knownAt:instant(f.at),category:'PLAN',state:'PLANNED',source:'USER_DECLARED:'+f.source,fields:[field(name,f.value,name==='minutes'?'min':null),field('sourceDate',f.at)]})}
      if((needs.plan||needs.restrictions)&&p.conflicts.length)note('训练档案来源存在冲突，当前安排需要核对。');
    }
    if(needs.nutrition){
      const foods=(input.foods??[]).filter(f=>ownedBy(f,input.owner)&&f.date===input.day&&instant(f.recordedAt)&&Date.parse(f.recordedAt!)<=now&&(!f.eatenAt||instant(f.eatenAt)&&Date.parse(f.eatenAt)<=now)).sort((a,b)=>a.id.localeCompare(b.id));
      const records=foods.map((f):CoachContextRecord=>({recordId:id([input.owner,'food',f.id]),revision:digest([f.revisionId??null,f.name,f.grams,f.amount,f.unit,f.eatenAt,f.recordedAt,f.kcal,f.protein,f.carbs,f.carb,f.fat,f.fiber,f.label]),occurredAt:date(f.eatenAt),knownAt:date(f.recordedAt),category:'NUTRITION',state:'ACTUAL',source:'USER_DECLARED:FOOD_LOG',fields:[field('name',f.name),field('meal',f.meal),field('recordDay',f.date),field('portion',f.amount??f.grams,f.unit??(f.grams!=null?'g':null)),...(['kcal','protein','carb','fat','fiber'] as const).map(k=>field(k,nutrientOf(f,k),k==='kcal'?'kcal':'g')),field('wholeDayComplete',false)]}));
      candidates.unshift(...records);note('饮食仅为已记食物，全天完整度未知；未把未记录餐食算作零，也不计算虚构热量缺口。');
      if(foods.some(f=>!f.eatenAt))note('部分食物没有实际进食时刻；记录时刻不当作进食时刻。');
    }
  }
  if(needs.personal){
    candidates.push(...dialogueRecords(input.owner,input.question,input.conversation??[]));
    if(input.conversation?.length)note('近期对话仅用于理解指代，不是新的实测事实；只传递有限片段，未传部分不能视为不存在。');
  }
  for(let n=0;n<candidates.length;n++)candidates[n]=boundedContextRecord(candidates[n]);
  if(candidates.some(r=>r.fields.some(f=>f.name==='contentIncomplete')))note('长文本已分段；超出字段上限的中段未发送，记录保留首尾和完整内容摘要，不能据此解除限制。');
  const records:CoachContextRecord[]=[], unique=new Set<string>();
  // Reserve room for dependency hashes and coverage so the entire envelope stays below 48 KiB.
  let bytes=0;
  // Restrictions are retained ahead of optional context. Child structures only
  // enter when their workout header is present, so a clipped envelope is explicit.
  const primaryTraining=candidates.find(r=>['TRAINING','STRENGTH'].includes(r.category)&&!r.fields.some(f=>f.name==='parent'));
  const primarySegment=candidates.find(r=>r.fields.some(f=>f.name==='parent'&&f.value===primaryTraining?.recordId));
  const primaryCalculation=candidates.find(r=>r.category==='ANALYSIS'&&r.fields.some(f=>f.name==='kind'&&f.value==='COMPUTED'));
  const latestDialogue=candidates.filter(r=>r.category==='DIALOGUE'&&r.fields.some(f=>f.name==='speaker'&&f.value==='user')).at(-1);
  const comparisonRecords=selection.length>1?candidates.filter(r=>['TRAINING','STRENGTH'].includes(r.category)&&!r.fields.some(f=>f.name==='parent')).flatMap(header=>[header,...candidates.filter(r=>r.fields.some(f=>f.name==='parent'&&f.value===header.recordId)).slice(0,1)]):[];
  const historicalHeads=period.label?candidates.filter(r=>['TRAINING','STRENGTH'].includes(r.category)&&!r.fields.some(f=>f.name==='parent')).filter((r,i,all)=>all.findIndex(x=>period.group(x.occurredAt!)===period.group(r.occurredAt!))===i):[];
  const counterIds=new Set((assessment?.hypotheses.flatMap(h=>h.weakeningRefs)??[]).map(r=>digest([r.id,r.revision]).slice(0,16)));
  const priority=(r:CoachContextRecord)=>r.category==='RESTRICTION'?0:r.source==='USER_DECLARED:CANONICAL_LOAD_SUMMARY'?0.9:comparisonRecords.includes(r)?1+comparisonRecords.indexOf(r)/20:historicalHeads.includes(r)?1.1: r.fields.some(f=>f.name==='evidenceVersion'&&counterIds.has(String(f.value)))?1.2:r===primaryTraining?1:r.fields.some(f=>f.name==='kind'&&f.value==='HYPOTHESIS')?1.3:r===primarySegment?2:r===primaryCalculation?3:r===latestDialogue?4:r.category==='DIALOGUE'?6:r.category==='ANALYSIS'?7:r.fields.some(f=>f.name==='parent')?8:5;
  candidates.sort((a,b)=>priority(a)-priority(b));
  for(const r of candidates){if(unique.has(r.recordId))continue;unique.add(r.recordId);const size=new TextEncoder().encode(JSON.stringify(r)).length;const parent=r.fields.find(f=>f.name==='parent')?.value;if(records.length>=32||bytes+size>36*1024||parent&&!records.some(p=>p.recordId===parent))continue;records.push(r);bytes+=size}
  let omitted=unique.size-records.length;
  let omittedUnknowns=0,coverageOmittedSummary:string|undefined;
  const budgetNote=()=>{const text='上下文预算有限，部分历史或训练结构未发送；不能把已选分段/组次当作整课总量。';if(!unknowns.includes(text)){if(unknowns.length===24){unknowns.pop();omittedUnknowns++}unknowns.unshift(text)}};
  if(omitted)budgetNote();
  // Coverage itself goes into the provider prompt. Keep an explicit count when
  // detailed unknowns exceed the display budget, instead of dropping them as if
  // those sources had become complete. Safety records remain highest priority.
  const compactCoverage=()=>{
    if(coverageOmittedSummary){const index=unknowns.indexOf(coverageOmittedSummary);if(index>=0)unknowns.splice(index,1)}
    const summary=()=>`另有${omittedUnknowns}项缺失或冲突说明受预算限制未全部列出；不能据此视为资料完整。`;
    while(new TextEncoder().encode(JSON.stringify([...unknowns,...(omittedUnknowns?[summary()]:[])])).length>900&&unknowns.length>1){unknowns.pop();omittedUnknowns++}
    if(omittedUnknowns){coverageOmittedSummary=summary();unknowns.push(coverageOmittedSummary)}
  };
  compactCoverage();
  const makeContext=():CoachRequestContext=>{
    const dependencyVersions=records.map(r=>({key:'record:'+r.recordId,revision:digest(r)})).sort((a,b)=>a.key.localeCompare(b.key));
    // A query's selection is not a global fact version. Different questions may
    // legitimately select different subsets concurrently without invalidating them.
    if(needs.personal)dependencyVersions.push({key:'selection:'+digest([input.question.trim().normalize('NFKC'),selection]),revision:digest([records.map(r=>r.recordId),unknowns,omitted])});
    return {version:'coach-context-v2',dependencyVersions,records,coverage:{selected:records.length,omitted,unknowns}};
  };
  let context=makeContext();
  while((new TextEncoder().encode(JSON.stringify(context)).length>48*1024||quotedOnlineContextBytes(input.question,context)>ONLINE_QUOTED_CONTEXT_BYTES)&&records.length){records.pop();omitted++;budgetNote();compactCoverage();context=makeContext()}
  // A safety constraint omitted by the budget must not disappear as permission
  // to train. Send a small explicit unknown restriction, without inventing an
  // injury or claiming that the absent details have been medically reviewed.
  const restrictionSummaryId=id([input.owner,'omitted-restrictions']);
  const updateRestrictionSummary=()=>{
    const missing=candidates.filter(r=>r.category==='RESTRICTION'&&!records.some(s=>s.recordId===r.recordId));
    if(!missing.length)return;
    const summary:CoachContextRecord={recordId:restrictionSummaryId,revision:digest(missing),occurredAt:null,knownAt:null,category:'RESTRICTION',state:'UNKNOWN',source:'USER_DECLARED:CONTEXT_COVERAGE',fields:[field('restriction','安全限制资料受预算限制未完整发送；不能据此恢复受限训练，需要核对原记录。'),field('omittedRestrictionCount',missing.length),field('medicalClearance',false)]};
    const index=records.findIndex(r=>r.recordId===restrictionSummaryId);if(index>=0)records[index]=summary;else records.unshift(summary);
  };
  updateRestrictionSummary();context=makeContext();
  while((records.length>32||new TextEncoder().encode(JSON.stringify(context)).length>48*1024||quotedOnlineContextBytes(input.question,context)>ONLINE_QUOTED_CONTEXT_BYTES)&&records.length>1){records.pop();omitted++;budgetNote();compactCoverage();updateRestrictionSummary();context=makeContext()}
  // An interpretation cannot outlive the evidence supporting or weakening it
  // when the budget removes that evidence. Keep the gap, not an orphan claim.
  const transmittedEvidence=new Set(records.flatMap(r=>r.fields.filter(f=>f.name==='evidenceVersion').map(f=>String(f.value))));
  for(let index=records.length-1;index>=0;index--){
    const r=records[index];if(r.category!=='ANALYSIS')continue;
    const refs=r.fields.filter(f=>/^(?:evidenceVersions|support|counterevidence)(?:Part\d+)?$/.test(f.name)).flatMap(f=>String(f.value??'').match(/[a-f0-9]{16}/g)??[]);
    if(refs.some(ref=>!transmittedEvidence.has(ref))){records.splice(index,1);omitted++;budgetNote()}
  }
  compactCoverage();context=makeContext();
  const includedParents=new Set(records.map(r=>r.recordId));
  const transmittedFacts=selectedFacts.filter(f=>includedParents.has(id([f.athleteId,f.provider,f.accountRef,f.deviceId,f.id])));
  return {context,sourceVersion:digest(context),selectedFacts:transmittedFacts,owner:input.owner,personal:needs.personal,analysisPacket:input.packet};
}

/** Existing projections are reused; a read failure is disclosed, never treated as complete empty data. */
export function readOnlineContext(question:string,day:string,asOf:string,analysis?:ReturnType<typeof readAnalysis>,selectedTrainingIds:readonly string[]=[],conversation:readonly OnlineConversationTurn[]=[],options:{currentLoadCache?:boolean}={}){
  const owner=currentAthleteId(),needs=onlineContextNeeds(contextualQuestion(question,conversation),selectedTrainingIds),input:OnlineContextInput={owner,question,day,asOf,facts:[],unknowns:[],selectedTrainingIds,conversation};
  if(!needs.personal)return selectOnlineContext(input);
  const failed=(domain:string)=>input.unknowns!.push(`${domain}读取不可用，本次没有假定该类资料为空或为零。`);
  const period=contextPeriod(contextualQuestion(question,conversation),calendarDate(asOf,Intl.DateTimeFormat().resolvedOptions().timeZone),Intl.DateTimeFormat().resolvedOptions().timeZone);
  try{const load=!analysis&&!selectedTrainingIds.length&&!period.error&&asksLoadSummary(contextualQuestion(question,conversation))?loadQuestionAnalysis(contextualQuestion(question,conversation),day,asOf,options.currentLoadCache):null;
    if(load){input.loadSummary=load.summary;input.timeZone=load.summary.timeZone}
    const a=analysis??load??readAnalysis(day,asOf,question,{history:requestsCalendarPeriod(contextualQuestion(question,conversation))||needs.historical||needs.goal||selectedTrainingIds.length?'RETAINED':'RECENT',...(!selectedTrainingIds.length&&period.bounds?{trainingRange:period.bounds}:{})});if(a.snapshot.context.athleteId!==owner)throw Error('OWNER_CHANGED');input.facts=a.snapshot.facts;input.packet=a.packet;input.conflictCount=needs.recovery||load?a.snapshot.conflicts.length:0;
    if(needs.training||needs.recovery)for(const gap of a.snapshot.gaps)if(/缓存.*冲突|整课总量.*更正/.test(gap))input.unknowns!.push(gap);
    if(needs.recovery&&a.snapshot.gaps.some(g=>/恢复|疲劳|睡眠|HRV|RHR|心率|疼痛|时刻|协议/.test(g)))input.unknowns!.push('恢复来源含缺项或不确定状态；本次只发送可读取且明确归属的记录。');
    if(needs.training)input.unknowns!.push('训练历史来自当前分析投影的可读取范围，并非全量历史；日期较早的专项记录可入选。');
  }catch{failed('训练与健康来源')}
  if(needs.goal)try{input.goal=readCycleGoal()}catch{failed('比赛目标')}
  if(needs.plan)try{const result=readScheduleDocument();if(!result.ok)throw Error(result.reason);input.schedule=result.value.entries}catch{failed('日历')}
  if(needs.profile||needs.restrictions||needs.plan)try{
    const store=currentStore();if(!store)throw Error('STORAGE_UNAVAILABLE');const raw=store.getItem(profileStorageKey());if(raw!==null){const parsed=JSON.parse(raw);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('PROFILE_INVALID')}
    if(needs.profile)input.profile=readEffectiveProfile();if(needs.restrictions||needs.plan)input.trainingProfile=readEffectiveTrainingProfile();
  }catch{failed('身体与训练档案')}
  if(needs.nutrition)try{const store=currentStore();if(!store)throw Error('STORAGE_UNAVAILABLE');const raw=store.getItem('fr255-food-log-v1');if(raw!==null&&!Array.isArray(JSON.parse(raw)))throw Error('FOOD_INVALID');input.foods=loadEntries()}catch{failed('饮食')}
  if(currentAthleteId()!==owner)throw Error('运动员身份已变化，本轮资料未发送');
  return selectOnlineContext(input);
}
