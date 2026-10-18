import test from 'node:test';
import assert from 'node:assert/strict';
import {setStoreBackend} from './storage.ts';
import {p7CommitLiveDecision,p7CommitDecision,p7CommitOutcome,p7Project} from './coach-p7-lifecycle.ts';
import {P7_EVIDENCE_VERSION} from './coach-p7-knowledge.ts';
import type {DecisionSnapshot,OutcomeSnapshot} from './coach-decision-calibration.ts';
const db=new Map<string,string>();
setStoreBackend({getItem:k=>db.get(k)??null,setItem:(k,v)=>{db.set(k,v)},keys:()=>[...db.keys()]});
const now=Date.now();
const iso=(ms:number)=>new Date(ms).toISOString();
let counter=0;
function make(actor:'FANGKUN'|'HUMAN_COACH', athleteId:string):DecisionSnapshot{
 return {id:`r187-${++counter}`,athleteId,actor,caseId:'same-case',createdAt:iso(now),
 evidenceCutoff:iso(now-1000),sources:[{sourceId:'src',revision:'v1'}],hypothesis:'uncertain performance',
 alternative:'environment',metricId:'time',protocolKey:'electronic',unit:'s',forecastValue:110,
 forecastDirection:'LOWER_BETTER',observationDueAt:iso(now+86400000),uncertaintyNote:'no causal claim',
 safetyHold:false,planWrite:false,knowledgeEvidenceIds:['R187-E07'],knowledgeVersion:P7_EVIDENCE_VERSION};
}
function outcome(d:DecisionSnapshot,sourceId:string):OutcomeSnapshot{
 return {id:`out-${d.id}`,athleteId:d.athleteId,caseId:d.caseId,observedAt:iso(now-86400000),
 recordedAt:iso(now-86300000),source:{sourceId,revision:'v1'},metricId:'time',protocolKey:'electronic',
 unit:'s',value:111,measurementValid:true};
}
test('new live decision refuses retrospective backfill and unknown evidence',()=>{
 const d=make('FANGKUN','r187-live');
 assert.equal(p7CommitLiveDecision({...d,createdAt:iso(now-86400000)}).reason,'NOT_LIVE_PRECOMMITMENT');
 assert.equal(p7CommitLiveDecision({...d,knowledgeEvidenceIds:['invented']}).reason,'UNVERIFIED_KNOWLEDGE_PROVENANCE');
 assert.equal(p7CommitLiveDecision(d).ok,true);
});
test('blind comparison refuses different outcome sources despite matching case',()=>{
 const a={...make('FANGKUN','r187-pair'),createdAt:iso(now-172800000),evidenceCutoff:iso(now-172801000),observationDueAt:iso(now-43200000)},
 b={...make('HUMAN_COACH','r187-pair'),createdAt:iso(now-172800000),evidenceCutoff:iso(now-172801000),observationDueAt:iso(now-43200000)};
 assert.equal(p7CommitDecision(a).ok,true);
 assert.equal(p7CommitDecision(b).ok,true);
 assert.equal(p7CommitOutcome(a.id,outcome(a,'outcome-a')).ok,true);
 assert.equal(p7CommitOutcome(b.id,outcome(b,'outcome-b')).ok,true);
 const projection=p7Project('r187-pair',{src:'v1','outcome-a':'v1','outcome-b':'v1'});
 assert.equal(projection.calibration.eligibleCount,0);
 assert.ok(projection.results.every(x=>x.reason==='LEGACY_NOT_LIVE_PRECOMMITTED'));
 assert.equal(projection.blindComparison.pairedN,0);
});
