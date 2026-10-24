import type { ModelInput, TrainingCandidate } from './types'
import type { RunningPlan } from '../../core/running-plan'
import { buildTrainingCandidates } from './candidates'
import { canonical, exactTime } from './source'
type Result<T>={ok:true;value:T}|{ok:false;code:string}
export type TrainingProposal={id:string;athleteId:string;createdAt:string;expiresAt:string;binding:string;candidate:TrainingCandidate;hash:string;state:'PENDING'|'CONFIRMED'}
export type TrainingExportReceipt={id:string;proposalId:string;athleteId:string;confirmedAt:string;asOf:string;kind:'CONFIRMED_EXPORT';scheduleWritten:false;automaticExecution:false;plan:RunningPlan|null;action:TrainingCandidate['action'];sourcePlanId:string;hash:string;notice:string}
export type ConfirmationDocument={athleteId:string;proposals:Record<string,TrainingProposal>;receipts:Record<string,TrainingExportReceipt>}
export interface ConfirmationRepository {transact<T>(athleteId:string,work:(draft:ConfirmationDocument)=>T):Promise<T>}
const digest=async(v:unknown)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(v))))].map(n=>n.toString(16).padStart(2,'0')).join('')
const payload=(p:TrainingProposal)=>({...p,hash:undefined,state:undefined})
/** Hash actual source bytes. The existing short display digest is not an authorization binding. */
const sourceBinding=(i:ModelInput)=>({
 context:{...i.context,asOf:undefined},snapshot:{facts:i.snapshot.facts,excluded:i.snapshot.excluded,conflicts:i.snapshot.conflicts,gaps:i.snapshot.gaps,safetyConstraints:i.snapshot.safetyConstraints},
 thresholds:i.thresholds,performances:i.performances,zoneSegments:i.zoneSegments,window:i.window,profile:i.profile,sessions:i.sessions,
 recovery:i.recovery?{...i.recovery,snapshotId:undefined}:null
})
export function createTrainingConfirmation(options:{repository:ConfirmationRepository;loadInput:()=>Promise<ModelInput>;now?:()=>Date}){
 const now=options.now??(()=>new Date())
 const failure=(code:string):Result<never>=>({ok:false,code})
 const validInput=(i:ModelInput)=>!!i.context.athleteId&&exactTime(i.context.asOf)&&Date.parse(i.context.asOf)<=now().getTime()&&now().getTime()-Date.parse(i.context.asOf)<=15*60000
 return {
  async prepare(candidateId:string):Promise<Result<TrainingProposal>>{
   try{
    const input=await options.loadInput();if(!validInput(input))return failure('STALE_INPUT')
    const candidate=buildTrainingCandidates(input).candidates.find(c=>c.id===candidateId)
    if(!candidate)return failure('CANDIDATE_UNAVAILABLE')
    const createdAt=now().toISOString(),binding=await digest(sourceBinding(input))
    const proposal:TrainingProposal={id:crypto.randomUUID(),athleteId:input.context.athleteId,createdAt,expiresAt:new Date(Date.parse(createdAt)+15*60000).toISOString(),binding,candidate:structuredClone(candidate),state:'PENDING',hash:''}
    proposal.hash=await digest(payload(proposal))
    const latest=await options.loadInput()
    if(await digest(sourceBinding(latest))!==binding)return failure('CONTEXT_CHANGED')
    return await options.repository.transact(proposal.athleteId,d=>{if(d.athleteId!==proposal.athleteId)throw Error('OWNER_MISMATCH');d.proposals[proposal.id]=structuredClone(proposal);return {ok:true as const,value:proposal}})
   }catch{return failure('PERSISTENCE_OR_CONTEXT_UNAVAILABLE')}
  },
  async confirm(request:{proposalId:string;hash:string;confirmation:'CONFIRM_TRAINING_EXPORT'}):Promise<Result<TrainingExportReceipt>>{
   if(request.confirmation!=='CONFIRM_TRAINING_EXPORT')return failure('EXPLICIT_CONFIRMATION_REQUIRED')
   try{
    const input=await options.loadInput(),athlete=input.context.athleteId
    if(!validInput(input))return failure('STALE_INPUT')
    const proposal=await options.repository.transact(athlete,d=>structuredClone(d.proposals[request.proposalId]??null))
    if(!proposal||proposal.athleteId!==athlete||proposal.state!=='PENDING')return failure('MISSING_OR_ALREADY_CONFIRMED')
    if(Date.parse(proposal.expiresAt)<=now().getTime()||proposal.hash!==request.hash||await digest(payload(proposal))!==proposal.hash)return failure('INVALID_OR_EXPIRED_PROPOSAL')
    const binding=await digest(sourceBinding(input));if(binding!==proposal.binding)return failure('CONTEXT_CHANGED')
    const candidate=buildTrainingCandidates(input).candidates.find(c=>c.id===proposal.candidate.id)
    if(!candidate||canonical(candidate)!==canonical(proposal.candidate))return failure('CANDIDATE_CHANGED')
    const receipt:TrainingExportReceipt={id:crypto.randomUUID(),proposalId:proposal.id,athleteId:athlete,confirmedAt:now().toISOString(),asOf:input.context.asOf,kind:'CONFIRMED_EXPORT',scheduleWritten:false,automaticExecution:false,plan:structuredClone(candidate.after),action:candidate.action,sourcePlanId:candidate.before.planId,hash:proposal.hash,notice:'已确认结构导出；尚未写入日程、启动训练或修改原计划。'}
    const latest=await options.loadInput();if(!validInput(latest)||await digest(sourceBinding(latest))!==binding)return failure('CONTEXT_CHANGED')
    return await options.repository.transact(athlete,d=>{
     const current=d.proposals[proposal.id]
     if(!current||current.hash!==proposal.hash||current.state!=='PENDING'||canonical(current)!==canonical(proposal))return failure('CONCURRENT_CONFIRMATION')
     d.proposals[proposal.id]={...current,state:'CONFIRMED'};d.receipts[receipt.id]=structuredClone(receipt)
     return {ok:true as const,value:receipt}
    })
   }catch{return failure('PERSISTENCE_OR_CONTEXT_UNAVAILABLE')}
  }
 }
}
/** One durable transaction for proposal + receipt. It does not write the legacy schedule or actuals. */
export function createIndexedDbTrainingConfirmations():ConfirmationRepository{
 const open=()=>new Promise<IDBDatabase>((resolve,reject)=>{
  if(typeof indexedDB==='undefined')return reject(Error('INDEXEDDB_UNAVAILABLE'))
  const r=indexedDB.open('fangkun-training-model-exports-v1',1)
  r.onupgradeneeded=()=>r.result.createObjectStore('exports',{keyPath:'athleteId'})
  r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('DATABASE_BLOCKED'));r.onsuccess=()=>resolve(r.result)
 })
 return {async transact<T>(athleteId:string,work:(draft:ConfirmationDocument)=>T):Promise<T>{
  const db=await open()
  return new Promise<T>((resolve,reject)=>{
   const tx=db.transaction('exports','readwrite'),store=tx.objectStore('exports'),req=store.get(athleteId);let value:T
   req.onsuccess=()=>{try{const d=req.result??{athleteId,proposals:{},receipts:{}}
    if(d.athleteId!==athleteId||!d.proposals||!d.receipts)throw Error('INVALID_DOCUMENT')
    value=work(d);store.put(d)
   }catch(error){tx.abort();reject(error)}}
   tx.oncomplete=()=>{db.close();resolve(value)};tx.onabort=()=>{db.close();reject(tx.error??Error('TRANSACTION_ABORTED'))};tx.onerror=()=>{db.close();reject(tx.error)}
  })
 }}
}
