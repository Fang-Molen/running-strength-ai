import {boundPlanReference} from './plan-reference';
/** Shared browser/server lexical assertion policy. This is format/risk screening,
 * not a diagnosis, scientific review, or independent verification of self reports. */
import { parseCoachUtterance, restrictionActionScope, type ScopedRestriction, type ActionScope } from './utterance-semantics';
export const COACH_ASSERTION_POLICY_VERSION='coach-assertions-v2' as const;
export type CoachAssertionKind='BOUND_FACT'|'GENERAL_EDUCATION'|'PERSONAL_QUANTITY'|'WRITE_OR_CLEARANCE'|'DIAGNOSIS'|'UNVERIFIED_RETRIEVAL'|'SOURCE_PROVENANCE'|'EXPLANATION';
export function affirmed(text:string,pattern:RegExp):boolean {
 return [...text.matchAll(new RegExp(pattern.source,'gi'))].some(match=>{
  const prefix=(text.slice(0,match.index).split(/[，,。；;！!？?\n]|但是|不过|然而|可是|但/).at(-1)??'').trim();
  const neg=/(?:不能|不可|不得|不应|不可以|不建议|不推荐|不要|尚未|没有|不代表|不意味着|无法|未|不)(?:直接|自动|擅自|据此|以此|再|就|已经|已|可以|允许|继续|照常|放心|说|认为|说明|表示|证明|确认|判断|是|你|您)*$/.exec(prefix);
  return !neg||/不|未|无|没|非/.test(prefix.slice(0,neg.index));
 });
}
export type CoachAssertionOptions={factQuotes:readonly string[];safetyRestricted:boolean;restrictions?:readonly ScopedRestriction[];question?:string;citedQuotes?:readonly string[]};
function educationalQuantity(clause:string):boolean {
 // Match whole teaching statements; an attached personal measurement cannot
 // borrow their exemption. Conversion arithmetic is checked deterministically.
 const conversion=/^\s*(\d+(?:\.\d+)?)\s*(公里|千米|米|小时|分钟|秒|公斤|千克|克)\s*(?:等于|=|即)\s*(\d+(?:\.\d+)?)\s*(公里|千米|米|小时|分钟|秒|公斤|千克|克)\s*$/.exec(clause);
 if(conversion){
  const units:Record<string,[string,number]>={公里:['length',1000],千米:['length',1000],米:['length',1],小时:['time',3600],分钟:['time',60],秒:['time',1],公斤:['mass',1000],千克:['mass',1000],克:['mass',1]};
  const a=units[conversion[2]],b=units[conversion[4]];
  return a[0]===b[0]&&Number(conversion[1])*a[1]===Number(conversion[3])*b[1];
 }
 return /^(?:一般情况下[，,]\s*)?(?:(?:你|您)可以(?:使用|用)\s*)?(?:(?:RPE|CR10)\s*(?:的)?\s*(?:取值)?范围(?:为|是)?\s*(?:0|1)\s*(?:到|至|[-–])\s*10|(?:0|1)\s*(?:到|至|[-–])\s*10\s*的\s*(?:RPE|CR10)量表描述用力程度)\s*$/i.test(clause);
}
function activityScope(text:string):ActionScope[]{
 const normalized=text.replace(/HAMSTRING|THIGH|CALF|QUAD|KNEE|ANKLE|FOOT|HIP|LOWER|腘绳肌|股四头肌|腓肠肌|跳跃/gi,'腿').replace(/SHOULDER|ARM|ELBOW|WRIST|UPPER/gi,'上肢');
 return restrictionActionScope(normalized);
}
/** Current question symptoms remain safety evidence even when the question asks
 * for general knowledge. They do not turn the knowledge itself into an action. */
