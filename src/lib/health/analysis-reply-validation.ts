import type {CoachAnalysisPacket,CoachAnalysisReply,DerivedFact,EvidenceRef,ReplyValidation} from './analysis-contract'

export interface AnalysisAuditDiagnostics {
 schemaErrors:string[]
 numericContradictions:{path:string;metric:string;actual:number;expected:number[];unit:string|null;refs:EvidenceRef[]}[]
 unsupportedNumbers:{path:string;value:string;context:string}[]
 unitContradictions:{path:string;metric:string;actual:string;expected:string[];refs:EvidenceRef[]}[]
 omittedRequiredDerivedFactIds:string[]
 sourceAliasMismatches:{path:string;id:string}[]
 reviewReasons:string[]
}
export interface AnalysisContentAudit extends ReplyValidation {diagnostics:AnalysisAuditDiagnostics}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const same=(a:unknown,b:unknown):boolean=>{
 if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((x,i)=>same(x,b[i]))
 if(object(a)||object(b))return object(a)&&object(b)&&Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(k=>Object.hasOwn(b,k)&&same(a[k],b[k]))
 return a===b
}
const refKey=(r:EvidenceRef)=>r.id+'@'+r.revision
const refsEqual=(a:EvidenceRef[],b:EvidenceRef[])=>a.length===b.length&&a.map(refKey).sort().join('\n')===b.map(refKey).sort().join('\n')
const reference=(r:unknown):r is EvidenceRef=>object(r)&&Object.keys(r).length===2&&typeof r.id==='string'&&!!r.id&&Number.isSafeInteger(r.revision)&&Number(r.revision)>=0
const refArray=(v:unknown):v is EvidenceRef[]=>Array.isArray(v)&&v.every(reference)
const strings=(v:unknown):v is string[]=>Array.isArray(v)&&v.every(x=>typeof x==='string')
const allowedKeys=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).every(k=>keys.includes(k))
function schemaErrors(v:unknown):string[]{
 if(!object(v))return ['INVALID_REPLY']
 const errors:string[]=[]
 if(!allowedKeys(v,['answer','factualClaims','selectedCandidateId','hypotheses','unknowns','followup','memoryClaim','derivedFactIds']))errors.push('UNEXPECTED_REPLY_FIELD')
 if(typeof v.answer!=='string'||!v.answer.trim()||v.answer.length>12000||!Array.isArray(v.factualClaims)||v.factualClaims.length>200||!strings(v.unknowns)||!Array.isArray(v.hypotheses)||(v.selectedCandidateId!==null&&typeof v.selectedCandidateId!=='string')||(v.followup!==null&&typeof v.followup!=='string')||!['NOT_SAVED','HOST_RECEIPT_REQUIRED'].includes(v.memoryClaim as string)||(v.derivedFactIds!==undefined&&(!strings(v.derivedFactIds)||new Set(v.derivedFactIds).size!==v.derivedFactIds.length)))errors.push('INVALID_REPLY')
 if(Array.isArray(v.factualClaims))for(const c of v.factualClaims)if(!object(c)||!allowedKeys(c,['text','refs'])||typeof c.text!=='string'||!c.text.trim()||!refArray(c.refs)||!c.refs.length)errors.push('INVALID_FACTUAL_CLAIM')
 if(Array.isArray(v.hypotheses))for(const h of v.hypotheses)if(!object(h)||!allowedKeys(h,['id','claim','supportingRefs','weakeningRefs','discriminator','certainty'])||typeof h.id!=='string'||typeof h.claim!=='string'||typeof h.discriminator!=='string'||!refArray(h.supportingRefs)||!refArray(h.weakeningRefs)||!['POSSIBLE','UNRESOLVED'].includes(h.certainty as string))errors.push('INVALID_HYPOTHESIS')
 return [...new Set(errors)]
}
type Leaf={path:string;text:string;holder:Record<string,unknown>|null;refs:EvidenceRef[]}
function leaves(v:unknown,path='$',holder:Record<string,unknown>|null=null,inherited:EvidenceRef[]=[]):Leaf[]{
 if(typeof v==='string'||typeof v==='number')return [{path,text:String(v),holder,refs:inherited}]
 if(Array.isArray(v))return v.flatMap((x,i)=>leaves(x,`${path}[${i}]`,holder,inherited))
 if(!object(v))return []
 const refs=refArray(v.refs)?v.refs:refArray(v.supportingRefs)?v.supportingRefs:inherited
 return Object.entries(v).flatMap(([k,x])=>leaves(x,path+'.'+k,v,refs))
}
const normalizedUnit=(u:string)=>(({秒:'s',米:'m','％':'%',公斤:'kg',千克:'kg',毫秒:'ms'} as Record<string,string>)[u]??u.toLowerCase())
const close=(a:number,b:number)=>Math.abs(a-b)<=Math.max(1e-6,Math.abs(b)*1e-5)
function medicalOrWrite(text:string):boolean{
 const patterns=[/(?:已|已经).{0,6}(?:保存|记入|写入|记住)|(?:课表|计划).{0,5}(?:已|已经).{0,4}(?:更新|调整|变更|修改)|已更新.{0,12}(?:记忆|偏好|课表|计划)|自动.{0,8}(?:改课|修改课表|调整计划)|(?:已经?|现已).{0,6}(?:解除|取消).{0,6}限制|(?:取得|获得|通过|给予|批准).{0,6}医学.{0,3}(?:许可|放行)|(?:已经?|可以|允许).{0,6}(?:医学放行|恢复训练)|组织(?:已经?|完全|确定)恢复|医学.{0,8}(?:已允许|已批准|已放行)/,/(?:无视|忽略|不必理会).{0,8}疼痛|疼痛.{0,8}(?:也可|仍可|照常|继续).{0,6}训练|(?:手表|HRV|恢复分数).{0,16}(?:解除|覆盖).{0,8}(?:限制|疼痛)/,/导致|引起|造成|(?:必然|一定|确定).{0,8}证明|(?:证明|证实).{0,8}(?:因果|已恢复|完全恢复)/, /medically cleared|medical clearance (?:granted|approved)|(?:I|we) (?:have )?(?:saved|updated) (?:your )?(?:memory|plan)|ignore (?:the )?pain|definitely (?:causes|caused|proves)/i]
 return patterns.some(re=>{for(const m of text.matchAll(new RegExp(re.source,'g'))){const prefix=text.slice(Math.max(0,m.index!-12),m.index);if(!/(?:不|未|无|不能|不得|不应|尚不能|不代表|不宣称|可能|也许|或许|not |cannot |never |may |might )[^，。；;!?！？]{0,10}$/.test(prefix))return true}return false})
}
function falselyMissing(text:string,p:CoachAnalysisPacket):boolean{
 for(const clause of text.split(/[。；;\n]/)){
  if(!/(?:缺失|缺少|未记录|未提供|没有.{0,6}记录|无.{0,6}记录|未确认)/.test(clause))continue
  const dates=[...clause.matchAll(/\d{4}-\d\d-\d\d/g)].map(m=>m[0]).sort()
  const facts=dates.length?p.permittedFacts.filter(f=>f.occurredAt.slice(0,10)>=dates[0]&&f.occurredAt.slice(0,10)<=dates[dates.length-1]):p.permittedFacts
  const present=(metric:RegExp)=>facts.some(f=>f.kind==='METRIC'&&f.value!==null&&metric.test(f.metric))
  const training=facts.filter(f=>f.kind==='TRAINING')
  // A missing component field does not assert the absence of its whole session.
  let trainingAvailable=training.length>0
  if(/实际(?:训练)?类型|课次类型|observedType/i.test(clause))trainingAvailable=training.some(f=>f.observedType!==null)
  else if(/RPE/i.test(clause))trainingAvailable=training.some(f=>f.sessionRpe!==null)
  else if(/(?:整课|课次|本次训练).{0,8}时长|actualDuration/i.test(clause))trainingAvailable=training.some(f=>f.actualDurationSeconds!==null)
  else if(/跳跃(?:次数)?|jumpContacts/i.test(clause))trainingAvailable=training.some(f=>f.jumpContacts!==null)
  else if(/坡度|gradePercent/i.test(clause))trainingAvailable=training.some(f=>f.runSegments.some(r=>r.gradePercent!==null))
  else if(/地面|surface/i.test(clause))trainingAvailable=training.some(f=>f.runSegments.some(r=>r.surface!==null))
  const patterns:[RegExp,boolean][]=[[/\b(?:HRV|RMSSD|lnRMSSD)\b|心率变异/i,present(/^(?:HRV|(?:LN[_-]?)?RMSSD|HRV[_ -]RMSSD|RMSSD[_ -]MS)$/i)],[/\bRHR\b|静息心率/i,present(/^(?:RHR|RESTING[_ -]?HEART[_ -]?RATE)$/i)],[/历史训练|既往训练/,new Set(training.map(f=>f.occurrenceId)).size>1],[/历史记录|个人基线|既往记录/,new Set(facts.map(f=>f.occurredAt.slice(0,10))).size>1],[/本次训练|实际训练(?:明细|记录)?|课次记录/,trainingAvailable]]
  for(const [re,available]of patterns)if(available){const m=re.exec(clause);if(!m)continue;const around=clause.slice(Math.max(0,m.index-10),m.index+m[0].length+25);if(/(?:缺失|缺少|未记录|未提供|没有.{0,6}记录|无.{0,6}记录|未确认)/.test(around)&&!/(?:测量条件|设备一致性|同日前后|原计划|目标|来源一致性)/.test(around))return true}
 }
 return false
}
function canonicalTexts(p:CoachAnalysisPacket){return [...p.assessment.observations,...(p.derivedFacts??[]).map(d=>({text:d.text,evidenceRefs:d.evidenceRefs}))]}
function scrubNumbers(text:string){return text.replace(/[０-９]/g,c=>String(c.charCodeAt(0)-0xff10)).replace(/\d{4}-\d\d-\d\d(?:T[0-9:.+Z-]+)?/g,'').replace(/\b(?:F|S|O|C|A|D|P|E|CE)\d+(?:[-–]?(?:seg)?\d+)?(?:@\d+)?\b/g,'').replace(/\b(?:v|V|U)\d+(?:[._]\d+)*\b/g,'')}
function numberTokens(text:string){return [...scrubNumbers(text).matchAll(/[-+]?\d+(?:\.\d+)?/g)]}
function metricHint(text:string,path:string,holder:Record<string,unknown>|null):string|null{
 const raw=typeof holder?.metric==='string'?holder.metric:null
 if(raw&&/\.value$/.test(path))return raw.toUpperCase()
 const t=text.toLowerCase()
 if(/(?:ln\s*rmssd|对数|log\s*ratio)/i.test(t))return 'LN_RMSSD_RATIO'
 if(/纯跑(?:用时|时间|时长)?|pure\s*(?:run|work)|workseconds|pureRunTime/i.test(text+' '+path))return 'RUN_WORK_SECONDS'
 if(/极差|用时范围|segment.*range/i.test(t))return 'RUN_SEGMENT_RANGE_SECONDS'
 if(/总距离|累计距离|totaldistance/i.test(text+' '+path))return 'RUN_DISTANCE_M'
 if(/(?:rhr|静息心率)/i.test(t))return /%|百分比|相对变化/.test(t)?'RHR_PERCENT_CHANGE':'RHR'
 if(/(?:hrv|rmssd|心率变异)/i.test(t))return /%|百分比|相对变化/.test(t)?'RMSSD_PERCENT_CHANGE':'RMSSD'
 return null
}
function derivedHint(d:DerivedFact):string|null{return metricHint(d.metric+' '+d.text,'',null)??d.metric.toUpperCase()}
function numericCatalogue(p:CoachAnalysisPacket){
 const all:number[]=[],rows:{metric:string;value:number;unit:string;refs:EvidenceRef[]}[]=[]
 const collect=(x:unknown)=>{if(typeof x==='number'&&Number.isFinite(x))all.push(x);else if(Array.isArray(x))x.forEach(collect);else if(object(x))for(const [k,v]of Object.entries(x))if(!/revision|Index|knownAt|occurredAt|receivedAt/i.test(k))collect(v)}
 for(const f of p.permittedFacts){collect(f);const refs=[{id:f.id,revision:f.revision}]
  if(f.kind==='METRIC'&&f.value!==null)rows.push({metric:f.metric.toUpperCase(),value:f.value,unit:f.unit,refs})
  if(f.kind==='TRAINING'&&f.modality==='RUN'){
   const segs=f.runSegments.filter(s=>s.completion==='COMPLETED'),times=segs.map(s=>s.durationSeconds)
   all.push(segs.length)
   if(times.length&&times.every((v):v is number=>v!==null)){const sum=times.reduce((a,b)=>a+b,0),range=Math.max(...times)-Math.min(...times);rows.push({metric:'RUN_WORK_SECONDS',value:sum,unit:'s',refs},{metric:'RUN_SEGMENT_RANGE_SECONDS',value:range,unit:'s',refs});all.push(sum,range)}
   if(segs.length&&segs.every(s=>s.distanceM!==null)){const distance=segs.reduce((n,s)=>n+s.distanceM!,0);all.push(distance);rows.push({metric:'RUN_DISTANCE_M',value:distance,unit:'m',refs})}
  }
 }
 for(const d of p.derivedFacts??[]){all.push(d.value);rows.push({metric:derivedHint(d)??d.metric,value:d.value,unit:d.unit,refs:d.evidenceRefs})}
 // Host-approved observation/followup scales and intervals are legitimate audit
 // inputs too. Matching this catalogue still does not establish source binding.
 for(const text of [...canonicalTexts(p).map(o=>o.text),...p.assessment.hypotheses.flatMap(h=>[h.claim,h.discriminator]),...p.assessment.missingDecisionInputs])for(const n of numberTokens(text))all.push(Number(n[0]))
 return {all,rows}
}
type NumericBinding={metric:string;structured:boolean;immediate:boolean}
/** Narrative audit only: labels must precede the quantity they qualify. */
function legacyNumericBinding(clean:string,index:number,path:string,holder:Record<string,unknown>|null):NumericBinding|null{
 if(typeof holder?.metric==='string'&&/\.value$/.test(path))return {metric:holder.metric.toUpperCase(),structured:true,immediate:true}
 if(/\.(?:pureRunTime|workSeconds)$/.test(path))return {metric:'RUN_WORK_SECONDS',structured:true,immediate:true}
 if(/\.totalDistance$/.test(path))return {metric:'RUN_DISTANCE_M',structured:true,immediate:true}
 const boundary=Math.max(...['；',';','。','，',',','\n'].map(c=>clean.lastIndexOf(c,index-1)))
 const prefix=clean.slice(boundary+1,index)
 const labels:[RegExp,string|null][]=[
  [/纯跑(?:总)?(?:用时|时间|时长)|pure\s*(?:run|work)(?:\s*time)?|pureRunTime|workseconds/gi,'RUN_WORK_SECONDS'],
  [/(?:分段|完成段)?(?:用时)?极差|用时范围|segment\s*(?:time\s*)?range/gi,'RUN_SEGMENT_RANGE_SECONDS'],
  [/总距离|累计距离|实际完成|完成段总距离|totaldistance/gi,'RUN_DISTANCE_M'],
  [/ln\s*rmssd|自然对数比值变化|log\s*ratio/gi,'LN_RMSSD_RATIO'],
  [/\bRHR\b|静息心率/gi,'RHR'],[/\b(?:HRV|RMSSD)\b|心率变异/gi,'RMSSD'],
  [/分段用时(?!极差)|分段时间|各段.{0,3}用时|第\s*\d+步|步骤\s*\d+|组休|休息|\brest\b/gi,null],
 ]
 let nearest:{end:number;metric:string|null}|null=null
 for(const [re,metric]of labels)for(const m of prefix.matchAll(re)){const end=m.index!+m[0].length;if(!nearest||end>nearest.end)nearest={end,metric}}
 if(!nearest?.metric)return null
 const gap=prefix.slice(nearest.end).replace(/[（(][^）)]*[）)]/g,'').trim()
 // A directly attached list of quantities may continue a label. Narrative,
 // baseline/versus calculations, segment descriptions and new labels do not.
 const residue=gap.replace(/[-+]?\d+(?:\.\d+)?\s*(?:ms|bpm|s|m|秒|米|%|％)?/gi,'').replace(/[\s→⇒—–至到、/：:()（）-]/g,'')
 if(residue)return null
 return {metric:nearest.metric,structured:false,immediate:!gap}
}
function legacyAudit(v:unknown,p:CoachAnalysisPacket,aliases:Record<string,string>,diag:AnalysisAuditDiagnostics,errors:string[]){
 const byId=new Map(p.permittedFacts.map(f=>[f.id,f])),catalogue=numericCatalogue(p),covered=new Set<string>()
 const resolve=(id:string)=>byId.get(aliases[id]??id)
 for(const leaf of leaves(v)){
  if(/\.(?:id|source|revision|step|round|stat|status|certainty|planVersion)$/.test(leaf.path))continue
  const metadataRefs=[...leaf.text.matchAll(/\bF\d+(?:@\d+)?/g)].map(m=>m[0].split('@')[0])
  let explicitRange=false
  for(const m of leaf.text.matchAll(/\bF(\d+)\s*(?:→|至|到|[-–—])\s*F(\d+)\b/g)){const start=Number(m[1]),end=Number(m[2]);if(end>=start&&end-start<=100){explicitRange=true;for(let i=start;i<=end;i++)metadataRefs.push('F'+i)}}
  if(typeof leaf.holder?.id==='string'&&/^F\d+/.test(leaf.holder.id))metadataRefs.push(leaf.holder.id.match(/^F\d+/)![0])
  const unknown=metadataRefs.filter(id=>!resolve(id))
  for(const id of [...new Set(unknown)])diag.sourceAliasMismatches.push({path:leaf.path,id})
  const refs=metadataRefs.flatMap(id=>{const f=resolve(id);return f?[{id:f.id,revision:f.revision}]:[]})
  const clean=scrubNumbers(leaf.text),tokens=numberTokens(leaf.text)
  for(const token of tokens){
   const actual=Number(token[0]),index=token.index??0
   // Metric labels bind values. A number elsewhere in a paragraph does not inherit
   // an earlier label across a clause or another labelled measurement.
   const clauseStart=Math.max(clean.lastIndexOf('；',index),clean.lastIndexOf(';',index),clean.lastIndexOf('。',index),clean.lastIndexOf('，',index))
   const local=clean.slice(Math.max(clauseStart+1,index-34),Math.min(clean.length,index+12))
   const unit=(clean.slice(index+token[0].length).match(/^\s*(s\/km|ms|bpm|kg|kcal|km|s|m|毫秒|秒|公里|米|%|％)/i)?.[1]??(typeof leaf.holder?.unit==='string'?leaf.holder.unit:null))
   const binding=legacyNumericBinding(clean,index,leaf.path,leaf.holder)
   let hint=binding?.metric??null
   if(unit&&normalizedUnit(unit)==='%'){
    if(hint==='RHR')hint='RHR_PERCENT_CHANGE'
    if(hint==='RMSSD')hint='RMSSD_PERCENT_CHANGE'
   }
   const rows=hint?catalogue.rows.filter(r=>r.metric===hint&&(!refs.length||r.refs.some(a=>refs.some(b=>refKey(a)===refKey(b))))):[]
   const sameUnitRows=unit?rows.filter(r=>normalizedUnit(r.unit)===normalizedUnit(unit)):[]
   const sourceBound=refs.length>0&&!unknown.length&&(new Set(refs.map(refKey)).size===1||explicitRange)
   if(hint&&unit&&rows.length&&!unknown.length&&!sameUnitRows.length){
    if(sourceBound&&(binding?.structured||binding?.immediate&&/^(?:RHR|RMSSD)$/.test(hint)))diag.unitContradictions.push({path:leaf.path,metric:hint,actual:unit,expected:[...new Set(rows.map(r=>r.unit))],refs})
    else diag.reviewReasons.push('AMBIGUOUS_NUMERIC_DIMENSION_OR_ROLE')
   }
   if(hint&&sameUnitRows.length&&sameUnitRows.every(r=>!close(r.value,actual))){
    if(sourceBound){diag.numericContradictions.push({path:leaf.path,metric:hint,actual,expected:[...new Set(sameUnitRows.map(r=>r.value))],unit,refs});continue}
    diag.reviewReasons.push('AMBIGUOUS_NUMERIC_SOURCE_SCOPE')
   }
   if(!catalogue.all.some(n=>close(n,actual))&&!/第\s*$/.test(clean.slice(Math.max(0,index-3),index))){diag.unsupportedNumbers.push({path:leaf.path,value:token[0],context:local})}
   for(const d of p.derivedFacts??[])if(close(actual,d.value)&&hint&&hint===derivedHint(d)&&(!refs.length||d.evidenceRefs.some(a=>refs.some(b=>refKey(a)===refKey(b)))))covered.add(d.id)
   // Coverage only: an RHR-owned baseline comparison may put its signed
   // difference after a comma inside parentheses. Do not use this looser
   // paragraph association to assert numeric contradictions.
   if(!unknown.length&&/^[+-]/.test(token[0])&&unit&&normalizedUnit(unit)==='bpm'){
    const boundary=Math.max(...['。','；',';','\n'].map(c=>clean.lastIndexOf(c,index-1)))
    const prefix=clean.slice(boundary+1,index)
    const labels=[...prefix.matchAll(/\b(?:RHR|RMSSD|HRV)\b|静息心率|心率变异/gi)],owner=labels.at(-1)
    if(owner&&/^(?:RHR|静息心率)$/i.test(owner[0])&&/基线|绝对变化|差值/.test(prefix.slice(owner.index!+owner[0].length))){
     for(const d of p.derivedFacts??[])if(d.metric==='RHR_CHANGE_BPM'&&close(actual,d.value)&&normalizedUnit(d.unit)==='bpm'&&d.evidenceRefs.length&&d.evidenceRefs.every(a=>refs.some(b=>refKey(a)===refKey(b))))covered.add(d.id)
    }
   }
  }
  for(const d of p.derivedFacts??[])if(leaf.text.includes(d.text))covered.add(d.id)
  if(medicalOrWrite(leaf.text))errors.push('WRITE_CLEARANCE_SAFETY_OR_CAUSAL_CLAIM')
  if(falselyMissing(leaf.text,p))errors.push('PRESENT_DATA_CLAIMED_MISSING')
 }
 if(diag.numericContradictions.length)errors.push('NUMBER_CONTRADICTION')
 if(diag.unsupportedNumbers.length)errors.push('UNSUPPORTED_NUMERIC_CLAIM')
 if(diag.unitContradictions.length)errors.push('UNIT_CONTRADICTION')
 if(diag.sourceAliasMismatches.length)errors.push('SOURCE_ALIAS_MISMATCH')
 diag.omittedRequiredDerivedFactIds=(p.requirements?.requiredDerivedFactIds??[]).filter(id=>!covered.has(id))
 if(diag.omittedRequiredDerivedFactIds.length)errors.push('REQUIRED_DERIVED_FACT_OMITTED')
 diag.reviewReasons=[...new Set(diag.reviewReasons)]
 diag.reviewReasons.push('LEGACY_SCHEMA_NOT_RUNTIME_ACCEPTABLE','NUMERIC_MATCHES_DO_NOT_PROVE_SEMANTIC_CORRECTNESS','UNLABELLED_NUMBERS_MATCH_CATALOGUE_ONLY_NOT_PROVEN_SOURCE_BINDING')
}
/** Offline inspection is diagnostic, including for historical schemas. It cannot prove scientific or semantic correctness. */
export function auditAnalysisContent(content:unknown,p:CoachAnalysisPacket,options:{legacy?:boolean;sourceAliases?:Record<string,string>}={}):AnalysisContentAudit {
 let v=content
 if(typeof v==='string'){try{v=JSON.parse(v)}catch{v={answer:v}}}
 const diagnostics:AnalysisAuditDiagnostics={schemaErrors:schemaErrors(v),numericContradictions:[],unsupportedNumbers:[],unitContradictions:[],omittedRequiredDerivedFactIds:[],sourceAliasMismatches:[],reviewReasons:[]},errors:string[]=[],reviewedClaims:string[]=[]
 if(options.legacy){legacyAudit(v,p,options.sourceAliases??{},diagnostics,errors);return {status:errors.length?'REJECTED':'NEEDS_SEMANTIC_REVIEW',errors:[...new Set(errors)],reviewedClaims,professionalCorrectness:'NOT_PROVEN',diagnostics}}
 errors.push(...diagnostics.schemaErrors)
 const r=object(v)?v:{},canonical=canonicalTexts(p),knownRef=(ref:EvidenceRef)=>p.permittedFacts.some(f=>f.id===ref.id&&f.revision===ref.revision),covered=new Set<string>(),approvedText=new Set<string>()
 let remaining=typeof r.answer==='string'?r.answer:''
 if(r.selectedCandidateId!==null&&typeof r.selectedCandidateId==='string'&&!p.allowedCandidateIds.includes(r.selectedCandidateId))errors.push('CANDIDATE_NOT_ALLOWED')
 if(r.memoryClaim!=='NOT_SAVED')errors.push('WRITE_OR_CLEARANCE_CLAIM')
 if(strings(r.derivedFactIds))for(const id of r.derivedFactIds){const d=p.derivedFacts?.find(x=>x.id===id);if(!d||!d.evidenceRefs.every(knownRef)||d.scope.athleteId!==p.context.athleteId||d.scope.asOf!==p.context.asOf)errors.push('UNKNOWN_OR_STALE_DERIVED_FACT');else covered.add(id)}
 if(Array.isArray(r.factualClaims))for(const c of r.factualClaims){
  if(!object(c)||typeof c.text!=='string'||!refArray(c.refs)||!c.refs.length)continue
  const claimRefs=c.refs
  if(!claimRefs.every(knownRef)){errors.push('UNKNOWN_OR_STALE_REFERENCE');continue}
  if(!canonical.some(o=>o.text===c.text&&refsEqual(o.evidenceRefs,claimRefs))||!remaining.includes(c.text)){errors.push('FACT_VALUE_UNIT_OR_DIRECTION_UNVERIFIED');continue}
  remaining=remaining.replace(c.text,'');reviewedClaims.push(c.text);approvedText.add(c.text)
  for(const d of p.derivedFacts??[])if(d.text===c.text&&refsEqual(d.evidenceRefs,c.refs))covered.add(d.id)
 }
 // Host hypotheses and missing inputs may be quoted intact. Other supplemental
 // fields have the same safety and number boundaries as answer.
 const approvedHypotheses=new Set<unknown>()
 if(Array.isArray(r.hypotheses))for(const h of r.hypotheses){
  if(object(h))for(const key of ['supportingRefs','weakeningRefs'])if(refArray(h[key])&&!h[key].every(knownRef))errors.push('UNKNOWN_OR_STALE_REFERENCE')
  if(p.assessment.hypotheses.some(x=>same(x,h)))approvedHypotheses.add(h);else diagnostics.reviewReasons.push('HYPOTHESIS_REQUIRES_REVIEW')
 }
 const inspect=(text:string,path:string,approved=false)=>{
  if(falselyMissing(text,p))errors.push('PRESENT_DATA_CLAIMED_MISSING')
  if(approved)return
  if(medicalOrWrite(text))errors.push('WRITE_CLEARANCE_SAFETY_OR_CAUSAL_CLAIM')
  const tokens=numberTokens(text),hanNumber=/[零〇一二两三四五六七八九十百千万]+\s*(?:组|次|秒|小时|分钟|公里|米|公斤|千克)/.test(text);if(tokens.length||hanNumber){errors.push('UNREFERENCED_NUMERIC_CLAIM');for(const n of tokens)diagnostics.unsupportedNumbers.push({path,value:n[0],context:text.slice(Math.max(0,(n.index??0)-25),(n.index??0)+35)})}
 }
 inspect(remaining,'$.answer')
 for(const leaf of leaves(r)){
  if(leaf.path==='$.answer'||/^\$\.factualClaims\[\d+\]\.refs\[\d+\]\.(?:id|revision)$/.test(leaf.path)||/^\$\.(?:derivedFactIds|selectedCandidateId|memoryClaim)/.test(leaf.path))continue
  if(/^\$\.hypotheses\[\d+\]/.test(leaf.path)){
   const i=Number(leaf.path.match(/^\$\.hypotheses\[(\d+)\]/)![1]);if(Array.isArray(r.hypotheses)&&approvedHypotheses.has(r.hypotheses[i]))continue
   if(/\.(?:id|revision|certainty)$/.test(leaf.path))continue
  }
  const approved=approvedText.has(leaf.text)||p.assessment.missingDecisionInputs.includes(leaf.text)||p.assessment.hypotheses.some(h=>h.discriminator===leaf.text)
  inspect(leaf.text,leaf.path,approved)
  if(!approved&&!/^\$\.factualClaims/.test(leaf.path))diagnostics.reviewReasons.push('UNREVIEWED_SUPPLEMENTAL_CONTENT')
 }
 diagnostics.omittedRequiredDerivedFactIds=(p.requirements?.requiredDerivedFactIds??[]).filter(id=>!covered.has(id))
 if(diagnostics.omittedRequiredDerivedFactIds.length)errors.push('REQUIRED_DERIVED_FACT_OMITTED')
 const cited=Array.isArray(r.factualClaims)?r.factualClaims.flatMap(c=>object(c)&&refArray(c.refs)?c.refs:[]):[]
 if((p.requirements?.requiredFactRefs??[]).some(ref=>!cited.some(c=>refKey(c)===refKey(ref))&&![...covered].some(id=>p.derivedFacts?.find(d=>d.id===id)?.evidenceRefs.some(c=>refKey(c)===refKey(ref)))))errors.push('REQUIRED_FACT_OMITTED')
 if(remaining.trim())diagnostics.reviewReasons.push('UNREVIEWED_ANSWER_SEMANTICS')
 diagnostics.reviewReasons=[...new Set(diagnostics.reviewReasons)]
 return {status:errors.length?'REJECTED':diagnostics.reviewReasons.length?'NEEDS_SEMANTIC_REVIEW':'ACCEPTED_STRUCTURALLY',errors:[...new Set(errors)],reviewedClaims,professionalCorrectness:'NOT_PROVEN',diagnostics}
}
export function validateAnalysisReply(reply:unknown,p:CoachAnalysisPacket):ReplyValidation {
 const {status,errors,reviewedClaims,professionalCorrectness}=auditAnalysisContent(reply,p)
 return {status,errors,reviewedClaims,professionalCorrectness}
}
/** Final measured/derived values always come from deterministic host text. */
export function composeVerifiedAnalysisAnswer(reply:unknown,p:CoachAnalysisPacket):string {
 const validation=validateAnalysisReply(reply,p)
 if(validation.status!=='ACCEPTED_STRUCTURALLY')throw Error('ANALYSIS_REPLY_NOT_VERIFIED')
 const r=reply as CoachAnalysisReply,selected=new Set(r.derivedFactIds??[]),lines=[r.answer]
 for(const d of p.derivedFacts??[])if(selected.has(d.id)&&!r.answer.includes(d.text))lines.push(d.text)
 return lines.join('\n')
}
