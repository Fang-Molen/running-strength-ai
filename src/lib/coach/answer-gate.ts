import {contextModelQuote} from './online-contract';
import {actionReceiptMatches,checkedRetrievalProse,type ActionBinding} from './answer-tools';
import {affirmed,validateCoachAssertions,type CoachAssertionOptions} from './assertion-policy';
import {supportedEvidenceQuote} from './question-evidence';
import {computedCoachQuotes} from './context-comparison';
import {buildAnswerEvidenceState,type AnswerEvidenceState} from './answer-evidence';
import {boundExistingPlanAdvice,plannedAdviceActionIsSafe} from './advice-grounding';
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
export type AnswerToolState={retrieval:{state:'NOT_NEEDED'|'REQUESTED'|'SUCCEEDED'|'PARTIAL'|'FAILED'|'STALE_CACHE';enabled:boolean;sources:{id:string;url:string;quote:string;fetchedAt:string;expiresAt:string}[]};action?:{intent:ActionBinding;receipt:ActionBinding&{status:string};currentOwner:string;authorized:boolean;claimText:string}};
export type AnswerGateInput={question:string;candidate:AnswerCandidate;sources:AnswerSource[];computedQuotes:string[];context?:CoachRequestContext;safetyRestricted:boolean;restrictions?:readonly ScopedRestriction[];evidenceState?:AnswerEvidenceState;tools?:AnswerToolState;now?:string;maxChars?:number};
export type AnswerGateResult={policyVersion:typeof ANSWER_GATE_VERSION;decision:AnswerDecision;text:string;blocks:AnswerBlock[];reasonCodes:string[];taskCoverage:ReturnType<typeof evaluateAnswerTask>;professionalReview:'PENDING'|'NOT_REQUIRED';finalHash:string;evidenceQuotes:string[];computedQuotes:string[];gates:{gate:string;status:'PASS'|'REPAIRED'|'PARTIAL';reasons:string[]}[]};
const stripNumbering=(s:string)=>s.replace(/^\s*(?:[-*]\s*)?(?:\d+[.、)）]\s*|[（(]\d+[)）]\s*)/gm,'').replace(/\*\*([^*]+)\*\*/g,'$1').trim();
const inferKind=(s:string):AnswerBlockKind=>/^(?:请确认|请补充|请提供|需要你确认)/.test(s)?'UNCERTAINTY':/^(?:已|已经)(?:为你|替你|成功)?(?:登记|录入|写入|保存|更新|修改|重排)/.test(s)?'ACTION_RESULT':/若|如果|是否|建议|可考虑|可以先|先考虑|安排|优先|保留/.test(s)?'CANDIDATE_ADVICE':/未知|未确认|未记录|不能|无法|缺少|请提供|补充|补记/.test(s)?'UNCERTAINTY':/[0-9]/.test(s)?'OBSERVED_FACT':'GENERAL_KNOWLEDGE';
export function unsupportedSemanticFact(text:string,facts:readonly string[],computed:readonly string[]):boolean{
 const completed=/(?:你|本人|本次|今天).{0,8}(?:已经|已)(?:完成|跑完|做完|执行)|你(?:完成了|训练过)/.test(text);
 const comparison=/(?:配速|两次|两课|今天|昨天).{0,5}(?:相同|更快|更慢)/.test(text);
 return (completed||comparison)&&!facts.some(f=>supportedEvidenceQuote(f,text))&&!(comparison&&computed.some(q=>/相同|并列/.test(q)&&/相同|并列/.test(text)));
}
function legacyBlocks(candidate:AnswerCandidate):AnswerBlock[]{
 const paragraphs=[candidate.text,candidate.nextStep??''].filter(Boolean).flatMap(t=>t.split(/\n+/));let i=0;
 return paragraphs.flatMap(p=>{
  // Legacy conditional paragraphs are atomic. Never detach the condition/stop rule.
  const parts=/若|如果|只有|停止条件|出现.*(?:停止|暂停)|https?:\/\//.test(p)?[p]:p.match(/[^。！？!?]+[。！？!?]?/g)??[];
  return parts.map(s=>{const id='legacy:'+(i++);return {id,kind:inferKind(s),text:stripNumbering(s),evidenceRefs:[],dependsOn:[],groupId:id};});
 }).filter(b=>!!b.text);
}
export function unsupportedEvidenceStateClaim(text:string,state:AnswerEvidenceState){
 if(state.coverage==='UNKNOWN'&&affirmed(text,/(?:记录|覆盖)[^\n，,。；;：:]{0,8}(?:并不完整|不完整|存在缺失|已经完整|已经齐全|全部齐全)/))return true;
 if(state.clearance==='UNKNOWN'&&/(?:没有|未|尚未|没).{0,5}(?:得到|获得|取得|获).{0,4}(?:医疗|医生)?许可/.test(text)&&!/许可(?:资料|状态).{0,5}(?:未知|未记录|未确认)/.test(text))return true;
 if(!state.declaredRestrictions.some(r=>/医生|医嘱|医疗/.test(r.text))&&affirmed(text,/(?:医生|医嘱).{0,8}(?:禁止|限制)/))return true;
 if(!state.declaredRestrictions.length&&/(?:你|当前).{0,8}(?:已申报|存在|已有).{0,6}(?:医生|医疗|医嘱|训练限制|活动限制)|医生(?:已经|已)?禁止/.test(text))return true;
 if(!state.declaredRestrictions.length&&/(?:安全状态|状态显示).{0,8}(?:训练受限|活动限制)/.test(text))return true;
 return false;
}
/** No model calls, writes or unbounded repair. All host-appended text returns
 * through this same final gate; candidate kinds and task labels grant no trust. */