function outputRestrictions(options:CoachAssertionOptions):ScopedRestriction[]{
 const active=(options.restrictions??[]).filter(r=>r.status==='ACTIVE'||r.status==='REVIEW_PENDING');
 if(!options.question)return [...active];
 const semantic=parseCoachUtterance(options.question);
 const current=[...semantic.personalSymptoms,...semantic.uncertainSymptoms].filter(m=>m.dimension!=='soreness');
 const evidence:ScopedRestriction[]=current.map((m,index)=>({id:`question-symptom:${index}`,version:'current-question',status:m.polarity==='UNCERTAIN'?'REVIEW_PENDING':'ACTIVE',scope:'CURRENT_PERSONAL_SYMPTOM',actions:activityScope(m.region??m.clause),sourceText:m.clause}));
 if(semantic.currentPersonalFlags.level!=='NONE'&&semantic.currentPersonalFlags.classes.some(c=>c!=='PAIN'&&c!=='OTHER'))evidence.push({id:'question-systemic',version:'current-question',status:'ACTIVE',scope:semantic.currentPersonalFlags.level,actions:['SYSTEMIC'],sourceText:options.question});
 return [...active,...evidence];
}
function releasesRestrictedActivity(text:string,evidence:readonly ScopedRestriction[],fallback:boolean):boolean{
 // Evaluate the action the ANSWER proposes. A safe upper-body clause followed
 // by a negated running clause must not be merged into one lower-body action.
 return text.split(/[，,。；;！!？?\n]|但是|不过|然而|可是|但/).filter(Boolean).some(clause=>{
  // A direct harm warning asserts risk, not clearance; explicit permission never borrows it.
  if(!/(?:可以|允许|获准|放心)/.test(clause)&&/(?:继续|带痛).{0,8}(?:冲刺|跑步|训练).{0,4}(?:可能|会|容易)(?:导致|引起)?(?:加重|损伤|恶化)/.test(clause))return false;
  // A general causal capability is not permission to perform the exercise now.
  if(/(?:训练|运动|锻炼|方法|原理).{0,8}可以(?:帮助|改善|提高|促进|增强|引起|导致|影响)/.test(clause)&&!/(?:你|您|本人|该运动员|现在|今天|明天)/.test(clause))return false;
  if(!affirmed(clause,/(?:可以|继续|照常|允许|放心|获准)[^，,]{0,18}(?:训练|跑步|跑跳|冲刺|跳跃|深蹲|硬拉|卧推|弯举|力量|练习|复训)|(?:训练|跑步|冲刺|力量|练习)(?:现在|今天|仍然|依然|也)?(?:可以|允许|获准)?(?:照常|继续|恢复|执行|开始)|(?:训练|跑步|力量)(?:已)?放行|(?:训练|跑步|冲刺).{0,6}(?:不必|不用|无需|无须)(?:停止|暂停)/))return false;
  if(!evidence.length)return fallback;
  const requested=activityScope(clause);
  return evidence.some(r=>{
   const scope=r.actions?.length?r.actions:activityScope(r.region??r.sourceText??'');
   return /EMERGENCY|URGENT/.test(r.scope)||scope.includes('SYSTEMIC')||scope.includes('UNKNOWN')||requested.includes('SYSTEMIC')||requested.includes('UNKNOWN')||scope.some(s=>requested.includes(s));
  });
 });
}
export type CoachAssertionResult={ok:boolean;errors:string[];policyVersion:typeof COACH_ASSERTION_POLICY_VERSION;professionalValidation:'NOT_PROVEN';assertions:{kind:CoachAssertionKind;text:string;valid:boolean}[]};
export function validateCoachAssertions(text:string,options:CoachAssertionOptions):CoachAssertionResult {
 const errors:string[]=[],assertions:{kind:CoachAssertionKind;text:string;valid:boolean}[]=[];
 const restrictions=outputRestrictions(options);
 // A quotation is evidence for numbers, never authority to write, diagnose or clear injury.
 if(options.factQuotes.length){const risk=validateCoachAssertions(text,{...options,factQuotes:[]});const blocked=risk.assertions.filter(a=>!a.valid&&a.kind!=='PERSONAL_QUANTITY');if(blocked.length)return {...risk,ok:false,errors:risk.errors.filter(e=>e!=='UNBOUND_PERSONAL_QUANTITY')}}
 let prose=text;
 for(const quote of [...options.factQuotes].sort((a,b)=>b.length-a.length)){if(quote&&prose.includes(quote)){assertions.push({kind:'BOUND_FACT',text:quote,valid:true});prose=prose.split(quote).join('')}}
 // Strip list numbering only, preserving every measurement, date and percentage.
 prose=prose.replace(/^\s*(?:[-*]\s*)?(?:\d+[.、)）]\s*|[（(]\d+[)）]\s*)/gm,'');
 for(const clause of prose.split(/[。；;！!？?\n]/).map(x=>x.trim()).filter(Boolean)){
  let kind:CoachAssertionKind='EXPLANATION',error:string|undefined;
  // “未改写已保存记录” refers to the state of an existing record. Keep any
  // separate affirmative write in the same clause subject to the normal check.
  const writeClause=clause.replace(/(?:未|没有|不会|不应)(?:改写|修改|覆盖)(?:已经|已)保存(?:的)?(?:记录|资料|计划|课表)/g,'保留原有记录');
  if(affirmed(writeClause,/(?:已|已经)(?:替你|为你)?(?:修改|保存|更新|执行|写入|调整|交换)(?:了)?(?:课表|计划|资料|记录|日历|训练)|解除(?:安全|疼痛|医疗|训练)?限制/)){kind='WRITE_OR_CLEARANCE';error='UNAUTHORIZED_WRITE_OR_CLEARANCE'}
  else if(affirmed(clause,/(?:确诊(?:为)?|诊断为).{0,12}(?:炎|撕裂|骨折|拉伤|病|综合征|损伤|障碍|贫血|抑郁|焦虑)|就是.{0,10}(?:炎|撕裂|骨折|拉伤)|(?:你|您的?).{0,8}(?:患有|得了).{0,12}(?:炎|撕裂|骨折|拉伤|病|综合征|损伤|障碍|贫血|抑郁|焦虑)/)){kind='DIAGNOSIS';error='DIAGNOSIS_CLAIM'}
  else if(releasesRestrictedActivity(clause,restrictions,options.safetyRestricted)){kind='WRITE_OR_CLEARANCE';error='ACTIVE_HOLD_RELEASE'}
  else if(affirmed(clause,/(?:设备|实验室|医疗|手表|Garmin|COROS).{0,8}(?:已核验|已验证|证实)|(?:已核验|已验证).{0,8}(?:设备|实验室|医疗|手表|Garmin|COROS)/)){kind='SOURCE_PROVENANCE';error='SOURCE_VERIFICATION_OVERCLAIM'}
  else if(/https?:\/\//i.test(clause)||affirmed(clause,/(?:我|已|刚刚|刚才)(?:已经|为你)?(?:查到|检索到|搜索到)|(?:据|根据)(?:最新|刚查到的)(?:网页|网站|搜索结果)/)){kind='UNVERIFIED_RETRIEVAL';error='UNVERIFIED_RETRIEVAL_CLAIM'}
  else if(/[0-9０-９]|[零〇一二两三四五六七八九十百千万]+\s*(?:组|次|秒|小时|分钟|公里|米|公斤|千克)/.test(clause)){
   const personal=/(?:你|您|本人|该运动员|你的|本次|昨天|明天|今日|今天|昨日|实际|记录显示|测试显示|测得|建议(?:跑|做|练)|安排|完成了)/.test(clause.replace(/(?:不代表|并非|不是|不能当作|不等于)(?:你|您)的(?:实际|个人)?(?:成绩|数据|表现)/g,''));
   const general=/(?:一般|科普|例如|举例|示例|例子|通常|常用|定义|量表|每公里|换算)/.test(clause);
   if(!options.safetyRestricted&&!restrictions.length&&boundPlanReference(clause,options.question,options.citedQuotes)){kind='BOUND_FACT'}else if(educationalQuantity(clause)||general&&!personal){kind='GENERAL_EDUCATION'}else{kind='PERSONAL_QUANTITY';error='UNBOUND_PERSONAL_QUANTITY'}
  }
  if(error)errors.push(error);
  assertions.push({kind,text:clause,valid:!error});
 }
 return {ok:errors.length===0,errors:[...new Set(errors)],policyVersion:COACH_ASSERTION_POLICY_VERSION,professionalValidation:'NOT_PROVEN' as const,assertions};
}

