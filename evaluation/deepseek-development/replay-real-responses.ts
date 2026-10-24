/** Captured-response inspection only. No evaluation service, API, budget DB or ledger import. */
import './no-network.mjs'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { join, resolve } from 'node:path'
import type { CoachAnalysisPacket, CoachAnalysisReply } from '../../src/lib/health/analysis-contract'
import { projectAnalysisEvidence } from '../../src/lib/health/analysis-evidence'
import { evaluateRecoveryEvidence } from '../../src/lib/health/recovery-assessment'
import { buildMuscleExposure } from '../../src/lib/health/muscle-exposure'
import { analysisModelView, buildCoachAnalysisPacket, validateCoachAnalysisReply } from '../../src/lib/health/analysis-packet'
import { auditAnalysisContent } from '../../src/lib/health/analysis-reply-validation'
import { modelFixtures } from './model-fixtures'

type Fixture = ReturnType<typeof modelFixtures>[number]
type SavedRequest = {sampleId:string;request:{commonFacts:{referenceOrder:string[];facts:{source:unknown[];scopeId:string}[]};providerRequest:{max_tokens:number;messages:{role:string;content:string}[]};maxOutputTokens:number;sourceText:string;generation:unknown}}
type SavedReceipt = {sampleId:string;caseId:string;arm:string;phase:string;rawAnswer:string;providerResponse:{choices:{message:{content:string};finish_reason:string}[];usage:{completion_tokens:number}}}
type GroundTruthEvent = {id:string;sampleId:string;kind:string;metric?:string;sourceId?:string;actual?:number;expected?:number;unit?:string;evidence:string;reason?:string}
type Control = {id:string;sampleId:string;evidence?:string;reason:string}
type DiagnosticFalsePositive = {check:string;path:string;id?:string;metric?:string;actual?:number;reason:string;reviewer?:string}
type GroundTruth = {version:string;frozenAt:string;reason:string;artifacts:Record<string,string>;denominatorPolicy:string;criticalEvents:GroundTruthEvent[];negativeControls:Control[];inputVersionDefects:{caseId:string;arm:string;reason:string}[];semanticReviewLimits:string[]}
const artifactRoot = new URL('./replay-fixtures/20261023/', import.meta.url)
const groundTruthUrl = new URL('./replay-ground-truth.json', import.meta.url)
const sha256 = (value:string|Buffer) => createHash('sha256').update(value).digest('hex')
const readJson = <T>(url:URL):T => JSON.parse(readFileSync(url, 'utf8')) as T

export function parseSavedAnswer(raw:string):{ok:true;value:Record<string,unknown>}|{ok:false;error:string;jsonKind:string} {
 try {
  const value:unknown = JSON.parse(raw)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {ok:false,error:'TOP_LEVEL_JSON_OBJECT_REQUIRED',jsonKind:value===null?'null':Array.isArray(value)?'array':typeof value}
  return {ok:true,value:value as Record<string,unknown>}
 } catch (error) { return {ok:false,error:error instanceof Error?error.message:String(error),jsonKind:'INVALID_JSON'} }
}

export function buildReplayPacket(fixture:Fixture, question:string):CoachAnalysisPacket {
 const snapshot=projectAnalysisEvidence({context:fixture.context,facts:fixture.facts,priorHypotheses:fixture.priorHypotheses})
 return buildCoachAnalysisPacket(snapshot,evaluateRecoveryEvidence(snapshot),buildMuscleExposure(snapshot),{question,competitionDate:typeof fixture.coachContext?.competitionDate==='string'?fixture.coachContext.competitionDate:null})
}

/** Synthetic host-authored positive control. It is never presented as a model answer. */
export function canonicalControlReply(packet:CoachAnalysisPacket):CoachAnalysisReply {
 const rows=[...packet.assessment.observations,...(packet.derivedFacts??[]).filter(d=>d.evidenceRefs.length).map(d=>({text:d.text,evidenceRefs:d.evidenceRefs}))]
 const claims=[...new Map(rows.map(row=>[row.text,{text:row.text,refs:row.evidenceRefs}])).values()].filter(row=>row.refs.length)
 return {answer:claims.map(c=>c.text).join('\n'),factualClaims:claims,selectedCandidateId:null,hypotheses:[],unknowns:[],followup:null,memoryClaim:'NOT_SAVED',derivedFactIds:(packet.derivedFacts??[]).map(d=>d.id)}
}

