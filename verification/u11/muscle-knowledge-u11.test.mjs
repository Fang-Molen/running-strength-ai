import test from 'node:test';import assert from 'node:assert/strict';import {muscleKnowledgeContext} from '../../src/lib/health/muscle-knowledge-u11.ts';import {buildMuscleReview} from '../../src/lib/health/muscle-recovery-u11.ts';
const review=buildMuscleReview({athleteId:'a',asOf:'2026-10-20T20:00:00Z',parts:[{athleteId:'a',eventId:'r',sourceId:'app',occurredAt:'2026-10-20T12:00:00Z',knownAt:'2026-10-20T13:00:00Z',modality:'RUN',runType:'INTERVAL',actual:'CONFIRMED'}],symptoms:[]});
const c=(status='APPROVED',topic='STRENGTH_RECOVERY')=>({id:'k1',sourceRef:'ref',status,topic,regions:['quads'],claim:'study summary'});
test('approved strength knowledge is contextual only',()=>{const x=muscleKnowledgeContext(review,[c()]);assert.ok(x.find(r=>r.region==='quads').cardIds.includes('k1'))});
test('candidate knowledge cannot become advice basis',()=>{const x=muscleKnowledgeContext(review,[c('CANDIDATE')]);assert.equal(x.find(r=>r.region==='quads').cardIds.length,0)});
test('rejected knowledge excluded',()=>assert.equal(muscleKnowledgeContext(review,[c('REJECTED')]).find(r=>r.region==='quads').cardIds.length,0));
test('missing source ref excluded',()=>assert.equal(muscleKnowledgeContext(review,[{...c(),sourceRef:''}]).find(r=>r.region==='quads').cardIds.length,0));
test('unrelated region excluded',()=>assert.equal(muscleKnowledgeContext(review,[{...c(),regions:['chest']}]).find(r=>r.region==='quads').cardIds.length,0));
