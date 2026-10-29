import {verifyDeliveredAnswer} from './answer-delivery'
import type {AnswerDecision} from './answer-gate'
import {computedCoachQuotes} from './context-comparison'
import {questionEvidence,supportedEvidenceQuote} from './question-evidence'
import { type OnlineConversationTurn } from './online-handoff'
import { COACH_DISCLOSURE_VERSION, declarationQuote, contextRecordQuote, contextModelQuote, type CoachRequestContext, type CoachDeclaration, type CoachSnapshotReference } from './online-contract'
import { readCoachResponse, coachServiceStatusText, type DecodedCoachAnswer } from './online-service'
import { onlineSetting } from './online-coach'
import { readAnalysis } from '../health/analysis-host'
import type { AnalysisFact, CoachAnalysisPacket } from '../health/analysis-contract'
import { analysisDigest, projectAnalysisEvidence } from '../health/analysis-evidence'
import { buildMuscleExposure } from '../health/muscle-exposure'
import { evaluateRecoveryEvidence } from '../health/recovery-assessment'
import { buildCoachAnalysisPacket } from '../health/analysis-packet'
import type { ScopedRestriction } from './utterance-semantics'
import { analysisDay } from '../health/coach-data'
import { localDay } from '../health/observation'
import { validateCoachAssertions } from './assertion-policy'
import { readOnlineContext } from './online-context'
import { readR5Context } from './r5/host'

export type OnlinePreview = {
 conversation?:readonly OnlineConversationTurn[];
 owner:string; question:string; day:string; preparedAt:string; sourceVersion:string;
 declarations:CoachDeclaration[]; packet:CoachAnalysisPacket; omittedRecords:number; context?:CoachRequestContext; trainingRestricted?:boolean; restrictions?:ScopedRestriction[]; selectedTrainingIds?:readonly string[];
}
/** Only locally owned manual/app scalar records. Device verification, structured
 * workouts, food, plans and inferred thresholds are deliberately not claimed by this route. */
