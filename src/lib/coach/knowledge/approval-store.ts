/** Signed receipts are stored append-only. Storage is never an approval authority. */
import { currentStore } from '../../core/storage.ts'
import { verifyKnowledgeApprovals, installKnowledgeLedger, type TrustedReviewerKey, type VerifiedKnowledgeLedger } from './approval.ts'
export const KNOWLEDGE_APPROVALS_KEY = 'fk-knowledge-approvals-v1'
function readRaw(): unknown[] {
 const raw=currentStore()?.getItem(KNOWLEDGE_APPROVALS_KEY)
 if(raw==null)return []
 const v:unknown=JSON.parse(raw)
 if(!Array.isArray(v))throw new Error('INVALID_APPROVAL_STORAGE')
 return v
}
// Serialize imports in this realm and, when available, across tabs. Never trim
// revocation history: capacity exhaustion fails before writing anything.
let tail:Promise<unknown>=Promise.resolve()
async function lock<T>(fn:()=>Promise<T>):Promise<T>{
 if(typeof navigator!=='undefined'&&navigator.locks?.request)return navigator.locks.request('fangkun-knowledge-approvals-v1',fn)
 const next=tail.then(fn);tail=next.catch(()=>{});return next
}
export async function importKnowledgeApprovalReceipts(receipts:unknown[],options:{trustedKeys?:readonly TrustedReviewerKey[];asOf?:string}={}){
 try { receipts=structuredClone(receipts);options=structuredClone(options) }
 catch { return {ok:false as const,reason:'INVALID_INPUT'} }
 return lock(async()=>{
  const store=currentStore();if(!store||!Array.isArray(receipts))return {ok:false as const,reason:'STORE_UNAVAILABLE'}
  let prior:unknown[]
  try{prior=readRaw()}catch{return {ok:false as const,reason:'STORE_UNREADABLE'}}
  // Verify the full incoming batch, including duplicate IDs. Conflicting signed
  // receipts must not be silently discarded as an "idempotent" success.
  const merged=[...prior,...receipts],ledger=await verifyKnowledgeApprovals(merged,options)
  if(ledger.rejected.some(r=>r.reason==='RECEIPT_ID_CONFLICT'))return {ok:false as const,reason:'RECEIPT_ID_CONFLICT'}
  const ids=new Set(prior.map(r=>(r as {receiptId?:string})?.receiptId))
  const accepted:unknown[]=[]
  for(const r of receipts){
   const id=(r as {receiptId?:string})?.receiptId
   if(typeof id==='string'&&!ids.has(id)&&!ledger.rejected.some(x=>x.receiptId===id)){accepted.push(structuredClone(r));ids.add(id)}
  }
  if(prior.length+accepted.length>500)return {ok:false as const,reason:'CAPACITY_REQUIRES_ARCHIVE_NOT_TRUNCATION'}
  try{
   if(accepted.length){const raw=JSON.stringify([...prior,...accepted]);store.setItem(KNOWLEDGE_APPROVALS_KEY,raw);if(store.getItem(KNOWLEDGE_APPROVALS_KEY)!==raw)return {ok:false as const,reason:'WRITE_NOT_CONFIRMED'}}
  }catch{return {ok:false as const,reason:'WRITE_FAILED'}}
  // Re-read and verify the actual committed receipts; an accepted new revoke is
  // active immediately in this session, without waiting for a page refresh.
  let committed:VerifiedKnowledgeLedger
  try { committed=await verifyKnowledgeApprovals(readRaw(),options) }
  catch { installKnowledgeLedger(null);return {ok:false as const,reason:'STORE_UNREADABLE'} }
  installKnowledgeLedger(committed)
  return {ok:true as const,accepted:accepted.length,rejected:ledger.rejected.filter(x=>receipts.some(r=>(r as {receiptId?:string})?.receiptId===x.receiptId))}
 })
}
export async function loadInstalledKnowledgeLedger(options:{trustedKeys?:readonly TrustedReviewerKey[];asOf?:string}={}):Promise<VerifiedKnowledgeLedger>{
 installKnowledgeLedger(null)
 return lock(async()=>{
  const ledger=await verifyKnowledgeApprovals(readRaw(),options)
  installKnowledgeLedger(ledger);return ledger
 })
}
