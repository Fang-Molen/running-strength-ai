import test from 'node:test'
import assert from 'node:assert/strict'
import {verifyKnowledgeApprovals,approvalSigningPayload,type KnowledgeApprovalReceipt,type TrustedReviewerKey} from './approval.ts'
import {formalKnowledgeSection} from './complete.ts'
import registry from '../../../../knowledge/coach-complete-20261020/registry.json' with {type:'json'}
import cards from '../../../../knowledge/coach-complete-20261020/knowledge_cards.json' with {type:'json'}
test('personal application requires matching approved population, declared prerequisites and task',async()=>{
 const c=cards.find(x=>x.id==='R03')!,pair=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']) as CryptoKeyPair
 const key:TrustedReviewerKey={keyId:'scope-test',reviewerId:'human-reviewer',role:'HUMAN_PROFESSIONAL',publicKey:Buffer.from(await crypto.subtle.exportKey('raw',pair.publicKey)).toString('base64'),validFrom:registry.importedAt,validUntil:null}
 const r:Omit<KnowledgeApprovalReceipt,'signature'>={schema:'FK-KNOWLEDGE-APPROVAL-1',receiptId:'scope',catalog:'FK-COACH-KNOWLEDGE-COMPLETE-20261020',cardId:c.id,cardVersion:c.version,contentSha256:registry.cardSha256.R03,sourceSha256:Object.fromEntries(c.source_ids.map(id=>[id,(registry.sourceSha256 as Record<string,string>)[id]])),decision:'APPROVED',scope:{population:'ADULT_RUNNER',note:'test',usage:'PERSONAL_ANALYSIS'},reviewer:{id:key.reviewerId,role:key.role},reviewedAt:new Date(Date.now()-1000).toISOString(),keyId:key.keyId}
 const receipt={...r,signature:Buffer.from(await crypto.subtle.sign('Ed25519',pair.privateKey,approvalSigningPayload(r))).toString('base64')}
 const ledger=await verifyKnowledgeApprovals([receipt],{trustedKeys:[key]})
 const base={purpose:'PERSONAL_ANALYSIS' as const,population:'ADULT_RUNNER',task:'review' as const,verifiedFactKeys:['segment_times','segment_distances']}
 const q='我的跑步分段均值和首尾差'
 assert.equal(formalKnowledgeSection(q,undefined,ledger),null)
 assert.equal(formalKnowledgeSection(q,undefined,ledger,{...base,population:null}),null)
 assert.equal(formalKnowledgeSection(q,undefined,ledger,{...base,population:'YOUTH_RUNNER'}),null)
 assert.equal(formalKnowledgeSection(q,undefined,ledger,{...base,verifiedFactKeys:['segment_times']}),null)
 assert.equal(formalKnowledgeSection(q,undefined,ledger,{...base,task:'plan'}),null)
 assert.equal(formalKnowledgeSection(q,undefined,ledger,{...base,purpose:'GENERAL_EDUCATION'}),null)
 assert.deepEqual(formalKnowledgeSection(q,undefined,ledger,base)?.uses.map(u=>u.cardId),['R03'])
 assert.equal(formalKnowledgeSection(q,new Date(Date.parse(r.reviewedAt)-1).toISOString(),ledger,base),null)
})
