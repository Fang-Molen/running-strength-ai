import {sha256Hex} from '../core/sha256-sync';
import {validateCoachAssertions,type CoachAssertionOptions} from './assertion-policy';
import {boundExistingPlanAdvice,plannedAdviceActionIsSafe} from './advice-grounding';
import {buildAnswerEvidenceState} from './answer-evidence';
import {evaluateAnswerTask} from './answer-task';
import {unsupportedEvidenceStateClaim,unsupportedSemanticFact,type AnswerGateResult,type AnswerToolState} from './answer-gate';
import {checkedRetrievalProse,validRetrievalState} from './answer-tools';
import {contextModelQuote,type CoachRequestContext} from './online-contract';
/** Browser rechecks the delivered semantic groups against the still-current
 * local evidence. A server hash is integrity metadata, never source authority. */
export function verifyDeliveredAnswer(gate:AnswerGateResult,input:{question:string;context?:CoachRequestContext;factQuotes:string[];citedQuotes:string[];computedQuotes:string[];safetyRestricted:boolean;restrictions?:CoachAssertionOptions['restrictions'];tools?:AnswerToolState;now?:string}):boolean{
 if(gate.finalHash!==sha256Hex(gate.text)||gate.blocks.map(b=>b.text).join('\n')!==gate.text)return false;
 const byId=new Map(gate.blocks.map(b=>[b.id,b]));if(byId.size!==gate.blocks.length)return false;
 const done=new Set<string>(),stack=new Set<string>();
 const visit=(id:string):boolean=>{if(stack.has(id))return false;if(done.has(id))return true;const b=byId.get(id);if(!b||!Array.isArray(b.dependsOn))return false;stack.add(id);if(!b.dependsOn.every(visit))return false;stack.delete(id);done.add(id);return true;};
 const state=buildAnswerEvidenceState(input.question,input.context);
 const now=Date.parse(input.now??new Date().toISOString());
 for(const b of gate.blocks){
  if(!visit(b.id)||unsupportedEvidenceStateClaim(b.text,state)||unsupportedSemanticFact(b.text,input.factQuotes,input.computedQuotes))return false;
  const plans=(input.context?.records??[]).filter(r=>r.category==='PLAN'&&r.state==='PLANNED').map(contextModelQuote);
  const bound=b.kind==='CANDIDATE_ADVICE'&&boundExistingPlanAdvice(b.text,input.question,[...input.citedQuotes,...plans]);
  const options={...input,factQuotes:[...input.factQuotes,...input.computedQuotes,...(bound?[b.text]:[])]};
  if(bound&&!plannedAdviceActionIsSafe(b.text,options))return false;
  let text=b.text;
  if(/https?:\/\//.test(text)||/(?:刚刚|本次|刚才).{0,6}(?:查到|查证|检索到|搜索到)/.test(text)){const checked=checkedRetrievalProse(text,input.tools?.retrieval,now);if(!checked.ok)return false;text=checked.prose;}
  if(!validateCoachAssertions(text,options).ok)return false;
 }
 const coverage=evaluateAnswerTask(input.question,gate.blocks,!!input.tools?.retrieval&&validRetrievalState(input.tools.retrieval,now)&&input.tools.retrieval.state==='SUCCEEDED');
 if(['VALIDATED','REPAIRED'].includes(gate.decision)&&coverage.some(r=>!r.satisfied))return false;
 return true;
}