export function selectCoachDeclarations(facts:AnalysisFact[],owner:string,asOf:string):CoachDeclaration[]{
 const cutoff=Date.parse(asOf), result:CoachDeclaration[]=[]
 let records=0
 for(const f of [...facts].sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt))){
  const time=Date.parse(f.occurredAt)
  if(f.athleteId!==owner||!['MANUAL','APP'].includes(f.provider)||f.status!=='CONFIRMED'||!['AVAILABLE','PARTIAL'].includes(f.quality)||!Number.isFinite(time)||time>cutoff||time<cutoff-14*86400000||!Number.isFinite(Date.parse(f.knownAt))||Date.parse(f.knownAt)>cutoff)continue
  const rows:CoachDeclaration[]=[]
  const add=(metric:CoachDeclaration['metric'],value:number|null,unit:CoachDeclaration['unit'],max:number)=>{
   if(value===null||!Number.isFinite(value)||value<0||value>max||!/^\d+(?:\.\d{1,6})?$/.test(String(value))||(metric==='duration'&&value===0))return
   rows.push({recordId:analysisDigest([f.id,f.provider,f.accountRef,f.deviceId,f.protocolKey]),revision:String(f.revision),occurredAt:new Date(time).toISOString(),kind:'actual',metric,value,unit})
  }
  if(f.kind==='TRAINING'){
   add('duration',f.actualDurationSeconds,'s',86400)
   if(['0-10','1-10','0-10_SESSION_RPE','0-10_HIGH_HARD','1-10_HIGH_HARD','CR10'].includes(f.sessionRpeScale??''))add('session_rpe',f.sessionRpe,'/10',10)
  }else if(f.kind==='METRIC'&&['SLEEP','SLEEP_SELF_REPORT'].includes(f.metric)&&f.unit==='h'&&f.temporalResolution!=='DAY')add('sleep',f.value,'h',24)
  else if(f.kind==='RESPONSE'){
   if(['PAIN','SORENESS'].includes(f.measure)&&f.scale==='0-10_HIGH_WORSE')add(f.measure==='PAIN'?'pain':'soreness',f.value,'/10',10)
   if(f.measure==='RECOVERY_FEELING'&&f.scale==='1-10_HIGH_BETTER'&&f.value!==null&&f.value>=1)add('subjective_recovery',f.value,'/10',10)
  }
  if(rows.length&&records++<6)result.push(...rows)
 }
 return result
}
export type OnlineAnswerBasis={answerDecision?:AnswerDecision;sourceEvidence?:string[];professionalReview?:'PENDING'|'NOT_REQUIRED';conversation?:readonly OnlineConversationTurn[];owner:string;question:string;day:string;sourceVersion:string;selectedTrainingIds?:readonly string[]}
function context(question:string,day:string,selectedTrainingIds:readonly string[]=[],conversation:readonly OnlineConversationTurn[]=[]){
 const now=new Date().toISOString(),selected=readOnlineContext(question,day,now,undefined,selectedTrainingIds,conversation,{currentLoadCache:true})
 return {...selected,now,enabled:onlineSetting().on}
}
export function onlinePreviewIsCurrent(basis:OnlineAnswerBasis,requireEnabled=true):boolean{
 try{const latest=context(basis.question,basis.day,basis.selectedTrainingIds,basis.conversation);return (!requireEnabled||latest.enabled)&&latest.owner===basis.owner&&latest.sourceVersion===basis.sourceVersion}catch{return false}
}
export function prepareOnlineExplanation(question:string,selectedTrainingIds:readonly string[]=[],conversation:readonly OnlineConversationTurn[]=[]):OnlinePreview{
 const q=question.trim()
 if(!q||q.length>1000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(q))throw Error('问题需在1000字以内，且不含控制字符。')
 const day=analysisDay(q,null,localDay()),c=context(q,day,selectedTrainingIds,conversation)
 const empty=()=>{
  const snapshot=projectAnalysisEvidence({context:{athleteId:c.owner,asOf:c.now,timeZone:'UTC',planVersion:null,consentVersion:'PERSISTENT_SETTING',analysisVersion:'ONLINE_KNOWLEDGE_2'},facts:[]})
  const exposure=buildMuscleExposure(snapshot)
  return {packet:buildCoachAnalysisPacket(snapshot,evaluateRecoveryEvidence(snapshot,exposure),exposure,{question:q})}
 }
 const analysis=c.analysisPacket?{packet:c.analysisPacket}:c.personal?readAnalysis(day,c.now,q):empty()
 let restrictions:ScopedRestriction[]=[],trainingRestricted=true
 try{const scope=readR5Context(c.now,q);restrictions=scope.restrictions;trainingRestricted=scope.permission.trainingRestricted}catch{/* Knowledge remains available; unknown safety cannot authorize activity. */}
 return {conversation:[...conversation],owner:c.owner,question:q,day,selectedTrainingIds:[...selectedTrainingIds],preparedAt:c.now,sourceVersion:c.sourceVersion,declarations:[],context:c.context,packet:analysis.packet,
  trainingRestricted,restrictions,omittedRecords:c.context.coverage.omitted}
}
async function requestHeaders():Promise<Record<string,string>>{
 const headers:Record<string,string>={'content-type':'application/json'}
 if(typeof window!=='undefined'&&import.meta.env){const {getBearerToken}=await import('../auth/client');const token=getBearerToken();if(token)headers.authorization=`Bearer ${token}`}
 return headers
}
/** Explicit preference changes sync the account grant; this endpoint never calls a model. */
export async function syncOnlineAuthorization(enabled:boolean):Promise<{ok:boolean;reason:string}>{
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000)
 try{
  const headers=await requestHeaders()
  const response=await fetch('/api/coach-snapshot',{method:'POST',credentials:'same-origin',headers,signal:controller.signal,body:JSON.stringify({onlineConsent:{enabled,disclosureVersion:COACH_DISCLOSURE_VERSION}})})
  if(response.ok){const body=await response.json();if(body?.ok===true)return {ok:true,reason:enabled?'联网许可已开启；以后提问自动发送相关资料。':'联网许可已关闭。'}}
  const error=await readCoachResponse(response)
  return {ok:false,reason:'error'in error?error.error:'联网许可状态未确认。'}
 }catch{return {ok:false,reason:enabled?'无法连接服务端，联网许可尚未开启。':'本机已关闭联网；服务端撤权尚未确认，恢复连接后请再次关闭以同步。'}}
 finally{clearTimeout(timer)}
}
type SessionPorts={current:()=>{owner:string;sourceVersion:string;enabled:boolean};headers:()=>Promise<Record<string,string>>;fetch:(url:string,init?:RequestInit)=>Promise<Response>}
const used=new WeakSet<OnlinePreview>()
/** Persistent online preference authorizes explanation; the server independently checks
 * identity, ownership, grant, snapshot and persistent budget before dispatch. */