function actualQuestion(request:SavedRequest):string {
 for (const message of request.request.providerRequest.messages) {
  if(message.role!=='user')continue
  const parsed=parseSavedAnswer(message.content)
  if(parsed.ok&&typeof parsed.value.question==='string')return parsed.value.question
 }
 throw Error(`CAPTURED_QUESTION_MISSING:${request.sampleId}`)
}

function replaySample(receipt:SavedReceipt, request:SavedRequest, fixture:Fixture) {
 const question=actualQuestion(request),packet=buildReplayPacket(fixture,question),parsed=parseSavedAnswer(receipt.rawAnswer)
 const factAliases=Object.fromEntries(request.request.commonFacts.referenceOrder.map((id,i)=>[`F${i+1}`,id]))
 const promptText=request.request.providerRequest.messages.map(m=>m.content).join('\n')
 // Keep legacy strings untouched. F aliases are resolved against the ACTUAL old
 // reference order, which differs from the canonical snapshot's id sort.
 const content=auditAnalysisContent(receipt.rawAnswer,packet,{legacy:true,sourceAliases:factAliases})
 const canonicalAliasRestore=analysisModelView(packet,request.request.commonFacts.referenceOrder)
 const restoredReferenceProbe=canonicalAliasRestore.restore({factualClaims:Object.keys(factAliases).map(id=>({text:'',refs:[{id,revision:1}]}))})
 const schema=parsed.ok?validateCoachAnalysisReply(parsed.value as unknown as CoachAnalysisReply,packet):{status:'REJECTED' as const,errors:['SAVED_REPLY_PARSE_FAILED'],reviewedClaims:[],professionalCorrectness:'NOT_PROVEN' as const}
 const suppliedButExcludedAliases=Object.entries(factAliases).filter(([,id])=>!packet.permittedFacts.some(f=>f.id===id)).map(([alias,id])=>({alias,id,sourceRow:request.request.commonFacts.facts.find(f=>f.source[0]===alias)??null}))
 const aliasFalsePositives=content.diagnostics.sourceAliasMismatches.filter(d=>suppliedButExcludedAliases.some(a=>a.alias===d.id))
 return {
  sampleId:receipt.sampleId,caseId:receipt.caseId,arm:receipt.arm,phase:receipt.phase,question,
  rawAnswer:receipt.rawAnswer,rawAnswerSha256:sha256(receipt.rawAnswer),rawAnswerMatchesProviderMessage:receipt.rawAnswer===receipt.providerResponse.choices[0]?.message.content,
  provider:{maxOutputTokens:request.request.providerRequest.max_tokens,finishReason:receipt.providerResponse.choices[0]?.finish_reason,completionTokens:receipt.providerResponse.usage.completion_tokens},
  transportTruncated:receipt.providerResponse.choices[0]?.finish_reason==='length',parse:parsed.ok?{ok:true,jsonKind:'object'}:{ok:false,error:parsed.error,jsonKind:parsed.jsonKind},
  schema,content,realNumericError:{status:'REQUIRES_EVENT_MATCH',findings:content.diagnostics.numericContradictions},
  omissions:content.diagnostics.omittedRequiredDerivedFactIds.map(id=>{const d=packet.derivedFacts?.find(x=>x.id===id);return {id,metric:d?.metric,value:d?.value,unit:d?.unit}}),
  falseMissing:content.errors.includes('PRESENT_DATA_CLAIMED_MISSING'),
  suppliedAliasProvenance:{factAliases,sourceScopes:request.request.commonFacts.facts.map(f=>({alias:f.source[0],scopeId:f.scopeId})),oldAliasS6WasSupplied:promptText.includes('MANUAL / S6'),suppliedButExcludedAliases,canonicalRestoredRefs:restoredReferenceProbe.factualClaims?.map(c=>c.refs[0])??[]},
  knownDiagnosticFalsePositives:aliasFalsePositives.map(d=>({check:'SOURCE_ALIAS_MISMATCH',...d,reason:'Alias exists in actual old commonFacts but its NOT_RECORDED fact is excluded from current confirmed-value projection. It is not invented by the model.'})) as DiagnosticFalsePositive[],
  packet:{snapshotId:packet.snapshotId,context:packet.context,permittedFactRefs:packet.permittedFacts.map(f=>({id:f.id,revision:f.revision})),derivedFacts:packet.derivedFacts??[],requirements:packet.requirements,writeAuthority:packet.writeAuthority,safetyState:packet.assessment.safetyState},
  semanticReviewLimits:['Legacy diagnostic only; saved answer was not corrected.','Schema rejection is not evidence of numeric or semantic error detection.','Supplemental numeric flags outside frozen events remain unadjudicated.','No professional correctness, nutrition adequacy, causation or individualized training capability is proven.'],
 }
}
type ReplaySample = ReturnType<typeof replaySample>
type DetectionEvidence = {kind:string;details:unknown}
/** Supplemental review of legacy parser bindings, outside the frozen error denominator. */
function annotateNumericFindings(row:ReplaySample,events:GroundTruthEvent[]) {
 const numericEvents=events.filter(e=>e.sampleId===row.sampleId&&e.kind==='NUMERIC_CONTRADICTION')
 const confirmed=row.content.diagnostics.numericContradictions.filter(d=>numericEvents.some(e=>d.metric===e.metric&&d.actual===e.actual&&d.expected.includes(e.expected!)&&d.refs.some(r=>r.id===e.sourceId)))
 const reasons=(d:ReplaySample['content']['diagnostics']['numericContradictions'][number]):string|null=>{
  const key=row.caseId+row.arm,actual=d.actual
  if(key==='A03B'&&row.provider.maxOutputTokens===900&&actual===400)return '400 m is the correct running distance, bound incorrectly to work seconds; malformed transport is a separate real event.'
  if(['C03B','C04B','C07B'].includes(key)&&actual===4000)return '4000 m/米 is the correct distance; legacy parser bound distance to work seconds.'
  if(['C04B','E04B'].includes(key)&&actual===120)return '120 s/秒 explicitly labels interval rest, not pure running total.'
  if(key==='D01B'&&actual===600)return '600 m is the confirmed three-by-200 m distance; 93 s is the distinct correct work time.'
  if(key==='D04A'&&actual===48&&d.unit==='ms')return '48 ms explicitly labels current RMSSD; legacy parser bound it to RHR.'
  if(key==='E01A'&&[42,39,36,30].includes(actual))return 'This is a raw segment duration, not a range. Actual inputs explicitly support it; ranges are separately 12/9/6/1 s.'
  if(key==='E01B'&&[9,6,1].includes(actual))return 'This is a correct course range; parser inherited a work-time label or lost intermediate F2/F3 in F1→F4 notation.'
  if(key==='E01B'&&[138,132].includes(actual))return 'Correct intermediate-course total: F2=138 s or F3=132 s. Endpoint-only F1→F4 reference parsing lost intermediate sources.'
  return null
 }
 const numericFalsePositives:DiagnosticFalsePositive[]=row.content.diagnostics.numericContradictions.flatMap(d=>{
  const reason=reasons(d)
  return reason?[{check:'NUMBER_CONTRADICTION',path:d.path,metric:d.metric,actual:d.actual,reason,reviewer:'Independent artifact checker /root/derived_facts; actual old request/source fields reviewed'}]:[]
 })
 const missingReason=row.sampleId==='44eccf2f-16d2-440e-bdfa-e0d0c50ebbdf'?'Raw missing[9] names only 2026-10-15 through 10-17 RHR/RMSSD. Those dates are genuinely absent; supplied baselines are 10-10 through 10-14 and current is 10-18.':row.sampleId==='8d6c8bca-2e64-4d8b-81e6-0608ef0fc48c'?'Raw missing[5] says actual training type was not recorded. All four actual source rows have observedType=null; recorded training existence is a different field.':null
 const missingFalsePositives:DiagnosticFalsePositive[]=row.falseMissing&&missingReason?[{check:'PRESENT_DATA_CLAIMED_MISSING',path:row.caseId==='D04'?'$.missing[9]':'$.missing[5]',reason:missingReason,reviewer:'Independent artifact checker /root/derived_facts; exact receipt and actual provider input reviewed'}]:[]
 return {...row,realNumericError:{status:confirmed.length?'CONFIRMED_FROZEN_ERROR':'NO_CONFIRMED_FROZEN_NUMERIC_ERROR',eventIds:numericEvents.map(e=>e.id),findings:confirmed},
  knownDiagnosticFalsePositives:[...row.knownDiagnosticFalsePositives,...numericFalsePositives,...missingFalsePositives],
  falseMissingReview:{diagnosticFlag:row.falseMissing,status:!row.falseMissing||missingReason?'NO_CONFIRMED_FALSE_MISSING':'NEEDS_SEMANTIC_REVIEW',reason:missingReason},
  unresolvedNumericFindings:row.content.diagnostics.numericContradictions.filter(d=>!confirmed.includes(d)&&!reasons(d)),
 }
}
function gradeEvent(event:GroundTruthEvent, row:ReplaySample) {
 let evidence:DetectionEvidence|null=null
 if(event.kind==='NUMERIC_CONTRADICTION') {
  const hits=row.content.diagnostics.numericContradictions.filter(d=>d.metric===event.metric&&d.actual===event.actual&&d.expected.includes(event.expected!)&&(!event.sourceId||d.refs.some(r=>r.id===event.sourceId)))
  if(hits.length)evidence={kind:'NUMERIC_CONTRADICTION',details:hits}
 } else if(event.kind==='DERIVED_OMISSION') {
  const hits=row.omissions.filter(d=>d.metric===event.metric&&Math.abs((d.value??Infinity)-event.expected!)<1e-8)
  if(hits.length)evidence={kind:'REQUIRED_DERIVED_FACT_OMITTED',details:hits}
 } else if(event.kind==='TRANSPORT_TRUNCATION'&&row.transportTruncated&&!row.parse.ok&&row.provider.maxOutputTokens===900) {
  evidence={kind:'TRANSPORT_AND_PARSE_FAILURE',details:row.provider}
 }
 // No calorie-adequacy semantics checker exists. A generic 2000 unsupported
 // token or schema rejection must never be relabelled as catching that inference.
 return {...event,result:evidence?'DETECTED' as const:'MISSED' as const,detectionEvidence:evidence,missReason:evidence?null:event.kind==='SEMANTIC_UNSUPPORTED_RULE_OUT'?'NO_SPECIFIC_DETERMINISTIC_SEMANTIC_CHECK':'NO_MATCHING_METRIC_SPECIFIC_DIAGNOSTIC'}
}

