/** Saved reply downstream replay, no network or model calls; original provider
 * input semantics are retained. Does not prove new facts are understood by a model. */
import {readFileSync,writeFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {validateFinalAnswer} from '../../src/lib/coach/answer-gate';import {computedCoachQuotes} from '../../src/lib/coach/context-comparison';
const out='verification/validation-gates-v1-20261029',old='verification/new-questions-20261029/completion-run/';
const read=(f:string)=>readFileSync(f,'utf8').trim().split('\n').map(l=>JSON.parse(l));
const cases=JSON.parse(readFileSync(out+'/input-package/evidence/旧测试原答与过滤后回答.json','utf8'));
const dispatches=read(old+'dispatches.jsonl'),calls=read(old+'calls.jsonl');const rows=[...read(old+'final3-results.jsonl'),...read(old+'final4-results.jsonl')];
const candidateCommit=readFileSync('.git/HEAD','utf8').trim().replace(/^ref: (.+)$/,(_m,ref)=>readFileSync('.git/'+ref,'utf8').trim());
const results=[];
for(const c of cases){const d=dispatches.find(r=>r.requestId===c.selected_paid_receipt),wire=JSON.parse(d.payload.messages[1].content),r=rows.find(r=>r.path_id===c.path_id&&r.turn===c.turn&&d.requestId.startsWith(r.phase+'-'));
 const gate=validateFinalAnswer({question:c.question,candidate:c.raw_model_json,sources:wire.facts,context:r.context,computedQuotes:computedCoachQuotes(c.question,r.context),safetyRestricted:wire.safety.trainingRestricted,now:'2026-10-29T12:00:01Z'});
 results.push({candidate_commit:candidateCommit,path_id:c.path_id,turn:c.turn,run_scope:'SAVED_REPLY_REPLAY',original_paid_receipt:c.selected_paid_receipt,original_payload_hash:d.payloadHash,replay_input_hash:createHash('sha256').update(JSON.stringify({question:c.question,raw:c.raw_model_json,sources:wire.facts,context:r.context})).digest('hex'),raw:c.raw_model_json,old_final:c.final_text,new_final:gate.text,answerGate:gate,original_usage:calls.find(r=>r.requestId===c.selected_paid_receipt)?.reply.usage??null,new_paid_requests:0,new_tokens:0,note:'Old model input retained for downstream comparison. Evidence semantics changed in the new request builder; this replay is not a new-generation understanding test.'});
 console.log(c.path_id,c.turn,gate.decision,gate.reasonCodes.join(','));
}
writeFileSync(out+'/legacy-replay-results.jsonl',results.map(r=>JSON.stringify(r)).join('\n')+'\n');
