import test from 'node:test';
import assert from 'node:assert/strict';
import {P7_EVIDENCE,selectP7Knowledge,distinctEvidenceGroups,knowledgeDecisionGate} from './coach-p7-knowledge.ts';
test('R187 evidence IDs and DOI candidates are distinct',()=>{
 assert.equal(P7_EVIDENCE.length,7);
 assert.equal(new Set(P7_EVIDENCE.map(x=>x.id)).size,7);
 assert.equal(new Set(P7_EVIDENCE.filter(x=>x.doi).map(x=>x.doi)).size,6);
});
test('no candidate evidence can score or prescribe',()=>{
 for(const c of P7_EVIDENCE){
  assert.equal(c.canScoreAbility,false);
  assert.equal(c.canApproveTrainingDose,false);
  assert.equal(c.canAuthorizeMedicalReturn,false);
 }
});
test('DFA a1 never becomes resting Garmin HRV threshold',()=>{
 const x=selectP7Knowledge({domains:['HRV'],topic:'dfa-a1-threshold',audience:'ATHLETE'});
 assert.equal(x.length,1);
 assert.equal(x[0].usage,'LIMITED_EXPLANATION');
 assert.equal(knowledgeDecisionGate(x[0]).allowAutomaticDose,false);
 assert.ok(x[0].card.forbidden.includes('resting-HRV-as-LT1'));
});
test('PFP overlapping reviews are not counted as independent experiments',()=>{
 const p=selectP7Knowledge({domains:['PAIN'],topic:'patellofemoral-pain-gait-retraining',audience:'COACH'});
 assert.equal(p.length,2);
 assert.equal(distinctEvidenceGroups(p.map(x=>x.card)),1);
 assert.ok(p.every(x=>!knowledgeDecisionGate(x).allowExplanation));
});
test('clinical hamstring evidence cannot clear sprinting',()=>{
 const p=selectP7Knowledge({domains:['RTR'],audience:'ATHLETE'});
 assert.equal(p.length,2);
 assert.ok(p.every(x=>x.usage==='PROFESSIONAL_REVIEW'));
 assert.ok(p.every(x=>!knowledgeDecisionGate(x).allowMedicalClearance));
});
test('ability norm not approved, radar score blocked',()=>{
 const p=selectP7Knowledge({domains:['SPD'],audience:'COACH'});
 assert.equal(p.length,1);
 assert.equal(p[0].usage,'HOLD_ONLY');
 assert.equal(knowledgeDecisionGate(p[0]).allowNumericScore,false);
});