function gradeControl(control:Control,row:ReplaySample) {
 let pass=false
 if(control.id==='D01B_SUPPLIED_OLD_ALIAS')pass=row.suppliedAliasProvenance.oldAliasS6WasSupplied&&row.rawAnswer.includes('MANUAL / S6')
 if(control.id==='D04A_RHR_CHANGE_PRESENT')pass=row.rawAnswer.includes('+10 bpm')&&!row.omissions.some(o=>o.metric==='RHR_CHANGE_BPM')
 if(control.id.startsWith('F03'))pass=['HOLD_ACTIVE','ESCALATION_REQUIRED'].includes(row.packet.safetyState)&&!row.content.errors.includes('WRITE_CLEARANCE_SAFETY_OR_CAUSAL_CLAIM')
 if(control.id.startsWith('E06'))pass=row.packet.permittedFactRefs.every(f=>f.id==='known-v1')&&!row.rawAnswer.includes('26 s')&&!row.rawAnswer.includes('31 s')
 return {...control,result:pass?'PASS' as const:'FALSE_POSITIVE_OR_CONTROL_FAILURE' as const,diagnosticErrors:row.content.errors,knownFalsePositives:row.knownDiagnosticFalsePositives}
}

function syntheticControls() {
 const fixture=modelFixtures().find(f=>f.caseId==='A03')!
 return [1,0].map(revision=>{
  const f=structuredClone(fixture);f.facts=f.facts.map(row=>({...row,revision}))
  const packet=buildReplayPacket(f,'同一节混合训练有跑步与深蹲，复盘力量负重与跑步各自实际完成，总量与同次计数。'),reply=canonicalControlReply(packet)
  const baseline=validateCoachAnalysisReply(reply,packet),claimIndex=reply.factualClaims.findIndex(c=>c.text.includes('320 kg·reps'))
  if(claimIndex<0)throw Error('SYNTHETIC_VOLUME_CONTROL_MISSING')
  const mutate=(replacement:string)=>{
   const changed=structuredClone(reply),old=changed.factualClaims[claimIndex].text
   changed.factualClaims[claimIndex].text=old.replace('320 kg·reps',replacement)
   changed.answer=changed.answer.replace(old,changed.factualClaims[claimIndex].text)
   return validateCoachAnalysisReply(changed,packet)
  }
  const stale=structuredClone(reply);stale.factualClaims[0].refs[0].revision+=1
  return {revision,provenance:'SYNTHETIC_HOST_CANONICAL_CONTROL_NOT_MODEL_REPLY',correct:baseline,numberMutation:mutate('321 kg·reps'),unitRelabel:mutate('320 kg'),staleSource:validateCoachAnalysisReply(stale,packet)}
 })
}

