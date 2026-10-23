import type { AnalysisFact, EvidenceInput, EvidenceSnapshot, EvidenceRef, MetricFact } from './analysis-contract'
import { exactInstant } from './unified-facts'
import { shortHash } from './observation'

export const refOf = (f:EvidenceRef):EvidenceRef => ({id:f?.id??'INVALID',revision:f?.revision??0})
export const stableJson = (v:unknown):string => JSON.stringify(v,(_,x)=>x && typeof x==='object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))) : x)
/** Local change token, never an authorization receipt. Server retains its SHA-256 request ledger. */
export const analysisDigest = (v:unknown) => 'analysis:'+shortHash(stableJson(v))
export const sourceScope = (f:AnalysisFact) => stableJson([f.athleteId,f.provider,f.accountRef,f.deviceId,f.protocolKey])
const sourceKey = (f:AnalysisFact) => stableJson([sourceScope(f),f.sourceRecordId,f.kind,f.kind==='METRIC'?f.metric:f.kind==='TRAINING'?f.componentId:f.measure])
const number = (n:unknown) => n===null || typeof n==='number' && Number.isFinite(n) && n>=0
export function validAnalysisFact(f:AnalysisFact):boolean {
 if(!f||!f.id||!f.sourceRecordId||!f.athleteId||!Number.isSafeInteger(f.revision)||f.revision<0||![f.occurredAt,f.knownAt,f.receivedAt].every(exactInstant)||Date.parse(f.knownAt)<Date.parse(f.occurredAt)||Date.parse(f.receivedAt)<Date.parse(f.occurredAt))return false
 if(!['APP','MANUAL','GARMIN','COROS','APPLE','HUAWEI'].includes(f.provider)||!['CONFIRMED','UNVERIFIED','PLANNED','RETRACTED'].includes(f.status))return false
 if(!['AVAILABLE','PARTIAL','MISSING','CONFLICT','STALE','UNSUPPORTED'].includes(f.quality))return false
 if(f.kind==='METRIC')return number(f.value)&&!!f.unit&&[f.windowStart,f.windowEnd].every(x=>x===null||exactInstant(x))&&!(f.windowStart&&f.windowEnd&&Date.parse(f.windowEnd)<Date.parse(f.windowStart))
 if(f.kind==='RESPONSE')return (f.value===null||Number.isFinite(f.value))&&!!f.scale&&Array.isArray(f.relatedTrainingRefs)
 if(f.kind!=='TRAINING'||!exactInstant(f.startedAt)||f.endedAt!==null&&(!exactInstant(f.endedAt)||Date.parse(f.endedAt)<Date.parse(f.startedAt)))return false
 return !!f.canonicalActivityId&&!!f.componentId&&[f.sessionRpe,f.actualDurationSeconds,f.jumpContacts].every(number)&&(f.sessionRpe===null||f.sessionRpe<=10)&&Array.isArray(f.runSegments)&&Array.isArray(f.strengthSets)&&new Set(f.runSegments.map(s=>s.id)).size===f.runSegments.length&&new Set(f.strengthSets.map(s=>s.id)).size===f.strengthSets.length&&
  f.runSegments.every(s=>!!s.id&&[s.distanceM,s.durationSeconds,s.restAfterSeconds,s.rawResolutionSeconds].every(number))&&
  f.strengthSets.every(s=>!!s.id&&[s.loadKg,s.reps,s.holdSeconds,s.setRpe,s.rir,s.eccentricSeconds].every(number))
}
export type ProjectionInput = EvidenceInput & {
 safetyConstraints?: EvidenceSnapshot['safetyConstraints']; gaps?:string[];
 /** Only explicit host confirmations. Timestamp proximity is never a mapping. */
 canonicalSelections?: {canonicalActivityId:string;componentId:string;selectedRef:EvidenceRef;receiptId:string}[];
}
export function projectAnalysisEvidence(input:ProjectionInput):EvidenceSnapshot {
 const {context}=input;if(!context.athleteId||!exactInstant(context.asOf))throw Error('INVALID_ANALYSIS_CONTEXT')
 const now=Date.parse(context.asOf),excluded:EvidenceSnapshot['excluded']=[],conflicts:EvidenceSnapshot['conflicts']=[],gaps=[...(input.gaps??[])],groups=new Map<string,AnalysisFact[]>()
 for(const f of input.facts){
  const reason=f?.athleteId!==context.athleteId?'FOREIGN_ATHLETE':!validAnalysisFact(f)?'INVALID_FACT':Date.parse(f.knownAt)>now||Date.parse(f.receivedAt)>now||Date.parse(f.occurredAt)>now?'NOT_KNOWN_AS_OF':f.status==='PLANNED'?'PLANNED_NOT_ACTUAL':null
  if(reason){excluded.push({ref:refOf(f),reason});continue}
  const k=sourceKey(f);groups.set(k,[...(groups.get(k)??[]),f])
 }
 const facts:AnalysisFact[]=[]
 for(const rows of groups.values()){
  const latest=Math.max(...rows.map(f=>f.revision)),top=rows.filter(f=>f.revision===latest)
  for(const f of rows.filter(f=>f.revision<latest))excluded.push({ref:refOf(f),reason:'SUPERSEDED'})
  const semantic=(f:AnalysisFact)=>stableJson({...f,id:undefined,receivedAt:undefined,knownAt:undefined})
  if(new Set(top.map(semantic)).size>1||top.some(f=>f.quality==='CONFLICT')){conflicts.push({refs:top.map(refOf),reason:'SAME_SOURCE_REVISION_CONFLICT'});continue}
  const f=top.sort((a,b)=>a.receivedAt.localeCompare(b.receivedAt))[top.length-1]
  if(f.status!=='CONFIRMED'){excluded.push({ref:refOf(f),reason:f.status});continue}
  if(['MISSING','STALE','UNSUPPORTED'].includes(f.quality)){gaps.push(`${f.id}: ${f.quality}`);excluded.push({ref:refOf(f),reason:f.quality});continue}
  facts.push(structuredClone(f))
 }
 // Explicit multi-device canonical mapping: retain raw sources in the input journal, count only the selected component.
 const selected:AnalysisFact[]=[]
 for(const f of facts){
  if(f.kind!=='TRAINING'){selected.push(f);continue}
  const peers=facts.filter(x=>x.kind==='TRAINING'&&x.canonicalActivityId===f.canonicalActivityId&&x.componentId===f.componentId&&x.modality===f.modality)
  if(peers.length<2){selected.push(f);continue}
  const choice=input.canonicalSelections?.find(c=>c.canonicalActivityId===f.canonicalActivityId&&c.componentId===f.componentId&&c.receiptId&&peers.some(p=>p.id===c.selectedRef.id&&p.revision===c.selectedRef.revision))
  if(choice){if(choice.selectedRef.id===f.id&&choice.selectedRef.revision===f.revision)selected.push(f);else excluded.push({ref:refOf(f),reason:'CONFIRMED_CANONICAL_ALTERNATE'})}
  else if(!conflicts.some(c=>c.refs.some(x=>x.id===f.id)))conflicts.push({refs:peers.map(refOf),reason:'CANONICAL_SOURCE_SELECTION_REQUIRED'})
 }
 const safetyConstraints=input.safetyConstraints??[]
 const inputDigest=analysisDigest([context,selected.sort((a,b)=>a.id.localeCompare(b.id)),excluded,conflicts,gaps,safetyConstraints])
 return {context:{...context},snapshotId:inputDigest,inputDigest,facts:selected,excluded,gaps:[...new Set(gaps)],conflicts,safetyConstraints}
}
/** Separate same-protocol daily reference; never sum revisions or average devices. */
export function analysisReference(snapshot:EvidenceSnapshot,current:MetricFact){
 if(!current.accountRef||!current.deviceId||!current.protocolKey||/UNKNOWN|UNSPECIFIED/i.test(current.protocolKey))return {sampleCount:0,median:null,deltaPercent:null,asOf:snapshot.context.asOf,unit:current.unit,sourceScope:sourceScope(current)}
 const rows=snapshot.facts.filter((f):f is MetricFact=>f.kind==='METRIC'&&f.metric===current.metric&&sourceScope(f)===sourceScope(current)&&f.unit===current.unit&&f.statistic===current.statistic&&!!f.providerDate&&!!current.providerDate&&f.providerDate<current.providerDate&&f.isFinal===true&&f.value!==null)
 const days=new Map<string,MetricFact[]>();for(const f of rows)days.set(f.providerDate!,[...(days.get(f.providerDate!)??[]),f])
 const values=[...days.values()].filter(xs=>new Set(xs.map(x=>x.value)).size===1).map(xs=>xs[0].value!).sort((a,b)=>a-b)
 const median=values.length?values.length%2?values[(values.length-1)/2]:(values[values.length/2-1]+values[values.length/2])/2:null
 return {sampleCount:values.length,median,deltaPercent:median&&current.value!==null?(current.value-median)/median*100:null,asOf:snapshot.context.asOf,unit:current.unit,sourceScope:sourceScope(current)}
}
