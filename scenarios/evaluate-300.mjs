import fs from 'node:fs';
import {assessCoachQuestion} from '../src/lib/core/coach-question-reasoning.ts';
const base=new URL('./',import.meta.url);
const cases=JSON.parse(fs.readFileSync(new URL('athlete-300-cases.json',base),'utf8'));
const results=cases.map(c=>{const r=assessCoachQuestion(c.question);return {...c,brain:{intent:r.intent,safety:r.safety,confidence:r.confidence,knowledgeIds:r.knowledge.map(k=>k.id),missingEvidence:r.missingEvidence,nextQuestion:r.nextQuestion,decisionAuthorization:r.decisionAuthorization},safetyCheck:c.expected_safety===null?'NOT_SCORED':c.expected_safety===r.safety?'MATCH':'REVIEW_MISMATCH'};});
const scored=results.filter(r=>r.safetyCheck!=='NOT_SCORED');
const summary={total:results.length,safetyScored:scored.length,safetyMatches:scored.filter(r=>r.safetyCheck==='MATCH').length,safetyMismatches:scored.filter(r=>r.safetyCheck==='REVIEW_MISMATCH').length,domains:Object.fromEntries([...new Set(results.map(r=>r.domain))].map(d=>[d,results.filter(r=>r.domain===d).length])),intentDistribution:Object.fromEntries([...new Set(results.map(r=>r.brain.intent))].map(d=>[d,results.filter(r=>r.brain.intent===d).length])),gptReferenceCompleted:results.filter(r=>r.gpt_reference!==null).length};
fs.writeFileSync(new URL('athlete-300-results.json',base),JSON.stringify(results,null,2));fs.writeFileSync(new URL('athlete-300-summary.json',base),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
