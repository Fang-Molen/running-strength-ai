import type { AnalysisFactRequirements, AnalysisPacketOptions, CoachAnalysisPacket, CoachAnalysisReply, DerivedFact, EvidenceRef, EvidenceSnapshot, MuscleExposureReview, RecoveryAssessment, ReplyValidation } from './analysis-contract'
import { projectAnalysisEvidence, refOf, sourceScope, stableJson } from './analysis-evidence'
import { deriveAnalysisFacts } from './analysis-derived'
import { validateAnalysisReply } from './analysis-reply-validation'

const uniqueRefs=(refs:readonly EvidenceRef[])=>[...new Map(refs.map(r=>[`${r.id}@${r.revision}`,refOf(r)])).values()]
const isHrv=(metric:string)=>/^(?:hrv|(?:ln[_-]?)?rmssd|hrv[_ -]rmssd|rmssd[_ -]ms)$/i.test(metric)
const isRhr=(metric:string)=>/^(?:rhr|resting[_ -]?heart[_ -]?rate|静息心率)$/i.test(metric)
const runQuestion=(q:string)=>/跑|配速|分段|逐段|间歇|节奏|前快后慢|后程|前后|稳定|极差|变异|衰减|时间|用时|秒|split|pace|cv|running/i.test(q)
const strengthQuestion=(q:string)=>/力量|负重|公斤|kg|吨位|容量|深蹲|硬拉|卧推|划船|推举|引体|俯卧撑|组|次数|混合|rir|strength/i.test(q)
const historyQuestion=(q:string)=>/历史|此前|之前|以往|上次|三次|多次|长期|对照|比较|反证|旧假设|history|previous|compare/i.test(q)
const validCalendarDate=(value:string|null|undefined):value is string=>!!value&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(`${value}T00:00:00Z`))&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value

/** Question routing changes priority only; eligible evidence is never removed. */
export function selectRequiredDerivedFactIds(facts:readonly DerivedFact[],question:string):string[] {
 const q=question.trim();if(!q)return []
 return facts.filter(f=>{
  const m=f.metric
  if(/^RMSSD_/.test(m)&&/hrv|rmssd|心率变异|个人基线|同设备.*基线/i.test(q))return true
  if(/^RHR_/.test(m)&&/rhr|静息心率|个人基线|同设备.*基线/i.test(q))return true
  if(/^DAYS_TO_COMPETITION/.test(m)&&/比赛|赛前|备赛|距|天|competition/i.test(q))return true
  if(m==='OCCURRENCE_COUNT'&&/几次|次数|几课|堂|同一节|同一次|同次|混合|共.*训练|occurrence/i.test(q))return true
  if(/^STRENGTH_/.test(m)&&strengthQuestion(q))return true
  if(!/^RUN_/.test(m)||!runQuestion(q)&&!historyQuestion(q))return false
  if(m==='RUN_DISTANCE_M'||m==='RUN_WORK_SECONDS')return true
  if(m==='RUN_PACE_SECONDS_PER_KM'&&/配速|pace/i.test(q))return true
  if(m==='RUN_SEGMENT_MEAN_SECONDS')return /分段.*(?:平均|均值).*(?:用时|时间)|(?:平均|均值).*分段.*(?:用时|时间)|segment.*mean/i.test(q)
  if(/稳定|极差|变异|cv|离散/i.test(q))return /RANGE/.test(m)
  if(/前快后慢|后程|前后|衰减|变慢|下降|首.*末|最后/i.test(q))return /FIRST|LAST|DELTA|CHANGE|PERCENT|SLOW|FADE|DECLINE/.test(m)
  if(/总|完成多少|跑量|距离/i.test(q))return /TOTAL|COUNT|DISTANCE|WORK/.test(m)
  if(/配速|pace/i.test(q))return false
  return /TOTAL|WORK|RANGE|CV|DELTA|CHANGE|PERCENT|COUNT/.test(m)
 }).map(f=>f.id)
}

