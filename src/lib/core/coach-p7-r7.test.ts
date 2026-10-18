import test from 'node:test';
import assert from 'node:assert/strict';
import {setStoreBackend} from './storage.ts';
import {p7CommitDecision,p7CommitLiveDecision,p7CommitOutcome,p7CommitSourceRevision,p7Project} from './coach-p7-lifecycle.ts';
import {P7_EVIDENCE_VERSION} from './coach-p7-knowledge.ts';
import type {DecisionSnapshot,OutcomeSnapshot} from './coach-decision-calibration.ts';
const map=new Map<string,string>();
setStoreBackend({getItem:k=>map.get(k)??null,setItem:(k,v)=>{map.set(k,v)},keys:()=>[...map.keys()]});
const now=Date.now(), iso=(t:number)=>new Date(t).toISOString();
function make(id:string):DecisionSnapshot{return {
 id,athleteId:id,actor:'FANGKUN',caseId:'C',createdAt:iso(now),evidenceCutoff:iso(now-1000),
 sources:[{sourceId:'old-run',revision:'v1'}],hypothesis:'fatigue',alternative:'pacing',metricId:'time',protocolKey:'photo-finish',unit:'s',forecastValue:110,
 forecastDirection:'LOWER_BETTER',observationDueAt:iso(now+86400000),uncertaintyNote:'unvalidated',safetyHold:false,planWrite:false,
 knowledgeEvidenceIds:['R187-E07'],knowledgeVersion:P7_EVIDENCE_VERSION
};}
function outcome(d:DecisionSnapshot):OutcomeSnapshot{return {id:`out-${d.id}`,athleteId:d.athleteId,caseId:d.caseId,
 observedAt:iso(now+3600000),recordedAt:iso(now+3601000),source:{sourceId:'new-race',revision:'v1'},metricId:'time',protocolKey:'photo-finish',unit:'s',value:111,measurementValid:true};}
test('historical decision cannot become a scored pre-outcome prediction',()=>{
 const d=make('legacy-r7');assert.equal(p7CommitDecision(d).ok,true);
 const a=p7Project(d.athleteId,{'old-run':'v1'});
 assert.equal(a.results[0].reason,'LEGACY_NOT_LIVE_PRECOMMITTED');assert.equal(a.calibration.eligibleCount,0);
});
test('live commit uses real clock and never caller controlled timestamp',()=>{
 const d=make('live-r7');assert.equal(p7CommitLiveDecision(d).ok,true);
 assert.equal(p7CommitLiveDecision({...make('backdated-r7'),createdAt:iso(now-3600000)}).reason,'NOT_LIVE_PRECOMMITMENT');
});
test('unverified journal source revision cannot override authoritative current facts',()=>{
 const d=make('revision-r7');assert.equal(p7CommitLiveDecision(d).ok,true);
 assert.equal(p7CommitSourceRevision(d.athleteId,'old-run','v2',iso(now)),true);
 assert.equal(p7Project(d.athleteId,{'old-run':'v1'}).results[0].state,'PENDING');
 assert.equal(p7Project(d.athleteId,{'old-run':'v2'}).results[0].state,'SUPERSEDED');
 assert.equal(p7Project(d.athleteId,{}).calibration.eligibleCount,0);
});
test('cannot attach an outcome that occurred before actual live commit, even within 2-minute grace',()=>{
 const d={...make('retro-r7'),createdAt:iso(now-30000),evidenceCutoff:iso(now-31000)};
 assert.equal(p7CommitLiveDecision(d).ok,true);
 const retro:OutcomeSnapshot={id:'retro-out',athleteId:d.athleteId,caseId:d.caseId,
 observedAt:iso(now-15000),recordedAt:iso(now-10000),source:{sourceId:'new-race',revision:'v1'},metricId:'time',protocolKey:d.protocolKey,unit:'s',value:109,measurementValid:true};
 assert.equal(p7CommitOutcome(d.id,retro).reason,'INVALID_OUTCOME');
});

test('actual post-commit outcome is eligible for descriptive calibration, never auto-update',async()=>{
 const d={...make('valid-live-r7'),createdAt:new Date().toISOString()};
 assert.equal(p7CommitLiveDecision(d).ok,true);
 await new Promise(resolve=>setTimeout(resolve,40));
 const stamp=new Date().toISOString();
 const actual:OutcomeSnapshot={id:'valid-live-outcome',athleteId:d.athleteId,caseId:d.caseId,
  observedAt:stamp,recordedAt:stamp,source:{sourceId:'new-race',revision:'v1'},
  metricId:d.metricId,protocolKey:d.protocolKey,unit:d.unit,value:111,measurementValid:true};
 assert.equal(p7CommitOutcome(d.id,actual).ok,true);
 const x=p7Project(d.athleteId,{'old-run':'v1','new-race':'v1'});
 assert.equal(x.calibration.eligibleCount,1);assert.equal(x.calibration.mae,1);
 assert.equal(x.autonomousRuleUpdateAuthorized,false);
});