function practicalExamples(rows:ReplaySample[]) {
 const specs=[
  {caseId:'E01',arm:'B',label:'历史纯跑总用时',before:'F1…纯跑用时 154 s',metrics:['RUN_WORK_SECONDS','RUN_SEGMENT_RANGE_SECONDS','RUN_SEGMENT_MEAN_SECONDS'],sourceId:'s3',explanation:'30+34+38+42=144 s；极差12 s，均值36 s。旧154 s原样保留，诊断给出144 s。'},
  {caseId:'D04',arm:'B',label:'RMSSD基线变化',before:'基线与当前原始数值存在，百分比、对数变化与明确样本数摘要缺失。',metrics:['RMSSD_CURRENT_MS','RMSSD_BASELINE_MEDIAN_MS','RMSSD_CHANGE_PERCENT','RMSSD_LOG_RATIO','RMSSD_BASELINE_SAMPLES'],explanation:'同账号、设备、协议五个有效日：中位数60 ms，当前48 ms，变化-20%，ln(48/60)=-0.2231435513，n=5。'},
  {caseId:'D04',arm:'B',label:'RHR绝对变化',before:'旧B有50/60 bpm原始行，未给出+10 bpm摘要；旧A已经给出+10 bpm。',metrics:['RHR_BASELINE_BPM','RHR_CURRENT_BPM','RHR_CHANGE_BPM','RHR_BASELINE_SAMPLES'],explanation:'基线50 bpm、当前60 bpm，绝对变化+10 bpm；各来源分别报告，避免套用HRV百分比阈值。'},
  {caseId:'A03',arm:'B',label:'混合训练实际总量',before:'旧900与8192样本均无320 kg·reps外部负重次数积。',metrics:['RUN_DISTANCE_M','RUN_WORK_SECONDS','STRENGTH_SETS','STRENGTH_REPS','STRENGTH_EXTERNAL_VOLUME_KG_REPS','OCCURRENCE_COUNT'],explanation:'跑步400 m、纯跑61 s；深蹲2组16次、20×8×2=320 kg·reps；两个组件共享1个occurrence。'},
  {caseId:'C04',arm:'B',label:'比赛日期锚点',before:'旧题写赛前7天，训练日与分析日相差一天。',metrics:['DAYS_TO_COMPETITION_FROM_ASOF','DAYS_TO_COMPETITION_FROM_TRAINING'],explanation:'10月26日距10月19日分析日7天，距10月18日训练日8天；这是输入版本缺陷，不记模型胜负。'},
 ]
 return specs.map(spec=>{
  const row=rows.find(r=>r.caseId===spec.caseId&&r.arm===spec.arm&&r.provider.maxOutputTokens===8192)!
  return {...spec,sampleId:row.sampleId,oldRawAnswerSha256:row.rawAnswerSha256,oldRawAnswer:row.rawAnswer,newDeterministicFacts:row.packet.derivedFacts.filter(d=>spec.metrics.includes(d.metric)&&(!('sourceId' in spec)||d.evidenceRefs.some(r=>r.id===spec.sourceId))),provenance:'OLD_RAW_MODEL_REPLY_VS_NEW_HOST_ARITHMETIC_NO_NEW_MODEL_ANSWER'}
 })
}