export async function runOnlineExplanation(preview:OnlinePreview,options:{consent?:boolean;signal?:AbortSignal}={},ports:SessionPorts={current:()=>context(preview.question,preview.day,preview.selectedTrainingIds,preview.conversation),headers:requestHeaders,fetch:(u,i)=>fetch(u,i)}):Promise<(DecodedCoachAnswer&{source:'LOCAL'|'MODEL'})|{error:string}>{
 let ref:CoachSnapshotReference|undefined,headers:Record<string,string>|undefined
 const controller=new AbortController(),cancel=()=>controller.abort(),timer=setTimeout(cancel,30000)
 options.signal?.addEventListener('abort',cancel,{once:true});if(options.signal?.aborted)cancel()
 const fresh=()=>{try{const c=ports.current();return !controller.signal.aborted&&c.enabled&&c.owner===preview.owner&&c.sourceVersion===preview.sourceVersion}catch{return false}}
 const ensure=()=>{if(!fresh())throw Error('资料、身份或联网选择已变化，本地回答保留；请重新核对资料。')}
 try{
  if(options.consent===false||used.has(preview))throw Error('联网授权已关闭或本次请求已发送；不会自动重复调用。')
  ensure();used.add(preview)
  const status=await ports.fetch('/api/coach-chat',{method:'GET',credentials:'same-origin',cache:'no-store',signal:controller.signal})
  if(status.headers.get('content-type')?.includes('text/html')||[404,405].includes(status.status))throw Error(coachServiceStatusText({state:'missing-route'}))
  const info=await status.json().catch(()=>null)
  if(!status.ok||info?.service!=='fangkun-coach'||info.configured!==true){const failure=await readCoachResponse(Response.json({error:info?.reason},{status:503}));throw Error('error'in failure?failure.error:'联网服务配置尚未完成')}
  ensure();headers=await ports.headers();ensure()
  const created=await ports.fetch('/api/coach-snapshot',{method:'POST',credentials:'same-origin',headers,signal:controller.signal,body:JSON.stringify({question:preview.question,declarations:preview.declarations,context:preview.context,consent:{purpose:'coach_explanation',disclosureVersion:COACH_DISCLOSURE_VERSION,mode:'PERSISTENT'}})})
  if(!created.ok||created.headers.get('content-type')?.includes('text/html')){const error=await readCoachResponse(created);throw Error('error'in error?error.error:'授权快照未建立')}
  const receipt=await created.json(),id=/^[A-Za-z0-9_.:/-]{1,120}$/
  if(!receipt?.snapshotRef||!id.test(receipt.snapshotRef.snapshotId)||!id.test(receipt.snapshotRef.consentId)||!Number.isFinite(Date.parse(receipt.snapshotRef.asOf)))throw Error('服务端授权引用无效，本地回答保留。')
  ref=receipt.snapshotRef
  if(receipt.ok!==true||receipt.provenance!=='USER_DECLARED'||receipt.disclosureVersion!==COACH_DISCLOSURE_VERSION||Date.parse(receipt.expiresAt)<=Date.now()||!Number.isFinite(Date.parse(receipt.expiresAt))||Date.parse(ref!.asOf)>Date.now()||JSON.stringify(receipt.factQuotes)!==JSON.stringify(preview.declarations.map(declarationQuote)))throw Error('服务端资料与本次确认范围不一致，本地回答保留。')
  if(preview.context&&JSON.stringify(receipt.contextQuotes)!==JSON.stringify(preview.context.records.map(contextRecordQuote)))throw Error('服务端上下文与本问相关资料不一致，本地回答保留。')
  ensure()
  const response=await ports.fetch('/api/coach-chat',{method:'POST',credentials:'same-origin',headers,signal:controller.signal,body:JSON.stringify({question:preview.question,requestId:crypto.randomUUID(),...ref})})
  const answer=await readCoachResponse(response);ensure()
  if('error'in answer)return answer
  if(!answer.source)return {error:'回答来源未能确认，已保留本地回答；不将其标为模型解释。'}
  let restrictions=preview.restrictions
  try{restrictions=readR5Context(new Date().toISOString(),preview.question).restrictions}catch{/* Retain the captured restrictions on read failure. */}
  const computed=computedCoachQuotes(preview.question,preview.context)
  if((answer.computedQuotes??[]).some(q=>!computed.includes(q)||!answer.text.includes(q)))return {error:'宿主比较与当前记录不一致。'}
  const sources=[...computed,...preview.declarations.map(declarationQuote),...(preview.context?.records??[]).filter(r=>r.category!=='DIALOGUE').map(contextModelQuote),...questionEvidence(preview.question,preview.context).map(s=>s.detail)]
  const quoted=answer.evidenceQuotes??[]
  if(quoted.some(q=>!answer.text.includes(q)||!sources.some(s=>supportedEvidenceQuote(s,q))))return {error:'模型引用与本次资料不一致，已保留本地回答。'}
  if(answer.answerGate){
   if(!verifyDeliveredAnswer(answer.answerGate,{question:preview.question,context:preview.context,restrictions,factQuotes:[...sources,...quoted],citedQuotes:quoted,computedQuotes:computed,safetyRestricted:preview.trainingRestricted??preview.packet.assessment.safetyState!=='NO_KNOWN_HOLD'}))return {error:'最终回答与当前资料、安全限制或任务状态不一致，已保留本地回答。'}
  }else{
  const checked=validateCoachAssertions(answer.text,{citedQuotes:quoted,question:preview.question,restrictions,factQuotes:[...sources,...quoted],safetyRestricted:preview.trainingRestricted??preview.packet.assessment.safetyState!=='NO_KNOWN_HOLD'})
  if(!checked.ok)return {error:'模型内容未通过事实或安全核验，已保留本地回答。'}
  }
  return {...answer,source:answer.source}
 }catch(error){return {error:controller.signal.aborted?'本轮联网已取消或超时，本地回答保留；不会自动重试。':error instanceof TypeError?'网络连接失败，本地回答保留；未确认模型是否收到请求，不自动重试。':error instanceof Error?error.message:'联网不可用，本地回答保留。'}}
 finally{
  clearTimeout(timer);options.signal?.removeEventListener('abort',cancel)
  if(ref&&headers){const cleanup=new AbortController(),timeout=setTimeout(()=>cleanup.abort(),3000);try{await ports.fetch('/api/coach-snapshot',{method:'DELETE',credentials:'same-origin',headers,body:JSON.stringify(ref),signal:cleanup.signal})}catch{/* server expiry remains the fallback when offline */}finally{clearTimeout(timeout)}}
  // Revocation also awaits I/O: an identity/data change during cleanup must
  // invalidate an answer that had passed the earlier check.
  if(!fresh())return {error:'本轮已取消，或资料、身份、联网选择已变化；本地回答保留。'}
 }
}
