/** Offline preparation only. No API client, credentials, network or execution authority. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import {resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {buildCoachAnalysisPacket,analysisModelView} from '../../src/lib/health/analysis-packet'
import {projectAnalysisEvidence} from '../../src/lib/health/analysis-evidence'
import {buildMuscleExposure} from '../../src/lib/health/muscle-exposure'
import {evaluateRecoveryEvidence} from '../../src/lib/health/recovery-assessment'
import {estimateInputTokenUpperBound} from '../../src/lib/coach/deepseek-policy'
import {sourceScope} from '../../src/lib/health/analysis-evidence'
import {neutralFacts} from './neutral-facts'
import type {AnalysisFact,Context,EvidenceSnapshot} from '../../src/lib/health/analysis-contract'
export type ABFixture={caseId:string;context:Context;facts:AnalysisFact[];provenance:'PUBLIC_SYNTHETIC';frozenVersion:string;coachContext?:Record<string,unknown>;source?:string;priorHypotheses?:EvidenceSnapshot['priorHypotheses']}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const system='你是训练解释评测助手。仅依据给定事实，区分计划与实际、缺失与零。返回JSON：answer,factualClaims[{text,refs[{id,revision}]}],derivedFactIds,selectedCandidateId,hypotheses,unknowns,followup,memoryClaim。已提供的程序派生事实只选择derivedFactIds，不重新计算或改写数字；宿主按事实ID渲染数值、单位与来源。没有程序派生事实时derivedFactIds为空。新解释须区分假设与证据并给出反证，未经核验不能作为正式判断。不得诊断、编造能力分、擅自改课或声称保存；memoryClaim=NOT_SAVED。'
export function commonSource(f:ABFixture,s:ReturnType<typeof projectAnalysisEvidence>,p:ReturnType<typeof buildCoachAnalysisPacket>){
 const selected=new Set(s.facts.map(x=>x.id+'@'+x.revision)),missingReasons=new Set(['MISSING','UNAVAILABLE','NOT_RECORDED','PERMISSION_DENIED','NOT_WORN','NULL'])
 const visible=f.facts.filter(x=>x.athleteId===s.context.athleteId&&[x.knownAt,x.receivedAt,x.occurredAt].every(t=>Number.isFinite(Date.parse(t))&&Date.parse(t)<=Date.parse(s.context.asOf))&&(selected.has(x.id+'@'+x.revision)||s.excluded.some(e=>e.ref.id===x.id&&e.ref.revision===x.revision&&missingReasons.has(e.reason))))
 const ordered=visible.slice().sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt)||a.id.localeCompare(b.id));const occurrences=new Map<string,string>();for(const x of ordered)if(x.kind==='TRAINING'&&!occurrences.has(x.occurrenceId))occurrences.set(x.occurrenceId,`O${occurrences.size+1}`)
 const ids=new Map<string,string>(),protocols=new Map<string,string>();for(const x of ordered)if(!ids.has(x.id))ids.set(x.id,`F${ids.size+1}`)
 const scopes=new Map<string,any>();const accounts=new Map<string,string>(),devices=new Map<string,string>();const alias=(v:string|null,m:Map<string,string>,prefix:string)=>{if(!v)return null;if(!m.has(v))m.set(v,prefix+(m.size+1));return m.get(v)!}
 const protocol=(v:string|null)=>{if(!v)return null;if(!protocols.has(v))protocols.set(v,`P${protocols.size+1}`);return protocols.get(v)!}
 return {referenceOrder:[...ids.keys()],asOf:s.context.asOf,timeZone:s.context.timeZone,coachContext:Object.fromEntries(Object.entries(f.coachContext??{}).filter(([k,v])=>k!=='priorHypothesis'||!(s.priorHypotheses??[]).some(h=>{const p=v as any;return p?.claim===h.claim&&p?.status===h.status&&p?.knownAt===h.knownAt}))),
  priorHypotheses:(s.priorHypotheses??[]).map(h=>({claim:h.claim,status:h.status,knownAt:h.knownAt,supportingRefs:h.supportingRefs.map(r=>({id:ids.get(r.id)??'UNRESOLVED',revision:r.revision})),weakeningRefs:h.weakeningRefs.map(r=>({id:ids.get(r.id)??'UNRESOLVED',revision:r.revision}))})),
  sourceColumns:['id','revision','provider','protocol','occurredAt','knownAt','status','quality'],
  facts:ordered.map(x=>{
   const ownership=[alias(x.accountRef,accounts,'A'),alias(x.deviceId,devices,'D')],sk=JSON.stringify([x.provider,ownership,protocol(x.protocolKey)]);if(!scopes.has(sk))scopes.set(sk,{id:'S'+(scopes.size+1),provider:x.provider,account:ownership[0],device:ownership[1],protocol:protocol(x.protocolKey)});const scopeId=scopes.get(sk).id;const source=[ids.get(x.id),x.revision,x.provider,protocol(x.protocolKey),x.occurredAt,x.knownAt,x.status,x.quality]
   const value=x.kind==='TRAINING'?{kind:x.kind,occurrenceId:occurrences.get(x.occurrenceId),componentId:x.componentId,modality:x.modality,plannedPurpose:x.plannedPurpose,observedType:x.observedType,sessionRpe:x.sessionRpe,sessionRpeScale:x.sessionRpeScale,actualDurationSeconds:x.actualDurationSeconds,runSegments:x.runSegments.map(({id,...rest})=>rest),strengthSets:x.strengthSets.map(({id,...rest})=>rest),jumpContacts:x.jumpContacts}
    :x.kind==='METRIC'?{kind:x.kind,metric:x.metric,value:x.value,unit:x.unit,statistic:x.statistic,providerDate:x.providerDate,energyKind:x.energyKind}
    :{kind:x.kind,measure:x.measure,value:x.value,scale:x.scale,region:x.region,elapsedHours:x.elapsedHours,relatedTrainingRefs:x.relatedTrainingRefs.map(r=>({id:ids.get(r.id)??'UNRESOLVED',revision:r.revision})),side:x.side,observationProtocol:x.observationProtocol,functionTaskId:x.functionTaskId,notes:x.notes}
   return {source,ownership,scopeId,value}
  }),scopes:[...scopes.values()]}
}
// Lossless column encoding reduces repeated field names, never removes facts.
function compact(v:any):any{
 if(Array.isArray(v)){const rows=v.map(compact);if(v.length>1&&v.every(x=>x&&typeof x==='object'&&!Array.isArray(x))){const keys=Object.keys(v[0]);if(v.every(x=>JSON.stringify(Object.keys(x))===JSON.stringify(keys)))return {columns:keys,rows:rows.map(x=>keys.map(k=>x[k]))}}return rows}
 if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,compact(x)]));return v
}
function hasEvaluatorMetadata(v:unknown):boolean{
 if(Array.isArray(v))return v.some(hasEvaluatorMetadata);if(v&&typeof v==='object')return Object.entries(v).some(([k,x])=>/expected|answer.?key|gold|expert.?score|deterministic.?score/i.test(k)||hasEvaluatorMetadata(x));return false
}
export function prepareAB(fixtures:ABFixture[],model:string,options:{routeAware?:boolean;caseIds?:readonly string[];inputTokenLimit?:number;outputTokenLimit?:number;protocolVersion?:'v3'|'legacy-v2'}={}){
 if(!model||!Array.isArray(fixtures)||new Set(fixtures.map(f=>f.caseId)).size!==fixtures.length)throw Error('INVALID_AB_INPUT')
 const inputTokenLimit=options.inputTokenLimit===undefined?8000:options.inputTokenLimit,outputTokenLimit=options.outputTokenLimit===undefined?900:options.outputTokenLimit
 if(!Number.isSafeInteger(inputTokenLimit)||inputTokenLimit<=0)throw Error('INVALID_AB_INPUT_TOKEN_LIMIT')
 if(!Number.isSafeInteger(outputTokenLimit)||outputTokenLimit<=0)throw Error('INVALID_AB_OUTPUT_TOKEN_LIMIT')
 const catalog=JSON.parse(readFileSync(new URL('./cases-60.json',import.meta.url),'utf8'))
 if(options.protocolVersion==='legacy-v2'){
  const captured=JSON.parse(readFileSync(new URL('./replay-fixtures/20261023/frozen-preparation-v2.json',import.meta.url),'utf8'))
  const requests=captured.requests.filter((r:any)=>!options.caseIds||options.caseIds.includes(r.caseId)).map((r:any)=>{
   const out=structuredClone(r);out.maxOutputTokens=outputTokenLimit;out.generation.max_tokens=outputTokenLimit;out.providerRequest.max_tokens=outputTokenLimit;return out
  })
  if(model!==captured.model)throw Error('ARCHIVED_PROTOCOL_MODEL_IMMUTABLE')
  return {...captured,requests,plannedCalls:requests.length,protocolVersion:'LEGACY_CAPTURED_V2',actualApiCalls:0,actualProviderTokens:0}
 }
 const requests:any[]=[],blocked:{caseId:string;reason:string;inputUpperBounds?:number[]}[]=[],localOnly:string[]=[]
 for(const c of catalog.cases){
  if(options.caseIds&&!options.caseIds.includes(c.id)){localOnly.push(c.id);continue}
  if(!options.caseIds&&options.routeAware&&c.optimizedRoute==='LOCAL'){localOnly.push(c.id);continue}
  const f=fixtures.find(f=>f.caseId===c.id)
  if(!f||f.provenance!=='PUBLIC_SYNTHETIC'||!f.frozenVersion||!f.facts.length){blocked.push({caseId:c.id,reason:'NO_FROZEN_SYNTHETIC_FACT_BINDING'});continue}
  if(hasEvaluatorMetadata(f.coachContext)){blocked.push({caseId:c.id,reason:'EVALUATOR_METADATA_IN_CONTEXT'});continue}
  const question=c.id==='C04'?c.prompt+' 日期口径更正v3：课次日为2026-10-18，分析asOf为2026-10-19，比赛日为2026-10-26；分别报告从课次日与分析日计算的剩余天数，不将二者混同。':c.prompt
  const s=projectAnalysisEvidence({context:f.context,facts:f.facts,priorHypotheses:f.priorHypotheses}),a=evaluateRecoveryEvidence(s),e=buildMuscleExposure(s),packet=buildCoachAnalysisPacket(s,a,e,{question,competitionDate:typeof f.coachContext?.competitionDate==='string'?f.coachContext.competitionDate:null})
  // Shared security/asOf projection is mandatory in both arms. B additionally
  // receives deterministic host computations; neither arm receives answer keys.
  const commonFacts=commonSource(f,s,packet),coverageHash=hash(commonFacts),sourceAliases:Record<string,string>={}
  for(const entry of commonFacts.facts){const raw=f.facts.find(x=>x.id===commonFacts.referenceOrder[Number(String(entry.source[0]).slice(1))-1]&&x.revision===entry.source[1]);if(raw){sourceAliases[sourceScope(raw)]=entry.scopeId;if(raw.protocolKey)sourceAliases[raw.protocolKey]=String(entry.source[3])}}
  const view=analysisModelView(packet,commonFacts.referenceOrder,sourceAliases).compactView,sourceText=neutralFacts(commonFacts)
  // Both arms already have the same complete neutral facts. Do not send B a
  // second raw journal or repeat fixed candidate templates and raw quotations.
  const v=view as any,processing={derivedFormulaVersion:'FK_DERIVED_1',calendarContext:v.calendarContext,derivedFacts:v.derivedFacts,requirements:v.requirements,hypotheses:v.hypotheses,safetyState:v.safetyState,safetyConstraints:v.safetyConstraints,missing:v.missing,allowedCandidates:v.candidates?.map((x:any)=>({id:x.id,action:x.action,basisRefs:x.basisRefs}))}
  const requiredDerived=new Set(packet.requirements?.requiredDerivedFactIds??[]),compactDerived=v.derivedFacts?.filter((d:any)=>!requiredDerived.size||v.requirements?.requiredDerivedFactIds?.includes(d.id))
  if(compactDerived?.length)processing.derivedFacts=compactDerived
  const generation={model,temperature:0.4,max_tokens:outputTokenLimit,thinking:{type:'disabled'},stream:false,response_format:{type:'json_object'},toolRounds:0,retries:0}
  const prepared=['A','B'].map(arm=>{
   const context=arm==='A'?sourceText:sourceText+'\n方坤程序核验事实（数值由程序生成；解释不可改写为新测量或因果）：\n'+JSON.stringify(compact(processing))
   const messages=[{role:'system',content:system+' 已提供的派生值以程序事实为准；缺少上下文不能表述成用户未记录。'},{role:'user',content:JSON.stringify({question,context})}]
   const inputTokenUpperBound=estimateInputTokenUpperBound(messages)+256
   return {model,maxOutputTokens:outputTokenLimit,toolRounds:0,retries:0,caseId:c.id,fixtureVersion:f.frozenVersion,snapshotId:s.snapshotId,coverageHash,commonFacts,sourceText,generation,arm,
    status:'PREPARED_NOT_EXECUTED',requiresCostApproval:true,modelApproved:false,transportReady:false,
    protocolVersion:'FK_FACT_PACKET_3',request:{question,context},providerRequest:{model,temperature:0.4,max_tokens:outputTokenLimit,thinking:{type:'disabled'},stream:false,response_format:{type:'json_object'},messages},
    inputUtf8Bytes:new TextEncoder().encode(context).length,inputTokenUpperBound,inputTokens:null,outputTokens:null,latencyMs:null,actualCost:null}
  })
  if(prepared.some(x=>x.inputTokenUpperBound>inputTokenLimit)){blocked.push({caseId:c.id,reason:`PAIRED_CONTEXT_CAP_${inputTokenLimit}_NO_TRIMMING`,inputUpperBounds:prepared.map(x=>x.inputTokenUpperBound)});continue}
  requests.push(...prepared)
 }
 return {schemaVersion:3,protocolVersion:'FK_FACT_PACKET_3',status:'NOT_RUN',actualApiCalls:0,actualProviderTokens:0,model,requests,blocked,localOnly,plannedCalls:requests.length,maximumCatalogCalls:120,
  comparability:'Same source coverage, question, model and generation settings; B adds existing deterministic processing. Security/asOf projection is shared. Public development set; no scientific validation.'}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href&&process.argv.includes('--prepare')){
 const path=process.argv[process.argv.indexOf('--prepare')+1],out=process.argv[process.argv.indexOf('--output')+1],model=process.argv[process.argv.indexOf('--model')+1]
 if(!path||!out||!model)throw Error('Usage: --prepare fixtures.json --model selected-model --output output-directory')
 const result=prepareAB(JSON.parse(readFileSync(path,'utf8')),model);mkdirSync(out,{recursive:true});writeFileSync(out+'/requests.json',JSON.stringify(result,null,2))
}
