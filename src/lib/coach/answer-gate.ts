import {validateCoachAssertions,type CoachAssertionOptions} from './assertion-policy';
import {supportedEvidenceQuote} from './question-evidence';
import {computedCoachQuotes} from './context-comparison';
import {buildAnswerEvidenceState,type AnswerEvidenceState} from './answer-evidence';
import {boundExistingPlanAdvice} from './advice-grounding';
import {evaluateAnswerTask,buildAnswerTask} from './answer-task';
import type {CoachRequestContext} from './online-contract';
import type {ScopedRestriction} from './utterance-semantics';
import {sha256Hex} from '../core/sha256-sync';
export const ANSWER_GATE_VERSION='coach-answer-gate-v1';
export type AnswerDecision='VALIDATED'|'REPAIRED'|'PARTIAL'|'NEEDS_CLARIFICATION'|'SAFE_REFUSAL'|'FAILED_TECHNICAL';
export type AnswerBlockKind='OBSERVED_FACT'|'DERIVED_FACT'|'EXISTING_PLAN'|'CANDIDATE_ADVICE'|'GENERAL_KNOWLEDGE'|'UNCERTAINTY'|'ACTION_RESULT';
export type AnswerBlock={id:string;kind:AnswerBlockKind;text:string;evidenceRefs:{id:string;revision:string}[];dependsOn:string[];groupId:string};
export type AnswerSource={id:string;kind:string;detail:string;revision?:string};
export type AnswerCandidate={text:string;nextStep?:string|null;evidenceQuotes?:{sourceId:string;quote:string}[];blocks?:AnswerBlock[]};
export type AnswerToolState={retrieval:{state:'NOT_NEEDED'|'REQUESTED'|'SUCCEEDED'|'PARTIAL'|'FAILED'|'STALE_CACHE';enabled:boolean;sources:{id:string;url:string;quote:string;fetchedAt:string;expiresAt:string}[]};action?:{owner:string;currentOwner:string;authorized:boolean;status:'SUCCEEDED'|'UNKNOWN'|'FAILED';receiptId:string;idempotencyKey:string;claimText:string}};
export type AnswerGateInput={question:string;candidate:AnswerCandidate;sources:AnswerSource[];computedQuotes:string[];context?:CoachRequestContext;safetyRestricted:boolean;restrictions?:readonly ScopedRestriction[];evidenceState?:AnswerEvidenceState;tools?:AnswerToolState;now?:string;maxChars?:number};
export type AnswerGateResult={policyVersion:typeof ANSWER_GATE_VERSION;decision:AnswerDecision;text:string;blocks:AnswerBlock[];reasonCodes:string[];taskCoverage:ReturnType<typeof evaluateAnswerTask>;professionalReview:'PENDING'|'NOT_REQUIRED';finalHash:string;evidenceQuotes:string[];computedQuotes:string[];gates:{gate:string;status:'PASS'|'REPAIRED'|'PARTIAL';reasons:string[]}[]};
const stripNumbering=(s:string)=>s.replace(/^\s*(?:[-*]\s*)?(?:\d+[.、)）]\s*|[（(]\d+[)）]\s*)/gm,'').replace(/\*\*([^*]+)\*\*/g,'$1').trim();
const inferKind=(s:string):AnswerBlockKind=>/若|如果|是否|建议|可考虑|可以先|先考虑|安排|优先|保留/.test(s)?'CANDIDATE_ADVICE':/未知|未确认|未记录|不能|无法|缺少|请提供|补充|补记/.test(s)?'UNCERTAINTY':/[0-9]/.test(s)?'OBSERVED_FACT':'GENERAL_KNOWLEDGE';
function legacyBlocks(candidate:AnswerCandidate):AnswerBlock[]{
 const paragraphs=[candidate.text,candidate.nextStep??''].filter(Boolean).flatMap(t=>t.split(/\n+/));let i=0;
 return paragraphs.flatMap(p=>{
  // Legacy conditional paragraphs are atomic. Never detach the condition/stop rule.
  const parts=/若|如果|只有|停止条件|出现.*(?:停止|暂停)/.test(p)?[p]:p.match(/[^。！？!?]+[。！？!?]?/g)??[];
  return parts.map(s=>{const id='legacy:'+(i++);return {id,kind:inferKind(s),text:stripNumbering(s),evidenceRefs:[],dependsOn:[],groupId:id};});
 }).filter(b=>!!b.text);
}
function unknownClaim(text:string,state:AnswerEvidenceState){
 if(state.coverage==='UNKNOWN'&&/(?:记录|覆盖).{0,8}(?:并不完整|不完整|存在缺失|已经完整|已经齐全|全部齐全)/.test(text)&&!/(?:不能|无法|尚未|未能).{0,5}(?:确认|证明|判断)/.test(text))return true;
 if(state.clearance==='UNKNOWN'&&/(?:没有|未|尚未|没).{0,5}(?:得到|获得|取得|获).{0,4}(?:医疗|医生)?许可/.test(text)&&!/许可(?:资料|状态).{0,5}(?:未知|未记录|未确认)/.test(text))return true;
 if(!state.declaredRestrictions.length&&/(?:你|当前).{0,8}(?:已申报|存在|已有).{0,6}(?:医生|医疗|医嘱|训练限制|活动限制)|医生(?:已经|已)?禁止/.test(text))return true;
 return false;
}
/** No model calls, writes or unbounded repair. All host-appended text returns
 * through this same final gate; candidate kinds and task labels grant no trust. */
