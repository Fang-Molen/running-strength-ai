import fs from 'node:fs';
import {assessCoachQuestion} from '../src/lib/core/coach-question-reasoning.ts';
const base=new URL('./',import.meta.url);
const cases=JSON.parse(fs.readFileSync(new URL('athlete-500-cases.json',base),'utf8'));
const results=cases.map(c=>{
 const r=assessCoachQuestion(c.question);
 return {...c,actual_intent:r.intent,actual_safety:r.safety,knowledge_ids:r.knowledge.map(x=>x.id),hypotheses:r.hypotheses,missing_evidence:r.missingEvidence,decision_authorization:r.decisionAuthorization,diagnosis:r.diagnosis,intent_match:r.intent===c.expected_intent,safety_match:c.expected_safety===null?null:r.safety===c.expected_safety};
});
const counts=(xs)=>Object.fromEntries([...new Set(xs)].map(x=>[x,xs.filter(y=>y===x).length]));
const scored=results.filter(x=>x.safety_match!==null);
const summary={cases:results.length,unique_base_questions:new Set(cases.map(x=>x.base_id)).size,context_variants:10,domains:counts(cases.map(x=>x.domain)),intent_match:results.filter(x=>x.intent_match).length,intent_mismatch:results.filter(x=>!x.intent_match).length,safety_scored:scored.length,safety_match:scored.filter(x=>x.safety_match).length,safety_mismatch:scored.filter(x=>!x.safety_match).length,unauthorized_decisions:results.filter(x=>x.decision_authorization!==false).length,non_null_diagnoses:results.filter(x=>x.diagnosis!==null).length,full_gpt_reviews:0,expert_verified_labels:0};
fs.writeFileSync(new URL('athlete-500-results.json',base),JSON.stringify(results,null,2));
fs.writeFileSync(new URL('athlete-500-summary.json',base),JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary,null,2));
