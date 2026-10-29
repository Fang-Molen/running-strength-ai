/** Saved paid replies only: no fetch or supplier calls. ALL_HISTORY is a test
 * transport baseline with a 26k input envelope, never App HTTP acceptance. */
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {validateProviderReply} from '../../../server/coach-deepseek/lib/coach-provider-boundary';
import {supportedEvidenceQuote} from '../../../src/lib/coach/question-evidence';
import {computedCoachQuotes} from '../../../src/lib/coach/context-comparison';
import {validateCoachAssertions,retainValidCoachSentences} from '../../../src/lib/coach/assertion-policy';
const dir='verification/new-questions-20261029/completion-run/';
const rows=(name:string)=>readFileSync(dir+name,'utf8').trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));
const calls=rows('calls.jsonl'),dispatches=rows('dispatches.jsonl');
const output=[];
for(const c of ['T01','T02','T03']){
 const phase=c==='T03'?'final4':'final3',id=phase+'-'+c+'-ALL_HISTORY-1';
 const call=calls.find(r=>r.requestId===id),dispatch=dispatches.find(r=>r.requestId===id),live=rows(phase+'-results.jsonl').find(r=>r.path_id===c+'-ALL_HISTORY');
 const raw=validateProviderReply(call.reply,{acceptedResponseModels:['deepseek-flash']} as any,{inputTokenLimit:26000,outputTokenLimit:1800});
 const parsed=JSON.parse(raw),wire=JSON.parse(dispatch.payload.messages[1].content),claims=parsed.evidenceQuotes??[];
 assert.ok(Array.isArray(claims));
 assert.ok(parsed.citations.every((id:string)=>wire.facts.some((s:any)=>s.id===id)));
 assert.ok(claims.every((q:any)=>Object.keys(q).every(k=>['sourceId','quote'].includes(k))&&parsed.citations.includes(q.sourceId)&&wire.facts.some((s:any)=>s.kind==='FACT'&&s.id===q.sourceId&&supportedEvidenceQuote(s.detail,q.quote))));
 const options={question:wire.question,safetyRestricted:wire.safety.trainingRestricted,factQuotes:claims.map((q:any)=>q.quote),citedQuotes:claims.map((q:any)=>q.quote)};
 const prose=parsed.text.replace(/[（(\[]((?:ref)\d+)[）)\]]/g,(marker:string,id:string)=>parsed.citations.includes(id)?'':marker);
 let text=[...claims.filter((q:any)=>!prose.includes(q.quote)).map((q:any)=>q.quote),prose,parsed.nextStep??''].join('\n');
 if(!validateCoachAssertions(text,options).ok)text=retainValidCoachSentences(text,options);
 assert.ok(text&&validateCoachAssertions(text,options).ok);
 const computedQuotes=computedCoachQuotes(wire.question,live.context);text=[text,...computedQuotes].join('\n');
 output.push({...live,paid:false,phase:'uniform-baseline',paidReceipt:id,payloadHash:dispatch.payloadHash,clientResult:null,result:{http:null,body:{ok:true,text,computedQuotes,validation:'OFFLINE_SAVED_REPLY_TEST_BASELINE_NOT_APP_HTTP_ACCEPTANCE'}}});
}
writeFileSync(dir+'uniform-baseline-offline.jsonl',output.map(r=>JSON.stringify(r)).join('\n')+'\n');
console.log(JSON.stringify({savedPaidReplies:3,passed:output.length,newRequests:0}));