export function validateFinalAnswer(input:AnswerGateInput):AnswerGateResult{
 const reasons=new Set<string>();const state=input.evidenceState??buildAnswerEvidenceState(input.question,input.context);
 if(!input.candidate.text.trim()&&!input.candidate.blocks?.length)reasons.add('EMPTY_RESPONSE');
 const claims=input.candidate.evidenceQuotes??[],validClaims=claims.filter(c=>input.sources.some(s=>s.kind==='FACT'&&s.id===c.sourceId&&supportedEvidenceQuote(s.detail,c.quote)));
 if(validClaims.length!==claims.length)reasons.add('SOURCE_MISMATCH');
 const expectedComputed=computedCoachQuotes(input.question,input.context);
 const computed=input.computedQuotes.filter(q=>expectedComputed.includes(q));
 if(computed.length!==input.computedQuotes.length)reasons.add('DERIVATION_INVALID');
 const facts=[...validClaims.map(c=>c.quote),...computed];
 const options:CoachAssertionOptions={question:input.question,factQuotes:facts,citedQuotes:validClaims.map(c=>c.quote),restrictions:input.restrictions,safetyRestricted:input.safetyRestricted};
 const all=input.candidate.blocks?.length?input.candidate.blocks.map(b=>({...b,text:stripNumbering(b.text)})):legacyBlocks(input.candidate);
 const ids=new Set<string>();const bad=new Set<string>();
 const typed=!!input.candidate.blocks?.length;
 if(typed&&[input.candidate.text,input.candidate.nextStep??''].some(t=>t.trim()&&!all.map(b=>b.text).join('\n').includes(stripNumbering(t)))){reasons.add('SCHEMA_INVALID');for(const b of all)bad.add(b.id);}
 const allowedKinds=['OBSERVED_FACT','DERIVED_FACT','EXISTING_PLAN','CANDIDATE_ADVICE','GENERAL_KNOWLEDGE','UNCERTAINTY','ACTION_RESULT'];
 function checked(text:string,kind:AnswerBlockKind){
  if(unknownClaim(text,state)){reasons.add('UNKNOWN_AS_FACT');return false;}
  if(/(?:按照|执行|遵循).{0,10}(?:网页|备注|页面).{0,8}指令|读取(?:另|其他).{0,5}(?:账号|用户)/.test(text)){reasons.add('SOURCE_MISMATCH');return false;}
  let checkText=text;
  const action=input.tools?.action;
  if(kind==='ACTION_RESULT'&&action?.authorized&&action.owner===action.currentOwner&&action.status==='SUCCEEDED'&&action.receiptId&&action.idempotencyKey&&text===action.claimText)return true;
  if(kind==='ACTION_RESULT'){reasons.add('WRITE_UNCONFIRMED');return false;}
  if(/https?:\/\//.test(text)||/(?:刚刚|本次|刚才).{0,6}(?:查到|查证|检索到|搜索到)/.test(text)){
   const retrieval=input.tools?.retrieval,now=Date.parse(input.now??new Date().toISOString());
   const matching=retrieval?.sources.filter(s=>Date.parse(s.fetchedAt)<=now&&Date.parse(s.expiresAt)>=now&&text.includes(s.url)&&text.includes(s.quote));
   if(!retrieval||retrieval.state!=='SUCCEEDED'||!matching?.length){reasons.add('RETRIEVAL_UNPROVEN');return false;}
   for(const source of matching)checkText=checkText.replace(source.url,'').replace(source.quote,'');
   // Tool-backed exact quote supports that excerpt, never any individual diagnosis.
   checkText=checkText.replace(/(?:根据|依据)?本次(?:实际)?(?:查到|取得|检索到)的?(?:标签页|页面|资料)/g,'');
  }
  const bound=kind==='CANDIDATE_ADVICE'&&boundExistingPlanAdvice(checkText,input.question,validClaims.map(c=>c.quote));
  const result=validateCoachAssertions(checkText,bound?{...options,factQuotes:[...facts,checkText]}:options);
  if(!result.ok){for(const error of result.errors)reasons.add(error==='UNBOUND_PERSONAL_QUANTITY'?'UNSUPPORTED_DOSE':error==='ACTIVE_HOLD_RELEASE'?'RISK_SCOPE_CONFLICT':error==='UNAUTHORIZED_WRITE_OR_CLEARANCE'?'WRITE_UNCONFIRMED':error);return false;}
  if(kind==='GENERAL_KNOWLEDGE'&&/(?:你|本人).{0,8}(?:实际|已经完成|测得|已核验)/.test(text)&&!facts.some(f=>f.includes(text))){reasons.add('SOURCE_MISMATCH');return false;}
  return true;
 }
 for(const b of all){
  if(ids.has(b.id)||!b.id||!b.groupId||!allowedKinds.includes(b.kind)||b.text.length>4000){bad.add(b.id);reasons.add('SCHEMA_INVALID');}ids.add(b.id);
  if(b.evidenceRefs.some(ref=>!input.sources.some(s=>s.id===ref.id&&(s.revision??'snapshot')===String(ref.revision)))){bad.add(b.id);reasons.add('SOURCE_MISMATCH');}
  if(typed&&['OBSERVED_FACT','DERIVED_FACT','EXISTING_PLAN'].includes(b.kind)&&!b.evidenceRefs.some(ref=>input.sources.some(s=>s.id===ref.id&&(s.revision??'snapshot')===String(ref.revision)&&s.kind==='FACT'&&supportedEvidenceQuote(s.detail,b.text)))){bad.add(b.id);reasons.add('SOURCE_MISMATCH');}
  if(!checked(b.text,b.kind))bad.add(b.id);
 }
 // Detect cycles; an invalid member invalidates its entire group and dependants.
 const visiting=new Set<string>(),visited=new Set<string>();const byId=new Map(all.map(b=>[b.id,b]));
 const visit=(id:string):boolean=>{if(visiting.has(id))return false;if(visited.has(id))return !bad.has(id);visiting.add(id);const b=byId.get(id);const ok=!!b&&b.dependsOn.every(d=>byId.has(d)&&visit(d));visiting.delete(id);visited.add(id);if(!ok){bad.add(id);reasons.add('DEPENDENCY_BROKEN');}return ok;};
 all.forEach(b=>visit(b.id));let changed=true;while(changed){changed=false;const groups=new Set(all.filter(b=>bad.has(b.id)).map(b=>b.groupId));for(const b of all)if(!bad.has(b.id)&&(groups.has(b.groupId)||b.dependsOn.some(d=>bad.has(d)))){bad.add(b.id);reasons.add('DEPENDENCY_BROKEN');changed=true;}}
 const kept=all.filter(b=>!bad.has(b.id)&&b.text);
 const host=(text:string,kind:AnswerBlockKind,id:string)=>{if(checked(text,kind)&&!kept.some(b=>b.text===text||b.text.includes(text)))kept.push({id,kind,text,evidenceRefs:[],dependsOn:[],groupId:id});};
 computed.forEach((q,i)=>host(q,'DERIVED_FACT','host:calculation:'+i));
 // Exact accepted citations remain available when numeric paraphrases are removed.
 if(!kept.length||buildAnswerTask(input.question).some(t=>t.kind==='COMPARISON'||t.kind==='ANSWER'))for(const [i,c]of validClaims.entries())host(c.quote,'OBSERVED_FACT','host:quote:'+i);
 if(buildAnswerTask(input.question).some(r=>r.kind==='COVERAGE'))host(state.coverage==='UNKNOWN'?'记录覆盖尚未确认，不能由现有记录证明全年训练完整，也不能断言已经漏记。':state.coverage==='INCOMPLETE'?'按你明确提供的漏记说明，当前记录存在缺失；缺失部分的数量未知。':'记录完整性按明确确认的范围说明。','UNCERTAINTY','host:coverage');
 if(reasons.has('UNKNOWN_AS_FACT')&&!state.declaredRestrictions.length)host('症状是当前自述；没有可用的医嘱限制或医疗许可资料，许可状态未知。谨慎处理是系统建议。','UNCERTAINTY','host:authority');
 let coverage=evaluateAnswerTask(input.question,kept);
 if(coverage.some(t=>!t.satisfied))reasons.add('TASK_DROPPED');
 // Deterministic clarification only; no invented personal dose to fill a task.
 if(coverage.some(t=>!t.satisfied&&['ARRANGEMENT','MISSING_DATA'].includes(t.kind)))host('请补充专项与目标日期、原课表及近期训练、主观疲劳和不适情况，才能核对安排。当前仅能讨论框架，未修改计划。','UNCERTAINTY','host:clarification');
 if(!kept.length){reasons.add('TASK_DROPPED');host(input.safetyRestricted?'当前资料不足以支持训练放行。请先核对症状、限制范围与当前状态；本轮未执行修改。':'本轮回答未能完成可靠核验。请补充本题所需的记录或目标；未执行任何修改。','UNCERTAINTY','host:failure');}
 const max=input.maxChars??1000;
 // Remove whole groups only. Never truncate a condition or unit to fit a limit.
 while(kept.map(b=>b.text).join('\n').length>max&&kept.length>1){const removable=[...kept].reverse().find(b=>b.kind==='OBSERVED_FACT')??kept.at(-1)!;const removed=new Set(kept.filter(b=>b.groupId===removable.groupId).map(b=>b.id));let expand=true;while(expand){expand=false;for(const b of kept)if(!removed.has(b.id)&&b.dependsOn.some(d=>removed.has(d))){for(const member of kept.filter(m=>m.groupId===b.groupId))removed.add(member.id);expand=true;}}for(let i=kept.length-1;i>=0;i--)if(removed.has(kept[i].id))kept.splice(i,1);reasons.add('TASK_DROPPED');}
 let text=kept.map(b=>b.text).join('\n');
 if(!text||text.length>max||kept.some(b=>!checked(b.text,b.kind))){kept.splice(0,kept.length,{id:'host:technical',kind:'UNCERTAINTY',text:'本轮最终回答无法完整核验，已停止处理；请缩小问题范围，原记录和计划保留。',evidenceRefs:[],dependsOn:[],groupId:'host:technical'});text=kept[0].text;reasons.add('FINAL_VALIDATION_FAILED');}
 coverage=evaluateAnswerTask(input.question,kept);
 const complete=coverage.every(t=>t.satisfied)&&!reasons.has('TASK_DROPPED');
 const decision:AnswerDecision=reasons.has('FINAL_VALIDATION_FAILED')||reasons.has('EMPTY_RESPONSE')?'FAILED_TECHNICAL':complete?(reasons.size?'REPAIRED':'VALIDATED'):input.safetyRestricted&&reasons.has('RISK_SCOPE_CONFLICT')?'SAFE_REFUSAL':reasons.has('DEPENDENCY_BROKEN')?'PARTIAL':coverage.every(t=>!t.satisfied)||kept.every(b=>b.kind==='UNCERTAINTY')?'NEEDS_CLARIFICATION':'PARTIAL';
 const professionalReview=/疼|痛|伤|医|恢复|HRV/.test(input.question)||kept.some(b=>b.kind==='CANDIDATE_ADVICE')?'PENDING':'NOT_REQUIRED';
 const reasonCodes=[...reasons];
 const stageCodes=[['WRITE_UNCONFIRMED'],['SCHEMA_INVALID','EMPTY_RESPONSE'],['SOURCE_MISMATCH','UNKNOWN_AS_FACT'],['DERIVATION_INVALID'],['UNSUPPORTED_DOSE','RISK_SCOPE_CONFLICT','DIAGNOSIS_CLAIM'],['WRITE_UNCONFIRMED','RETRIEVAL_UNPROVEN'],['DEPENDENCY_BROKEN'],['TASK_DROPPED'],['FINAL_VALIDATION_FAILED']];
 return {policyVersion:ANSWER_GATE_VERSION,decision,text,blocks:kept,reasonCodes,taskCoverage:coverage,professionalReview,finalHash:sha256Hex(text),evidenceQuotes:validClaims.filter(c=>text.includes(c.quote)).map(c=>c.quote),computedQuotes:computed.filter(q=>text.includes(q)),gates:stageCodes.map((codes,i)=>{const errors=reasonCodes.filter(c=>codes.includes(c));return {gate:'G'+i,status:errors.length?(i===7&&!complete?'PARTIAL':'REPAIRED'):'PASS',reasons:errors};})};
}