function factRequirements(s:EvidenceSnapshot,a:RecoveryAssessment,derived:DerivedFact[],options:AnalysisPacketOptions):AnalysisFactRequirements {
 const question=options.question??'',q=question.trim(),fields=new Set<string>(),missing:string[]=[]
 if(validCalendarDate(options.competitionDate))fields.add('CALENDAR.competitionDate')
 for(const f of s.facts){
  fields.add(f.kind)
  if(f.kind==='METRIC'&&f.value!==null){fields.add(f.metric);if(isHrv(f.metric))fields.add('HRV/RMSSD');if(isRhr(f.metric))fields.add('RHR')}
  if(f.kind==='TRAINING'){
   fields.add(`TRAINING.${f.modality}`);fields.add('occurrenceId')
   if(f.runSegments.some(x=>x.completion==='COMPLETED'&&x.durationSeconds!==null))fields.add('RUN.durationSeconds')
   if(f.runSegments.some(x=>x.completion==='COMPLETED'&&x.distanceM!==null))fields.add('RUN.distanceM')
   if(f.strengthSets.some(x=>x.completion==='COMPLETED'))fields.add('STRENGTH.completedSets')
   if(f.sessionRpe!==null)fields.add('sessionRpe')
  }
  if(f.kind==='RESPONSE'&&f.value!==null)fields.add(f.measure)
 }
 const requiredDerivedFactIds=selectRequiredDerivedFactIds(derived,q),requiredDerived=new Set(requiredDerivedFactIds)
 const relevant=s.facts.filter(f=>{
  if(!q)return false
  if(f.kind==='METRIC')return isHrv(f.metric)&&/hrv|rmssd|心率变异|基线/i.test(q)||isRhr(f.metric)&&/rhr|静息心率|基线/i.test(q)||/sleep|睡眠/i.test(f.metric)&&/睡眠|sleep/i.test(q)||/kcal|energy|intake|饮食/i.test(f.metric)&&/热量|能量|饮食|摄入/i.test(q)
  if(f.kind==='TRAINING')return historyQuestion(q)||runQuestion(q)&&f.modality==='RUN'||strengthQuestion(q)&&f.modality==='STRENGTH'||/训练|课程|混合|occurrence/i.test(q)
  return /恢复|疲劳|疼痛|功能|酸痛|反证|解释|假设|recovery|pain/i.test(q)
 })
 const relevantIds=new Set(relevant.map(f=>f.id))
 const counterRefs=q?a.hypotheses.filter(h=>h.supportingRefs.some(r=>relevantIds.has(r.id))||/反证|解释|假设/i.test(q)).flatMap(h=>h.weakeningRefs):[]
 if(q){
  if(/hrv|rmssd|心率变异/i.test(q)&&!fields.has('HRV/RMSSD'))missing.push('HRV/RMSSD未记录')
  if(/rhr|静息心率/i.test(q)&&!fields.has('RHR'))missing.push('静息心率未记录')
  if(/跑|配速|分段|间歇|running|pace/i.test(q)&&!fields.has('TRAINING.RUN'))missing.push('实际跑步明细未记录')
  if(/力量|负重|逐组|strength/i.test(q)&&!fields.has('TRAINING.STRENGTH'))missing.push('实际力量明细未记录')
  if(/睡眠|sleep/i.test(q)&&!s.facts.some(f=>f.kind==='METRIC'&&f.value!==null&&/sleep|睡眠/i.test(f.metric)))missing.push('睡眠未记录')
  if(/比赛.*(?:几|多少|距)|距.*比赛|赛前.*天/i.test(q)&&!options.competitionDate&&!derived.some(d=>/^DAYS_TO_COMPETITION/.test(d.metric)))missing.push('比赛日期未确认')
  const runs=s.facts.filter(f=>f.kind==='TRAINING'&&f.modality==='RUN')
  const incomplete=(field:'distanceM'|'durationSeconds')=>runs.some(f=>f.kind==='TRAINING'&&(!f.runSegments.length||f.runSegments.some(r=>r.completion==='NOT_RECORDED'||r.completion==='COMPLETED'&&r[field]===null)))
  if(/总距离|总跑量|完整.*距离|全部.*距离|总共.*米|跑了多少米|total.*distance/i.test(q)&&incomplete('distanceM'))missing.push('完整总距离未知：已完成或未记录分段缺少距离；保留已知距离小计')
  if(/总用时|总时间|总时长|完整.*(?:用时|时间|时长)|total.*(?:time|duration)/i.test(q)&&incomplete('durationSeconds'))missing.push('完整纯跑总用时未知：已完成或未记录分段缺少用时；保留已知用时小计')
 }
 return {question,requiredFactRefs:uniqueRefs([...relevant.map(refOf),...counterRefs,...(q?s.safetyConstraints.flatMap(c=>c.evidenceRefs):[]),...derived.filter(f=>requiredDerived.has(f.id)).flatMap(f=>f.evidenceRefs)]),requiredDerivedFactIds,availableFields:[...fields].sort(),genuinelyMissing:missing,conflicts:s.conflicts.map(x=>x.reason)}
}

