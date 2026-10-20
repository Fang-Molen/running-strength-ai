import test from 'node:test'
import assert from 'node:assert/strict'
import { verifyKnowledgeApprovals, approvalHandle, ledgerApproves, approvalSigningPayload, type KnowledgeApprovalReceipt, type TrustedReviewerKey } from './approval.ts'
import registry from '../../../../knowledge/coach-complete-20261020/registry.json' with {type:'json'}
import cards from '../../../../knowledge/coach-complete-20261020/knowledge_cards.json' with {type:'json'}
const card=cards.find(c=>c.id==='R03')!
async function fixture() {
 const pair=await crypto.subtle.generateKey({name:'Ed25519'},true,['sign','verify']) as CryptoKeyPair
 const key:TrustedReviewerKey={keyId:'test',reviewerId:'qualified-reviewer',role:'HUMAN_PROFESSIONAL',publicKey:Buffer.from(await crypto.subtle.exportKey('raw',pair.publicKey)).toString('base64'),validFrom:registry.importedAt,validUntil:null}
 const receipt:Omit<KnowledgeApprovalReceipt,'signature'>={schema:'FK-KNOWLEDGE-APPROVAL-1',receiptId:'a',catalog:'FK-COACH-KNOWLEDGE-COMPLETE-20261020',cardId:'R03',cardVersion:card.version,contentSha256:registry.cardSha256.R03,sourceSha256:Object.fromEntries(card.source_ids.map(id=>[id,(registry.sourceSha256 as Record<string,string>)[id]])),decision:'APPROVED',scope:{population:'ADULT_RUNNER',note:'test only'},reviewer:{id:key.reviewerId,role:key.role},reviewedAt:new Date(Date.now()-10000).toISOString(),keyId:key.keyId}
 const sign=async(r=receipt)=>({...r,signature:Buffer.from(await crypto.subtle.sign('Ed25519',pair.privateKey,approvalSigningPayload(r))).toString('base64')})
 return {key,receipt,sign}
}
test('unsigned mutations of an inspection Map cannot grant authority',async()=>{
 const l=await verifyKnowledgeApprovals([])
 ;(l.approved as Map<string,unknown>).set(approvalHandle('R03',card.version),{contentSha256:registry.cardSha256.R03,receiptId:'forged'})
 assert.equal(ledgerApproves(l,'R03',card.version,registry.cardSha256.R03),null)
 assert.equal(l.approved.size,0)
})
test('approved values are immutable and deleting an inspection entry cannot revoke private state',async()=>{
 const {key,sign}=await fixture(),l=await verifyKnowledgeApprovals([await sign()],{trustedKeys:[key]})
 const a=ledgerApproves(l,'R03',card.version,registry.cardSha256.R03)!
 assert.ok(a);assert.throws(()=>Object.assign(a,{contentSha256:'forged'}));assert.throws(()=>Object.assign(a.scope,{population:'ALL'}))
 ;(l.approved as Map<string,unknown>).clear()
 assert.ok(ledgerApproves(l,'R03',card.version,registry.cardSha256.R03))
})
test('approval cannot be used before review time',async()=>{
 const {key,receipt,sign}=await fixture(),l=await verifyKnowledgeApprovals([await sign()],{trustedKeys:[key]})
 assert.equal(ledgerApproves(l,'R03',card.version,registry.cardSha256.R03,new Date(Date.parse(receipt.reviewedAt)-1).toISOString()),null)
})
test('revocation wins timestamp ties irrespective of receipt naming',async()=>{
 const {key,receipt,sign}=await fixture()
 const l=await verifyKnowledgeApprovals([await sign({...receipt,receiptId:'z'}),await sign({...receipt,receiptId:'a',decision:'REVOKED'})],{trustedKeys:[key]})
 assert.equal(l.approved.size,0)
})
test('conflicting duplicate receipt IDs grant no approval',async()=>{
 const {key,receipt,sign}=await fixture()
 const l=await verifyKnowledgeApprovals([await sign(),await sign({...receipt,decision:'REVOKED'})],{trustedKeys:[key]})
 assert.equal(l.approved.size,0);assert.ok(l.rejected.every(r=>r.reason==='RECEIPT_ID_CONFLICT'))
})
test('receipt object changed during verification cannot change verified scope',async()=>{
 const {key,sign}=await fixture(),r=await sign(),pending=verifyKnowledgeApprovals([r],{trustedKeys:[key]})
 r.scope.population='ALL'
 const l=await pending
 assert.equal(ledgerApproves(l,'R03',card.version,registry.cardSha256.R03)?.scope.population,'ADULT_RUNNER')
})
test('invalid or expired trusted key validity cannot approve',async()=>{
 const {key,sign}=await fixture(),r=await sign()
 for(const changed of [{...key,validFrom:'invalid'},{...key,validUntil:new Date(Date.now()-1000).toISOString()}]) {
  assert.equal((await verifyKnowledgeApprovals([r],{trustedKeys:[changed]})).approved.size,0)
 }
})