/** Keep verified quotes atomic when filtering sentences (including punctuation inside
 * a source), then validate restored sentences. Never salvage a numeric fragment. */
export function retainValidCoachSentences(text:string,options:CoachAssertionOptions):string {
 const quotes=[...new Set(options.factQuotes.filter(q=>q&&text.includes(q)))].sort((a,b)=>b.length-a.length);
 const markers: {marker:string;quote:string}[]=[];let masked=text;
 for(const [i,quote]of quotes.entries()){let marker=String.fromCharCode(0xe000+i);while(text.includes(marker))marker+='证';markers.push({marker,quote});masked=masked.split(quote).join(marker)}
 masked=masked.replace(/^\s*[一二三四五六七八九十]+[、．.][^\n]{0,50}$/gm,'').replace(/^\s*\d+[)）.、][^\n]*$/gm,'').replace(/^\s*[一二三四五六七八九十\d]+种假设[^\n]*$/gm,'');
 const restored=(masked.match(/[^。！？!?\n]+[。！？!?]?/g)??[]).map(s=>{for(const {marker,quote}of markers)s=s.split(marker).join(quote);return s.trim()});
 return restored.filter(s=>s&&validateCoachAssertions(s,options).ok&&!/^[）)\s；;。]+$/.test(s)).join('\n').trim();
}
