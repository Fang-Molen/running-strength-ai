import type { R6Decision } from '../../../src/lib/coach/r6/runtime'
import type { AuthorizedCoachSnapshot } from './coach-service-contract'
import { stableJson } from '../../../src/lib/health/analysis-evidence'
import { assertCoachAnalysisPacketIntegrity } from '../../../src/lib/health/analysis-packet'
import { selectTrainingModels } from '../../../src/lib/coach/training-models/selection'

/** Only the authenticated snapshot loader may supply this value. The browser
 * request has no R6 decision, owner, facts, plan, approval or computed-value field. */
export type R6ScientificDecision = Pick<R6Decision, 'athleteId'|'asOf'|'version'|'knowledgeVersion'|'input'|'comparison'|'candidates'|'safety'|'source'>
const sha256=async(text:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('')
const same=(a:unknown,b:unknown)=>stableJson(a)===stableJson(b)
const omit=(value:Record<string,unknown>,keys:string[])=>Object.fromEntries(Object.entries(value).filter(([key])=>!keys.includes(key)))

/** Example loader composition:
 * 1. Existing authenticate verifies session; owned snapshot repository resolves
 *    subject + athlete + consent + asOf + plan version (never request facts).
 * 2. Recompute readR6Decision's equivalent from those server-owned source rows.
 * 3. return attachR6ScientificDecision(authorizedSnapshot, serverDecision).
 * This adapter adds no login, snapshot persistence, consent or billing authority.
 */
export async function attachR6ScientificDecision(snapshot:AuthorizedCoachSnapshot,decision:R6ScientificDecision):Promise<AuthorizedCoachSnapshot> {
 await r6ScientificModelView(snapshot,decision)
 return {...snapshot,r6Decision:structuredClone(decision)}
}

/** Rechecks saved results and creates a read-only, de-identified explanation
 * context. It cannot return an executable model candidate or modify a plan. */
export async function r6ScientificModelView(snapshot:AuthorizedCoachSnapshot,d:R6ScientificDecision) {
 const p=snapshot.analysisPacket
 if(!p||d.athleteId!==snapshot.athleteId||d.asOf!==snapshot.asOf||d.input.context.athleteId!==snapshot.athleteId||d.input.context.asOf!==snapshot.asOf||d.input.context.planVersion!==p.context.planVersion||d.input.snapshot.snapshotId!==p.snapshotId||!same(d.input.snapshot.facts,p.permittedFacts)||!d.input.recovery||d.input.recovery.snapshotId!==p.snapshotId||d.input.recovery.safetyState!==p.assessment.safetyState||d.input.recovery.signalState!==p.assessment.signalState||d.input.recovery.medicalClearance!==false||d.input.recovery.automaticPrescription!==false||!d.knowledgeVersion)throw Error('R6_SNAPSHOT_BINDING')
 assertCoachAnalysisPacketIntegrity(p)
 if(await sha256(stableJson(d.source))!==d.version)throw Error('R6_SOURCE_VERSION')
 let source:{owner?:string;context?:{planVersion?:string|null};facts?:unknown;entries?:unknown[];knowledge?:unknown}
 try{source=JSON.parse(d.source)}catch{throw Error('R6_SOURCE_INVALID')}
 if(source.owner!==d.athleteId||source.context?.planVersion!==p.context.planVersion||!same(source.facts,p.permittedFacts)||!Array.isArray(source.entries))throw Error('R6_SOURCE_BINDING')
 if(!source.knowledge||await sha256(stableJson(source.knowledge))!==d.knowledgeVersion)throw Error('R6_KNOWLEDGE_VERSION')
 const comparison=selectTrainingModels(d.input)
 if(!same(comparison,d.comparison))throw Error('R6_COMPUTED_REVIEW_CHANGED')
 if(['HOLD_ACTIVE','ESCALATION_REQUIRED'].includes(p.assessment.safetyState)&&!d.safety.hold)throw Error('R6_SAFETY_DOWNGRADE')
 const refs=new Set(p.permittedFacts.map(f=>`${f.id}@${f.revision}`))
 for(const c of d.candidates){
  if(!p.context.planVersion||c.before.athleteId!==d.athleteId||c.after.athleteId!==d.athleteId||c.before.id!==c.sessionId||c.after.id!==c.sessionId||c.before.status!=='planned'||c.before.actual||!source.entries.some(e=>same(e,c.before))||c.requiresConfirmation!==true)throw Error('R6_PLAN_BINDING')
  if(c.evidence.some(r=>!refs.has(`${r.id}@${r.revision}`)&&!(r.revision===0&&r.id.startsWith(`schedule:${c.sessionId}:`))))throw Error('R6_EVIDENCE_BINDING')
  if(c.action==='KEEP'&&(c.changedVariable!=='NONE'||!same(c.before,c.after))||c.action==='MOVE'&&(c.changedVariable!=='DATE'||!same(omit(c.before,['date','movedFrom']),omit(c.after,['date','movedFrom'])))||c.action==='DEFER'&&(c.changedVariable!=='SESSION_EXECUTION'||c.after.status!=='skipped'||!same(omit(c.before,['status']),omit(c.after,['status'])))||!['KEEP','MOVE','DEFER'].includes(c.action))throw Error('R6_DOSE_MUTATION')
  if(c.canConfirm&&c.action!=='DEFER'&&(d.safety.hold||!comparison.allowTrainingCandidates))throw Error('R6_CANDIDATE_CLEARANCE')
 }
 // Local source/decision/knowledge versions remain exact in the saved handoff.
 // The wire uses stable ephemeral labels, including distinct threshold methods.
 const aliases=new Map<string,string>([[d.athleteId,'ATHLETE'],[d.version,'DECISION'],[d.knowledgeVersion,'KNOWLEDGE']])
 if(p.context.planVersion)aliases.set(p.context.planVersion,'PLAN')
 p.permittedFacts.slice().sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt)||a.id.localeCompare(b.id)).forEach((f,i)=>{aliases.set(f.id,`F${i+1}`);if(!aliases.has(f.sourceRecordId))aliases.set(f.sourceRecordId,`R${i+1}`)})
 const namespaces=new Map<string,Map<string,string>>()
 const alias=(value:string,kind:string)=>{let map=namespaces.get(kind);if(!map){map=new Map();namespaces.set(kind,map)}if(!map.has(value))map.set(value,`${kind}${map.size+1}`);return map.get(value)!}
 for(const c of d.candidates){aliases.set(c.id,alias(c.id,'R6C'));aliases.set(c.sessionId,alias(c.sessionId,'PLAN_SESSION'))}
 for(const t of d.input.thresholds){aliases.set(t.testId,alias(t.testId,'TEST'));aliases.set(t.method,alias(t.method,'METHOD'));if(t.protocolKey)aliases.set(t.protocolKey,alias(t.protocolKey,'PROTOCOL'))}
 const identity=new Set(['id','sessionId','planId','planSlotId','componentId','blockId','stepId','sourceRecordId','sourceId','sourceIds','testId','method','protocol','protocolKey','accountRef','deviceId'])
 const sanitize=(v:unknown,key=''):any=>{
  if(Array.isArray(v))return v.map(x=>sanitize(x,key))
  if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).filter(([k])=>!['sourceUrl','source','note','title','customName','athleteId'].includes(k)).map(([k,x])=>[k,sanitize(x,k)]))
  if(typeof v!=='string')return v
  if(aliases.has(v))return aliases.get(v)
  if(identity.has(key)&&!['PYRAMIDAL','POLARIZED','THRESHOLD_ORIENTED','SINGLE_THRESHOLD','DOUBLE_THRESHOLD','BLOCK','EVENT_SPECIFIC'].includes(v))return alias(v,'REF')
  return [...aliases].reduce((s,[raw,replacement])=>raw.length>=4?s.split(raw).join(replacement):s,v)
 }
 const physiology=comparison.physiology
 return sanitize({schemaVersion:'FK_R6_SCIENTIFIC_CONTEXT_1',owner:'ATHLETE',asOf:d.asOf,planVersion:p.context.planVersion?'PLAN':null,decisionVersion:'DECISION',knowledgeVersion:'KNOWLEDGE',writeAuthority:'NONE',candidateAuthority:'HOST_CONFIRMATION_REQUIRED',
  physiology:{thresholds:physiology.thresholds.allPairs,cs:{status:physiology.cs.status,value:physiology.cs.value,unit:physiology.cs.unit},vdot:physiology.vdot,eventProfile:physiology.eventProfile},
  distribution:comparison.distribution,
  methods:comparison.methods.map(m=>({method:m.method,dimension:m.dimension,status:m.status,dataAdequacy:m.dataAdequacy,candidateAllowed:m.candidateAllowed,conditionalRank:m.conditionalRank.priority,evidenceIds:m.evidenceIds})),
  missing:[...new Set(comparison.methods.flatMap(m=>m.keyMissing))],
  candidates:d.candidates.map(c=>({id:c.id,action:c.action,changedVariable:c.changedVariable,before:c.before,after:c.after,evidence:c.evidence,evidenceIds:c.evidenceIds,reason:c.reason,risks:c.risks,observationMetrics:c.observationMetrics,canConfirm:c.canConfirm,blockedReasons:c.blockedReasons,requiresConfirmation:true})),
  safety:d.safety,scientificallyValidated:false,planWritten:false})
}