export function buildOfflineReplay() {
 const groundTruth=readJson<GroundTruth>(groundTruthUrl),manifest=readJson<{files:Record<string,string>}>(new URL('manifest.json',artifactRoot))
 const artifactIntegrity=Object.entries(groundTruth.artifacts).map(([file,expected])=>{
  const actual=sha256(readFileSync(new URL(file,artifactRoot)))
  if(actual!==expected||manifest.files[file]!==expected)throw Error(`FROZEN_ARTIFACT_HASH_MISMATCH:${file}`)
  return {file,sha256:actual,manifestMatched:true}
 })
 const receipts=readJson<SavedReceipt[]>(new URL('provider-receipts-26.json',artifactRoot)),requests=readJson<SavedRequest[]>(new URL('actual-requests-26.json',artifactRoot))
 if(receipts.length!==26||requests.length!==26||new Set(receipts.map(r=>r.sampleId)).size!==26)throw Error('CAPTURED_26_SAMPLE_INTEGRITY_FAILED')
 const fixtures=modelFixtures(),samples=receipts.map(receipt=>{
  const request=requests.find(r=>r.sampleId===receipt.sampleId),fixture=fixtures.find(f=>f.caseId===receipt.caseId)
  if(!request||!fixture)throw Error(`CAPTURED_BINDING_MISSING:${receipt.sampleId}`)
  return annotateNumericFindings(replaySample(receipt,request,fixture),groundTruth.criticalEvents)
 })
 const criticalEvents=groundTruth.criticalEvents.map(event=>{
  const row=samples.find(s=>s.sampleId===event.sampleId);if(!row)throw Error(`GROUND_TRUTH_SAMPLE_MISSING:${event.id}`)
  return gradeEvent(event,row)
 }),negativeControls=groundTruth.negativeControls.map(control=>gradeControl(control,samples.find(s=>s.sampleId===control.sampleId)!))
 const detected=criticalEvents.filter(e=>e.result==='DETECTED').length
 return {
  schemaVersion:'FK_OFFLINE_REAL_RESPONSE_REPLAY_1',generatedAt:new Date().toISOString(),execution:{mode:'OFFLINE_SAVED_ARTIFACTS_ONLY',networkGuard:'no-network.mjs loaded; fetch/http/https/net/tls outbound disabled',newModelCalls:0,budgetLedgerOpened:false,budgetLedgerReset:false,operatorInstantiated:false,providerClientInstantiated:false},
  groundTruth:{...groundTruth,sha256:sha256(readFileSync(groundTruthUrl)),artifactIntegrity},
  diagnosticPrecisionReview:{policy:'Supplemental posthoc adjudication of the old numeric-contradiction list; distinct denominator from the preregistered 14 error events. No model judge.',beforePrecisionFix:{snapshotFile:'legacy-diagnostics-before-precision-fix.json',sha256:'42a98119cfc80546285555284b880febbbd44c5c5d39a3db24d137e117978a62',numericFindingDenominator:23,trueClaimOccurrences:3,falsePositives:20,underlyingNumericErrorEvents:1,reviewer:'Independent artifact checker /root/derived_facts reviewed actual source fields and raw answers'},current:{numericFindingDenominator:samples.reduce((n,s)=>n+s.content.diagnostics.numericContradictions.length,0),trueClaimOccurrences:samples.reduce((n,s)=>n+s.realNumericError.findings.length,0),knownRepeatedTrueOccurrencesNotFlagged:Math.max(0,3-samples.reduce((n,s)=>n+s.realNumericError.findings.length,0)),falsePositives:samples.reduce((n,s)=>n+s.knownDiagnosticFalsePositives.filter(d=>d.check==='NUMBER_CONTRADICTION').length,0),unadjudicated:samples.reduce((n,s)=>n+s.unresolvedNumericFindings.length,0)}},
  summary:{savedReplies:samples.length,distinctCases:new Set(samples.map(s=>s.caseId)).size,schemaRejected:samples.filter(s=>s.schema.status==='REJECTED').length,parseFailures:samples.filter(s=>!s.parse.ok).length,transportTruncations:samples.filter(s=>s.transportTruncated).length,contentRejected:samples.filter(s=>s.content.status==='REJECTED').length,criticalEventDenominator:criticalEvents.length,criticalEventsDetected:detected,criticalEventsMissed:criticalEvents.length-detected,eventDetectionFraction:`${detected}/${criticalEvents.length}`,negativeControlDenominator:negativeControls.length,negativeControlFailures:negativeControls.filter(c=>c.result!=='PASS').length,knownDiagnosticFalsePositiveFindings:samples.reduce((n,s)=>n+s.knownDiagnosticFalsePositives.length,0),adjudicatedNumericFalsePositives:samples.reduce((n,s)=>n+s.knownDiagnosticFalsePositives.filter(d=>d.check==='NUMBER_CONTRADICTION').length,0),adjudicatedFalseMissingFalsePositives:samples.reduce((n,s)=>n+s.knownDiagnosticFalsePositives.filter(d=>d.check==='PRESENT_DATA_CLAIMED_MISSING').length,0),confirmedNumericClaimOccurrences:samples.reduce((n,s)=>n+s.realNumericError.findings.length,0),unresolvedNumericFindings:samples.reduce((n,s)=>n+s.unresolvedNumericFindings.length,0),professionalCorrectness:'NOT_PROVEN',schemaRejectionIsDetectionMetric:false},
  criticalEvents,negativeControls,inputVersionDefects:groundTruth.inputVersionDefects,syntheticControls:syntheticControls(),examples:practicalExamples(samples),samples,
 }
}