export function validateFinalAnswer(input:AnswerGateInput):AnswerGateResult{
 const reasons=new Set<string>();const state=input.evidenceState??buildAnswerEvidenceState(input.question,input.context);
 if(!input.candidate.text.trim()&&!input.candidate.blocks?.length)reasons.add('EMPTY_RESPONSE');
 const claims=input.candidate.evidenceQuotes??[],validClaims=claims.filter(c=>input.sources.some(s=>s.kind==='FACT'&&s.id===c.sourceId&&supportedEvidenceQuote(s.detail,c.quote)));
 if(new Set(validClaims.map(c=>c.sourceId+'\0'+c.quote)).size<validClaims.length)reasons.add('EVIDENCE_DEDUPLICATED');
 if(validClaims.length!==claims.length)reasons.add('SOURCE_MISMATCH');
 const expectedComputed=computedCoachQuotes(input.question,input.context);
 const computed=input.computedQuotes.filter(q=>expectedComputed.includes(q));
 if(computed.length!==input.computedQuotes.length)reasons.add('DERIVATION_INVALID');
 const hostContext=(input.context?.records??[]).filter(r=>r.category!=='DIALOGUE').map(contextModelQuote);
 const plans=(input.context?.records??[]).filter(r=>r.category==='PLAN'&&r.state==='PLANNED').map(contextModelQuote);
 const facts=[...validClaims.filter(c=>!c.sourceId.startsWith('retrieved:')).map(c=>c.quote),...computed,...hostContext];
 const options:CoachAssertionOptions={question:input.question,factQuotes:facts,citedQuotes:validClaims.map(c=>c.quote),restrictions:input.restrictions,safetyRestricted:input.safetyRestricted};
 const all=input.candidate.blocks?.length?input.candidate.blocks.map(b=>({...b,text:stripNumbering(b.text)})):legacyBlocks(input.candidate);
 const ids=new Set<string>();const bad=new Set<string>();
 const typed=!!input.candidate.blocks?.length;
 if(typed&&[input.candidate.text,input.candidate.nextStep??''].some(t=>t.trim()&&!all.map(b=>b.text).join('\n').includes(stripNumbering(t)))){reasons.add('SCHEMA_INVALID');for(const b of all)bad.add(b.id);}
 const allowedKinds=['OBSERVED_FACT','DERIVED_FACT','EXISTING_PLAN','CANDIDATE_ADVICE','GENERAL_KNOWLEDGE','UNCERTAINTY','ACTION_RESULT'];
 function checked(text:string,kind:AnswerBlockKind){
  if(/\b(?:UNKNOWN|PAIN|SORENESS|COMPLETED)\b|(?:UNKNOWN|distanceComplete|完整距离覆盖)\s*=\s*(?:false|true)/.test(text)){reasons.add('UI_STATE_MISMATCH');return false;}
  if(affirmed(text,/恢复(?:已)?取消(?:的)?(?:写操作|登记|写入)/)){reasons.add('CANCELLED_ACTION_REPLAY');return false;}
  if(kind==='CANDIDATE_ADVICE'&&affirmed(text,/压缩成|压成|合并到|叠加|塞进/)){reasons.add('UNSUPPORTED_DOSE');return false;}
  if(unsupportedEvidenceStateClaim(text,state)){reasons.add('UNKNOWN_AS_FACT');return false;}
  if(affirmed(text,/(?:证明|确定).{0,16}(?:恢复恶化|恢复正常|疲劳已经恢复|完全恢复)/)&&!/(?:不能|无法|不足以).{0,14}(?:证明|确定)/.test(text)){reasons.add('SOURCE_MISMATCH');return false;}
  if(state.symptomReports.length&&(affirmed(text,/(?:当前|缓存|你).{0,5}(?:无痛|没有疼痛)/)||affirmed(text,/(?:允许|可以)加量/))){reasons.add('RISK_SCOPE_CONFLICT');return false;}
  if(affirmed(text,/(?:可以|允许)(?:按(?:原|该)?计划|照原计划)?(?:继续|执行|恢复)/)){
   const activity=/冲刺|跑步|轻松跑|深蹲|硬拉|卧推|弯举/.exec(text+'；'+input.question)?.[0]??'训练';
   if(!validateCoachAssertions('你可以继续'+activity+'。',{...options,factQuotes:[]}).ok){reasons.add('RISK_SCOPE_CONFLICT');return false;}
  }
  if(affirmed(text,/(?:按照|执行|遵循).{0,10}(?:网页|备注|页面).{0,8}指令|读取(?:另|其他).{0,5}(?:账号|用户)/)){reasons.add('SOURCE_MISMATCH');return false;}
  if(expectedComputed.some(q=>/平均配速相同|并列/.test(q))&&affirmed(text,/更快/) ){reasons.add('DERIVATION_INVALID');return false;}
  if(unsupportedSemanticFact(text,facts,expectedComputed)){reasons.add('SOURCE_MISMATCH');return false;}
  let checkText=text;
  const action=input.tools?.action;
  const actionText=text.replace(/(?:未|没有|不会|不应)(?:改写|修改|覆盖)(?:已经|已)保存(?:的)?(?:记录|资料|计划|课表)/g,'保留原有记录');
  if(kind!=='ACTION_RESULT'&&affirmed(actionText,/(?:已|已经)(?:成功|替你|为你)?(?:登记|录入|写入|保存|更新|修改|重排)/)){reasons.add('WRITE_UNCONFIRMED');return false;}
  if(kind==='ACTION_RESULT'&&action&&actionReceiptMatches(action.intent,action.receipt,action.currentOwner,action.authorized)&&text===action.claimText)return true;
  if(kind==='ACTION_RESULT'){reasons.add('WRITE_UNCONFIRMED');return false;}
  if(/https?:\/\//.test(text)||/(?:刚刚|本次|刚才).{0,6}(?:查到|查证|检索到|搜索到)/.test(text)){
   const checked=checkedRetrievalProse(text,input.tools?.retrieval,Date.parse(input.now??new Date().toISOString()));
   if(!checked.ok){reasons.add('RETRIEVAL_UNPROVEN');return false;}checkText=checked.prose;
  }
  const bound=kind==='CANDIDATE_ADVICE'&&boundExistingPlanAdvice(checkText,input.question,[...validClaims.map(c=>c.quote),...plans]);
  if(bound&&!plannedAdviceActionIsSafe(checkText,options)){reasons.add('RISK_SCOPE_CONFLICT');return false;}
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
 if(input.tools?.retrieval.state==='SUCCEEDED')for(const [i,page]of input.tools.retrieval.sources.entries()){
  if(!kept.some(b=>b.text.includes(page.quote)&&b.text.includes(page.url)))host('本次取得的网页原文：'+page.quote+' '+page.url,'OBSERVED_FACT','host:web:'+i);
 }
 if(validClaims.some(c=>/\b(?:UNKNOWN|PAIN|SORENESS|COMPLETED)\b|完整距离覆盖=/.test(c.quote)))hostContext.slice(0,6).forEach((q,i)=>host(q,'OBSERVED_FACT','host:projection:'+i));
 // Exact accepted citations remain available when numeric paraphrases are removed.
 if(!kept.length||buildAnswerTask(input.question).some(t=>t.kind==='COMPARISON'||t.kind==='ANSWER'))for(const [i,c]of validClaims.entries())host(c.quote,'OBSERVED_FACT','host:quote:'+i);
 if(buildAnswerTask(input.question).some(t=>t.kind==='ARRANGEMENT')&&!plans.length)for(const [i,q]of hostContext.entries())if(/可练|可用.{0,6}(?:天|次)|可训练/.test(q))host(q,'OBSERVED_FACT','host:availability:'+i);
 if(!kept.length&&!reasons.has('DEPENDENCY_BROKEN')&&/总结|汇总|当前有效|回放|计划是什么/.test(input.question))hostContext.slice(0,6).forEach((q,i)=>host(q,'OBSERVED_FACT','host:context:'+i));
 if(buildAnswerTask(input.question).some(r=>r.kind==='COVERAGE'))host(state.coverage==='UNKNOWN'?'记录覆盖尚未确认，不能由现有记录证明全年训练完整，也不能断言已经漏记。':state.coverage==='INCOMPLETE'?'按你明确提供的漏记说明，当前记录存在缺失；缺失部分的数量未知。':'记录完整性按明确确认的范围说明。','UNCERTAINTY','host:coverage');
 if(reasons.has('UNKNOWN_AS_FACT')&&!state.declaredRestrictions.length&&/医嘱|医疗|许可|限制训练|训练限制|活动限制/.test(input.candidate.text))host('症状来自当前本人自述；医疗许可状态未知。当前资料未提供医嘱记录。谨慎处理是系统建议。','UNCERTAINTY','host:authority');
 if(reasons.has('RISK_SCOPE_CONFLICT')){
  state.symptomReports.slice(0,2).forEach((r,i)=>host('当前本人反馈：'+r.text+'。其原因和许可状态仍需核实。','OBSERVED_FACT','host:symptom:'+i));
  state.declaredRestrictions.slice(0,2).forEach((r,i)=>host('用户转述的限制：'+r.text+'。需核实有效范围，不能因原计划而放行。','OBSERVED_FACT','host:restriction:'+i));
 }
 if(!kept.length&&/换表|HRV/.test(input.question))host('设备或算法变化后，数值未必可比；请提供同口径记录与个人常态，再结合主观反馈观察，不能仅凭下降判定恢复恶化。','UNCERTAINTY','host:device');
 if(!kept.length&&/睡眠/.test(input.question))host('当前睡眠时长未知；未同步不等于没有睡眠。请补录或重新同步后核对，不能据缺失判断疲劳程度。','UNCERTAINTY','host:sleep');
 if(!kept.length&&/登记|录入/.test(input.question)&&!input.tools?.action)host('请先确认食物份量或重量、配料及所属餐次；如选择估算需明确标注。当前没有成功写入回执，尚未确认登记。','UNCERTAINTY','host:food');
 if(input.tools?.action?.receipt.status==='UNKNOWN'){reasons.add('ACTION_STATUS_UNKNOWN');host('提交结果未知，尚未确认完成；请按原幂等键查询回执并对账，不要重新创建登记。','UNCERTAINTY','host:action-unknown');}
 const retrievalSucceeded=input.tools?.retrieval.state==='SUCCEEDED'&&!!input.tools.retrieval.sources.length;
 if(buildAnswerTask(input.question).some(r=>r.kind==='RETRIEVAL')&&!retrievalSucceeded){reasons.add('RETRIEVAL_UNPROVEN');host('本轮未能取得所需的最新网页，查询尚未完成；已有资料仅可作为有限背景。联网选择保留。','UNCERTAINTY','host:retrieval');}
 if(reasons.has('UI_STATE_MISMATCH')&&!kept.length)host('当前状态未知，证据不足；请补充近期训练、主观恢复和不适反馈后再判断。','UNCERTAINTY','host:unknown');
 let coverage=evaluateAnswerTask(input.question,kept,retrievalSucceeded);
 if(coverage.some(t=>!t.satisfied))reasons.add('TASK_DROPPED');
 if(coverage.some(t=>!t.satisfied&&t.kind==='ARRANGEMENT')&&!input.safetyRestricted&&!state.symptomReports.length){
  const framework=/比赛/.test(input.question)?'安排思路：先核对赛期与当前负荷，临近比赛时讨论维持熟悉节奏和恢复余量；准备期较长时先评估，再分阶段安排目标课与恢复。不新增未经核对的个人剂量。':'安排思路：先核对原课表、目标与可用时间，讨论关键课的优先级和恢复间隔，不补课追进度。具体取舍需确认，本轮未修改日历。';
  host(framework,'CANDIDATE_ADVICE','host:framework');
 }
 // Deterministic clarification only; no invented personal dose to fill a task.
 if(coverage.some(t=>!t.satisfied&&['ARRANGEMENT','MISSING_DATA'].includes(t.kind)))host('请补充专项与目标日期、原课表及近期训练、主观疲劳和不适情况，才能核对安排。当前仅能讨论框架，未修改计划。','UNCERTAINTY','host:clarification');
 if(!kept.length){reasons.add('TASK_DROPPED');host(input.safetyRestricted||reasons.has('RISK_SCOPE_CONFLICT')?'不要进行受限训练；请先核对症状、限制范围与当前状态。本轮未修改计划。':'本轮回答未能完成可靠核验。请补充本题所需的记录或目标；未执行任何修改。','UNCERTAINTY','host:failure');}
 const max=input.maxChars??1000;
 // Remove whole groups only. Never truncate a condition or unit to fit a limit.
 while(kept.map(b=>b.text).join('\n').length>max&&kept.length>1){const removable=[...kept].reverse().find(b=>b.kind==='OBSERVED_FACT')??kept.at(-1)!;const removed=new Set(kept.filter(b=>b.groupId===removable.groupId).map(b=>b.id));let expand=true;while(expand){expand=false;for(const b of kept)if(!removed.has(b.id)&&b.dependsOn.some(d=>removed.has(d))){for(const member of kept.filter(m=>m.groupId===b.groupId))removed.add(member.id);expand=true;}}for(let i=kept.length-1;i>=0;i--)if(removed.has(kept[i].id))kept.splice(i,1);reasons.add('TASK_DROPPED');}
 let text=kept.map(b=>b.text).join('\n');
 if(!text||text.length>max||kept.some(b=>!checked(b.text,b.kind))){kept.splice(0,kept.length,{id:'host:technical',kind:'UNCERTAINTY',text:'本轮最终回答无法完整核验，已停止处理；请缩小问题范围，原记录和计划保留。',evidenceRefs:[],dependsOn:[],groupId:'host:technical'});text=kept[0].text;reasons.add('FINAL_VALIDATION_FAILED');}
 coverage=evaluateAnswerTask(input.question,kept,retrievalSucceeded);
 const riskRefusal=reasons.has('RISK_SCOPE_CONFLICT')&&!/当前|最新信息|已知信息|已知资料/.test(input.question)&&kept.every(b=>b.id.startsWith('host:'));
 if(riskRefusal)reasons.add('TASK_DROPPED');
 const complete=coverage.every(t=>t.satisfied)&&!reasons.has('TASK_DROPPED');
 const decision:AnswerDecision=reasons.has('FINAL_VALIDATION_FAILED')||reasons.has('EMPTY_RESPONSE')||reasons.has('ACTION_STATUS_UNKNOWN')||reasons.has('CANCELLED_ACTION_REPLAY')||reasons.has('RETRIEVAL_UNPROVEN')&&kept.every(b=>b.kind==='UNCERTAINTY')?'FAILED_TECHNICAL':complete?(reasons.size?'REPAIRED':'VALIDATED'):reasons.has('RISK_SCOPE_CONFLICT')?(riskRefusal?'SAFE_REFUSAL':'PARTIAL'):reasons.has('DEPENDENCY_BROKEN')?'PARTIAL':coverage.every(t=>!t.satisfied)||kept.every(b=>b.kind==='UNCERTAINTY')||/先帮我规划/.test(input.question)&&!plans.length?'NEEDS_CLARIFICATION':'PARTIAL';
 const professionalReview=/疼|痛|伤|医|恢复|HRV/.test(input.question)||kept.some(b=>b.kind==='CANDIDATE_ADVICE')?'PENDING':'NOT_REQUIRED';
 const reasonCodes=[...reasons];
 const stageCodes=[['WRITE_UNCONFIRMED'],['SCHEMA_INVALID','EMPTY_RESPONSE'],['SOURCE_MISMATCH','UNKNOWN_AS_FACT'],['DERIVATION_INVALID'],['UNSUPPORTED_DOSE','RISK_SCOPE_CONFLICT','DIAGNOSIS_CLAIM'],['WRITE_UNCONFIRMED','RETRIEVAL_UNPROVEN'],['DEPENDENCY_BROKEN'],['TASK_DROPPED'],['FINAL_VALIDATION_FAILED']];
 return {policyVersion:ANSWER_GATE_VERSION,decision,text,blocks:kept,reasonCodes,taskCoverage:coverage,professionalReview,finalHash:sha256Hex(text),evidenceQuotes:validClaims.filter(c=>text.includes(c.quote)).map(c=>c.quote),computedQuotes:computed.filter(q=>text.includes(q)),gates:stageCodes.map((codes,i)=>{const errors=reasonCodes.filter(c=>codes.includes(c));return {gate:'G'+i,status:errors.length?(i===7&&!complete?'PARTIAL':'REPAIRED'):'PASS',reasons:errors};})};
}