export function buildCoachAnalysisPacket(s:EvidenceSnapshot,a:RecoveryAssessment,e:MuscleExposureReview,options:AnalysisPacketOptions={}):CoachAnalysisPacket {
 if(a.snapshotId!==s.snapshotId||e.snapshotId!==s.snapshotId)throw Error('ANALYSIS_VERSION_MISMATCH')
 // Recheck the boundary when a handoff is reconstructed from persisted parts.
 const projected=projectAnalysisEvidence({context:s.context,facts:s.facts,safetyConstraints:s.safetyConstraints,gaps:s.gaps,priorHypotheses:s.priorHypotheses})
 const scoped={...s,facts:projected.facts,conflicts:[...s.conflicts,...projected.conflicts]},known=new Set(scoped.facts.map(f=>`${f.id}@${f.revision}`))
 const validRef=(r:EvidenceRef)=>known.has(`${r.id}@${r.revision}`),derivedFacts=deriveAnalysisFacts(scoped,options)
 const assessment:RecoveryAssessment={...structuredClone(a),observations:a.observations.filter(o=>o.evidenceRefs.length&&o.evidenceRefs.every(validRef)).map(o=>structuredClone(o)),hypotheses:a.hypotheses.map(h=>({...structuredClone(h),supportingRefs:h.supportingRefs.filter(validRef),weakeningRefs:h.weakeningRefs.filter(validRef)})),candidates:a.candidates.map(c=>({...structuredClone(c),basisRefs:c.basisRefs.filter(validRef)})),missingDecisionInputs:a.missingDecisionInputs.filter(x=>!(/HRV未记录|RMSSD未记录/i.test(x)&&scoped.facts.some(f=>f.kind==='METRIC'&&f.value!==null&&isHrv(f.metric))))}
 for(const d of derivedFacts)if(!assessment.observations.some(o=>o.text===d.text&&stableJson(o.evidenceRefs)===stableJson(d.evidenceRefs)))assessment.observations.push({text:d.text,evidenceRefs:d.evidenceRefs.map(refOf)})
 return {schemaVersion:'FK_ANALYSIS_HANDOFF_1',context:{...s.context},snapshotId:s.snapshotId,inputDigest:s.inputDigest,permittedFacts:scoped.facts,assessment,exposure:e,allowedCandidateIds:assessment.candidates.map(c=>c.id),knowledgeRefs:[],writeAuthority:'NONE',derivedFacts,requirements:factRequirements(scoped,assessment,derivedFacts,options),safetyConstraints:structuredClone(s.safetyConstraints),...(validCalendarDate(options.competitionDate)?{calendarContext:{competitionDate:options.competitionDate,source:'HOST_COMPETITION_DATE' as const,version:s.context.planVersion??null}}:{})}
}

export function validateCoachAnalysisReply(reply:CoachAnalysisReply,p:CoachAnalysisPacket):ReplyValidation {
 return validateAnalysisReply(reply,p)
}

/** Bind a legacy/read-only packet to the actual request before model dispatch. */
export function bindAnalysisPacketQuestion(p:CoachAnalysisPacket,question:string):CoachAnalysisPacket {
 const snapshot:EvidenceSnapshot={context:p.context,snapshotId:p.snapshotId,inputDigest:p.inputDigest,facts:p.permittedFacts,excluded:[],gaps:[],conflicts:(p.requirements?.conflicts??[]).map(reason=>({refs:[],reason})),safetyConstraints:p.safetyConstraints??[]}
 return {...p,requirements:factRequirements(snapshot,p.assessment,p.derivedFacts??[],{question,competitionDate:p.calendarContext?.competitionDate??null})}
}