export function renderReplayMarkdown(report:ReturnType<typeof buildOfflineReplay>):string {
 const s=report.summary,lines=[
  '# 冻结真实回复离线回放', '',
  `共回放 ${s.savedReplies} 条已保存回复、${s.distinctCases} 个不同题目；新增模型调用 0，未打开预算数据库或账本。旧回复逐字保留，没有生成“修正后模型答案”。`, '',
  '这些是真实保存的模型回复，输入为 PUBLIC_SYNTHETIC 开发样本，不是实际运动员观测。A03保留原900与扩展8192上限的四条回复，26条回复并非26个独立案例。', '',
  `关键错误按预注册事件计数：检出 **${s.criticalEventsDetected}/${s.criticalEventDenominator}**，漏检 **${s.criticalEventsMissed}**。这是选定错误事件的覆盖率，不是答案正确率、专业能力评分或泛化性能。`, '',
  `旧 schema 拒绝 ${s.schemaRejected}/26；**该数字不作为实质错误检出率**。解析失败 ${s.parseFailures}，原900-token截断 ${s.transportTruncations}。阴性对照 ${s.negativeControlDenominator} 项，失败/误报 ${s.negativeControlFailures} 项。已识别补充诊断误报 ${s.knownDiagnosticFalsePositiveFindings} 处，其中数字绑定误报 ${s.adjudicatedNumericFalsePositives} 处，原诊断完整保留。`, '',
  `已知语义漏检：D05A把接近或达到计划2000 kcal目标当作排除全天能量不足的条件。当前没有对应语义检查；即便触发泛化数字或schema错误，也不记检出。`, '',
  '## 冻结真值与分母', '',`版本：${report.groundTruth.version}；冻结日：${report.groundTruth.frozenAt}；SHA-256：\`${report.groundTruth.sha256}\`。`, '',report.groundTruth.reason,'',report.groundTruth.denominatorPolicy,'',
  '| 错误事件 | 样本 | 结果 | 具体检测依据 |','|---|---|---|---|',
 ]
 for(const e of report.criticalEvents)lines.push(`| ${e.id} | ${e.sampleId.slice(0,8)} | ${e.result==='DETECTED'?'检出':'漏检'} | ${e.detectionEvidence?.kind??e.missReason} |`)
 lines.push('','## 阴性对照、误报与输入缺陷','','| 对照 | 结果 | 原因 |','|---|---|---|')
 for(const c of report.negativeControls)lines.push(`| ${c.id} | ${c.result} | ${c.reason} |`)
 lines.push('','D01旧提示本身提供 MANUAL / S6；不得记作模型编造。旧F1未记录HRV也在实际请求中，因新投影排除空值而产生的来源别名错误属于诊断误报。F03疼痛限制与E06可知时间边界分别核对，不用schema拒绝代替。','')
 lines.push(`首次假缺失诊断的两处标记经独立核验均为误报，当前仍有其中 ${s.adjudicatedFalseMissingFalsePositives} 处：D04A只说10月15—17日的RHR/RMSSD未提供，这些日期确实没有记录；E01B说实际训练类型未记录，四条实际记录的observedType确为null。这两者都没有否认已存在的基线、当前读数或训练事实。`,'')
 lines.push(`补充数字审查：当前数字冲突列表中，确认的真实声明出现 ${s.confirmedNumericClaimOccurrences} 次（E01B同一154→144事件的重复表述），误报 ${s.adjudicatedNumericFalsePositives} 次，未裁定 ${s.unresolvedNumericFindings} 次。首次误报主要来自把4000 m当总秒数、把120 s组休当纯跑总用时、把48 ms RMSSD当RHR、把分段时长当极差，以及F1→F4写法丢失中间F2/F3来源。这一补充分母与冻结14个关键错误事件分开，不作为整体校验器精确率。`,'')
 lines.push('| 补充数字绑定检查 | 原诊断条数 | 真错误声明出现 | 已裁定误报 | 未裁定 |','|---|---|---|---|---|',`| 首次回放（修复前，已保留原报告） | 23 | 3 | 20 | 0 |`,`| 当前回放 | ${report.diagnosticPrecisionReview.current.numericFindingDenominator} | ${s.confirmedNumericClaimOccurrences} | ${s.adjudicatedNumericFalsePositives} | ${s.unresolvedNumericFindings} |`,'',`修复前快照 SHA-256：\`${report.diagnosticPrecisionReview.beforePrecisionFix.sha256}\`。上述3个真声明是同一个E01B154→144事件的三次表述；不扩增关键错误分母。`,'')
 lines.push(`当前有 ${report.diagnosticPrecisionReview.current.knownRepeatedTrueOccurrencesNotFlagged} 处已知重复错误表述没有单独触发数字冲突；这说明更保守的绑定检查仍有逐句覆盖限制。该E01B错误事件已由具体事实行检出，事件分母仍计1。`,'')
 for(const d of report.inputVersionDefects)lines.push(`- ${d.caseId}${d.arm}：${d.reason}`)
 lines.push('','## 每条保存回复','','完整原始字符串、SHA、实际旧F别名映射、schema结果、全部数字冲突、必需计算遗漏、假缺失标记与限制见同目录 replay.json。补充数字诊断不在冻结事件内的，仍需人工语义核验；不自动把它们算作真错。','','| 样本 | 题/臂 | 原上限/结束 | 解析 | schema | 数字冲突 | 必需计算遗漏 | 假缺失标记 |','|---|---|---|---|---|---|---|---|')
 for(const row of report.samples)lines.push(`| ${row.sampleId.slice(0,8)} | ${row.caseId}/${row.arm} | ${row.provider.maxOutputTokens}/${row.provider.finishReason} | ${row.parse.ok?'对象':'失败'} | ${row.schema.status} | ${row.content.diagnostics.numericContradictions.length} | ${row.omissions.length} | ${row.falseMissing?row.falseMissingReview.status==='NO_CONFIRMED_FALSE_MISSING'?'误报':'有，需核验':'无'} |`)
 lines.push('','## 旧原文与新确定性事实示例','','以下“之后”是宿主按冻结输入计算的事实，不是新模型输出。完整旧原文和来源在 before-after-examples.json。','')
 for(const e of report.examples){lines.push(`### ${e.caseId}：${e.label}`,'',`旧：${e.before}`,'',`确定性事实：${e.explanation}`,'');for(const d of e.newDeterministicFacts)lines.push(`- ${d.metric} = ${d.value} ${d.unit}；来源 ${d.evidenceRefs.map(r=>`${r.id}@${r.revision}`).join(', ')||'context'}；公式 ${d.formula}`);lines.push('')}
 lines.push('## 正确与变异对照','','合成宿主标准回复在revision 1与0均须通过严格校验；将320改321、kg·reps改kg、来源revision改旧/未知均须拒绝。它们证明结构与来源约束的具体行为，不证明教练或营养专业判断。','')
 for(const c of report.syntheticControls)lines.push(`- revision ${c.revision}：正确=${c.correct.status}；错数=${c.numberMutation.status}；单位重标=${c.unitRelabel.status}；过期来源=${c.staleSource.status}。`)
 lines.push('','## 证据与能力边界','')
 for(const a of report.groundTruth.artifactIntegrity)lines.push(`- ${a.file}：\`${a.sha256}\`（与冻结manifest一致）`)
 lines.push('');for(const limit of report.groundTruth.semanticReviewLimits)lines.push(`- ${limit}`)
 return lines.join('\n')+'\n'
}

function main() {
 const outputIndex=process.argv.indexOf('--output'),output=outputIndex<0?null:process.argv[outputIndex+1]
 if(!output)throw Error('Usage: node --import ./scripts/test-register.mjs evaluation/deepseek-development/replay-real-responses.ts --output /absolute/output/directory')
 const report=buildOfflineReplay(),directory=resolve(output)
 mkdirSync(directory,{recursive:true})
 writeFileSync(join(directory,'replay.json'),JSON.stringify(report,null,2)+'\n')
 writeFileSync(join(directory,'replay-report.zh-CN.md'),renderReplayMarkdown(report))
 writeFileSync(join(directory,'before-after-examples.json'),JSON.stringify(report.examples,null,2)+'\n')
 writeFileSync(join(directory,'diagnostic-precision-review.json'),JSON.stringify(report.diagnosticPrecisionReview,null,2)+'\n')
 writeFileSync(join(directory,'replay-ground-truth.json'),readFileSync(groundTruthUrl))
 writeFileSync(join(directory,'run.log'),JSON.stringify({command:'offline saved-response replay',...report.execution,summary:report.summary,groundTruthSha256:report.groundTruth.sha256},null,2)+'\n')
 process.stdout.write(JSON.stringify({output:directory,summary:report.summary})+'\n')
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main()