/** Host checks freshness/confirmation separately from any model text. No write port here. */
export function checkAnalysisCandidate(p:CoachAnalysisPacket,id:string,host:{snapshotId:string;planVersion:string|null;confirmed:boolean;alreadyExecuted:boolean}){
 return {available:p.assessment.candidates.some(c=>c.id===id&&c.executionState!=='OBSERVATION_ONLY')&&p.allowedCandidateIds.includes(id)&&host.snapshotId===p.snapshotId&&!!host.planVersion&&host.planVersion===p.context.planVersion&&host.confirmed&&!host.alreadyExecuted&&p.assessment.safetyState==='NO_KNOWN_HOLD',planChanged:false as const,requiresHostExecution:true as const}
}

/** Keys are sourceScope(f), the same tuple without athlete, or a raw protocol. */
export type AnalysisSourceAliases=Readonly<Record<string,string>>
const escapeRegExp=(x:string)=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')

/** Stable ephemeral namespaces keep the neutral fact source and analysis aligned. */
export function analysisModelView(p:CoachAnalysisPacket,referenceOrder:readonly string[]=p.permittedFacts.slice().sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt)||a.id.localeCompare(b.id)).map(f=>f.id),sourceAliases:AnalysisSourceAliases={}){
 const ordered=p.permittedFacts.slice().sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt)||a.id.localeCompare(b.id))
 const refs=new Map(referenceOrder.map((id,i)=>[id,`F${i+1}`]))
 for(const f of ordered)if(!refs.has(f.id))refs.set(f.id,`F${refs.size+1}`)
 const candidates=new Map(p.allowedCandidateIds.map((id,i)=>[id,`C${i+1}`])),derivedIds=new Map((p.derivedFacts??[]).map((d,i)=>[d.id,`D${i+1}`]))
 const accounts=new Map<string,string>(),devices=new Map<string,string>(),protocols=new Map<string,string>(),scopes=new Map<string,string>(),occurrences=new Map<string,string>()
 const alias=(value:string|null,map:Map<string,string>,prefix:string)=>{if(value===null)return null;if(!map.has(value))map.set(value,`${prefix}${map.size+1}`);return map.get(value)!}
 const sourceByFact=new Map<string,{provider:string;scope:string;protocol:string|null}>()
 for(const f of ordered){
  const account=alias(f.accountRef,accounts,'A'),device=alias(f.deviceId,devices,'D'),protocol=f.protocolKey===null?null:sourceAliases[f.protocolKey]??alias(f.protocolKey,protocols,'P')
  if(f.protocolKey!==null)protocols.set(f.protocolKey,protocol!)
  const tuple=stableJson([f.provider,f.accountRef,f.deviceId,f.protocolKey]),scopeKey=stableJson([f.provider,account,device,protocol])
  if(!scopes.has(scopeKey))scopes.set(scopeKey,sourceAliases[sourceScope(f)]??sourceAliases[tuple]??`S${scopes.size+1}`)
  sourceByFact.set(f.id,{provider:f.provider,scope:scopes.get(scopeKey)!,protocol})
  if(f.kind==='TRAINING')alias(f.occurrenceId,occurrences,'O')
 }
 const aliases=new Map<string,string>([...refs,...candidates,...derivedIds,...accounts,...devices,...protocols,...occurrences])
 aliases.set(p.context.athleteId,'ATHLETE')
 if(p.context.planVersion)aliases.set(p.context.planVersion,'PLAN')
 for(const f of ordered){
  const scope=sourceByFact.get(f.id)!.scope
  aliases.set(sourceScope(f),scope);aliases.set(stableJson([f.provider,f.accountRef,f.deviceId,f.protocolKey]),scope)
  if(!aliases.has(f.sourceRecordId))aliases.set(f.sourceRecordId,refs.get(f.id)!)
  if(f.kind==='TRAINING'&&!aliases.has(f.canonicalActivityId))aliases.set(f.canonicalActivityId,occurrences.get(f.occurrenceId)!)
 }
 const semanticValues=new Set(ordered.flatMap(f=>f.kind==='METRIC'?[f.metric]:f.kind==='RESPONSE'?[f.measure]:[f.modality,f.componentId]))
 const embedded=[...aliases.keys()].filter(k=>k.length>=4&&!semanticValues.has(k)).sort((a,b)=>b.length-a.length)
 const pattern=embedded.length?new RegExp(embedded.map(escapeRegExp).join('|'),'g'):null,originalStrings=new Map<string,string>()
 const identityKeys=new Set(['id','derivedFactIds','requiredDerivedFactIds','selectedCandidateId','athleteId','accountRef','deviceId','sourceRecordId','protocol','protocolKey','canonicalActivityId','providerScopes'])
 const textKeys=new Set(['text','claim','discriminator','question','reason','notes','missing','genuinelyMissing','plannedPurpose','observedType','conditions','supportsWhen','weakensWhen','doNotExecute'])
 const minimize=(value:unknown,key=''):any=>{
  if(key==='source')return value
  if(Array.isArray(value))return value.map(v=>minimize(v,key))
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,minimize(v,k)]))
  if(typeof value!=='string')return value
  const idAlias=key==='id'?refs.get(value)??derivedIds.get(value)??candidates.get(value):key==='derivedFactIds'||key==='requiredDerivedFactIds'?derivedIds.get(value):undefined
  const statusOnly=/^[^:\n]+: (?:MISSING|STALE|UNSUPPORTED|UNKNOWN|FAILED|UNAVAILABLE|NOT_RECORDED|PERMISSION_DENIED|NOT_WORN|NULL)$/.test(value)?value.replace(/^[^:]+:/,'记录状态:'):value
  // Identity aliases apply to identity fields. Units, scales and enums remain
  // semantic values even when a source happened to use the same string as ID.
  const result=identityKeys.has(key)?idAlias??aliases.get(value)??value:textKeys.has(key)?pattern?statusOnly.replace(pattern,x=>aliases.get(x)!):statusOnly:value
  if(result!==value)originalStrings.set(result,value)
  return result
 }
 const observation=(o:RecoveryAssessment['observations'][number])=>{
  let text=o.text
  for(const r of o.evidenceRefs){const f=ordered.find(f=>f.id===r.id&&f.revision===r.revision);if(f?.protocolKey){const source=sourceByFact.get(f.id)!;text=text.replace(`${f.provider} / ${f.protocolKey}`,`${f.provider} / ${source.scope}`)}}
  const minimized=minimize(text,'text');originalStrings.set(minimized,o.text)
  return {text:minimized,evidenceRefs:minimize(o.evidenceRefs)}
 }
 const facts=ordered.map(f=>{
  const common={ref:refOf(f),kind:f.kind,at:f.occurredAt,sourceAsOf:f.knownAt,receivedAt:f.receivedAt,quality:f.quality,source:sourceByFact.get(f.id)!}
  if(f.kind==='METRIC')return {...common,metric:f.metric,value:f.value,unit:f.unit,statistic:f.statistic,day:f.providerDate,temporalResolution:f.temporalResolution??'INSTANT',window:f.windowStart||f.windowEnd?[f.windowStart,f.windowEnd]:null,energyKind:f.energyKind}
  if(f.kind==='RESPONSE')return {...common,measure:f.measure,value:f.value,scale:f.scale,region:f.region,side:f.side,elapsedHours:f.elapsedHours,relatedTrainingRefs:f.relatedTrainingRefs,protocol:f.observationProtocol,functionTaskId:f.functionTaskId,notes:f.notes}
  return {...common,occurrenceId:occurrences.get(f.occurrenceId),componentId:f.componentId,modality:f.modality,plannedPurpose:f.plannedPurpose,observedType:f.observedType,sessionRpe:f.sessionRpe,sessionRpeScale:f.sessionRpeScale,actualDurationSeconds:f.actualDurationSeconds,runSegments:f.runSegments.map(({id,...r})=>r),strengthSets:f.strengthSets.map(({id,...r})=>r),jumpContacts:f.jumpContacts}
 })
 const derivedText=new Set((p.derivedFacts??[]).map(d=>d.text))
 const contextVersion=(kind:'ANALYSIS_AS_OF'|'COMPETITION_DATE',version:string|null)=>version===null?null:kind==='COMPETITION_DATE'&&version===p.context.planVersion?'PLAN':kind==='ANALYSIS_AS_OF'&&version===p.context.analysisVersion?'ANALYSIS':'CONTEXT'
 const view={asOf:p.context.asOf,calendarContext:p.calendarContext?{...p.calendarContext,version:contextVersion('COMPETITION_DATE',p.calendarContext.version)}:undefined,facts:minimize(facts),derivedFacts:minimize((p.derivedFacts??[]).map(d=>({id:d.id,metric:d.metric,value:d.value,unit:d.unit,refs:d.evidenceRefs,...(d.contextSources?.length?{contextSources:d.contextSources.map(c=>({kind:c.kind,value:c.value,version:contextVersion(c.kind,c.version)}))}:{})}))),requirements:minimize(p.requirements??{question:'',requiredFactRefs:[],requiredDerivedFactIds:[],availableFields:[],genuinelyMissing:[],conflicts:[]}),observations:p.assessment.observations.filter(o=>!derivedText.has(o.text)&&!/^原计划目的：/.test(o.text)).map(observation),hypotheses:minimize(p.assessment.hypotheses),candidates:minimize(p.assessment.candidates.map(c=>({id:c.id,kind:c.kind,action:c.action??null,basisRefs:c.basisRefs,reason:c.reason??null}))),safetyState:p.assessment.safetyState,safetyConstraints:minimize(p.safetyConstraints??[]),missing:minimize(p.assessment.missingDecisionInputs)}
 const refReverse=new Map([...refs].map(([a,b])=>[b,a])),derivedReverse=new Map([...derivedIds].map(([a,b])=>[b,a])),candidateReverse=new Map([...candidates].map(([a,b])=>[b,a]))
 const reverse=new Map([...aliases].map(([a,b])=>[b,a]))
 const quotedKeys=[...originalStrings.keys()].filter(k=>k.length>8&&originalStrings.get(k)!==k).sort((a,b)=>b.length-a.length)
 const quotedPattern=quotedKeys.length?new RegExp(quotedKeys.map(escapeRegExp).join('|'),'g'):null
 const hypothesisOriginals=new Map((view.hypotheses as RecoveryAssessment['hypotheses']).map((h,i)=>[stableJson(h),p.assessment.hypotheses[i]]))
 const restore=(value:unknown,key=''):any=>{
  if(Array.isArray(value))return value.map(v=>restore(v,key))
  if(key==='hypotheses'&&value&&typeof value==='object'){
   const original=hypothesisOriginals.get(stableJson(value))
   if(original)return structuredClone(original)
  }
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,restore(v,k)]))
  if(typeof value!=='string')return value
  if(key==='derivedFactIds'||key==='requiredDerivedFactIds')return derivedReverse.get(value)??value
  if(key==='selectedCandidateId')return candidateReverse.get(value)??value
  if(key==='id')return refReverse.get(value)??derivedReverse.get(value)??candidateReverse.get(value)??value
  return originalStrings.get(value)??reverse.get(value)??(quotedPattern?value.replace(quotedPattern,x=>originalStrings.get(x)!):value)
 }
 const requiredIds=new Set(view.requirements.requiredDerivedFactIds),hasQuestion=!!p.requirements?.question.trim()
 // Context origins remain fully auditable locally and in the one shared
 // calendarContext/asOf pair. Do not repeat them on every wire-level number.
 const compactView={...view,derivedFormulaVersion:'FK_DERIVED_1',
  facts:view.facts.map((f:any)=>{const {receivedAt,...rest}=f;return receivedAt===f.sourceAsOf?rest:f}),
  derivedFacts:view.derivedFacts.filter((d:any)=>!hasQuestion||requiredIds.has(d.id)).map((d:any)=>{const {contextSources,...rest}=d;return rest}),
  candidates:hasQuestion&&!/计划|安排|调整|改课|方案|下一|接下来/.test(p.requirements!.question)?[]:view.candidates,
 }
 return {view,compactView,restore:(value:unknown)=>restore(value) as CoachAnalysisReply}
}
