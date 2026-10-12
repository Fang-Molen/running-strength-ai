import test from 'node:test'
import assert from 'node:assert/strict'
import {assessM3PersonalResponse,projectM7Reasoning,type ResponseEvidence} from './coach-learning-readiness.ts'
const record=(n:number):ResponseEvidence=>({occurrenceId:`s${n}`,sessionContext:'400m repeats',completed:true,sessionRpe:7,recovery24h:5,recovery48h:7,sourceIds:[`training:${n}`,`recovery:${n}`],painReported:false})
test('single session cannot become stable response',()=>assert.equal(assessM3PersonalResponse([record(1)],'400m repeats').status,'INSUFFICIENT'))
test('three distinct sessions become candidate only',()=>{const r=assessM3PersonalResponse([record(1),record(2),record(3)],'400m repeats');assert.equal(r.status,'CANDIDATE');assert.match(r.statement,/低置信度/)})
test('duplicates do not inflate evidence count',()=>assert.equal(assessM3PersonalResponse([record(1),record(1),record(2)],'400m repeats').count,2))
test('unbound evidence not counted',()=>{const r=record(3);r.sourceIds=[];assert.equal(assessM3PersonalResponse([record(1),record(2),r],'400m repeats').status,'INSUFFICIENT')})
test('missing recovery does not count',()=>{const r=record(3);r.recovery48h=null;assert.equal(assessM3PersonalResponse([record(1),record(2),r],'400m repeats').count,2)})
test('other context not mixed',()=>{const r=record(3);r.sessionContext='long run';assert.equal(assessM3PersonalResponse([record(1),record(2),r],'400m repeats').count,2)})
test('pain overrides repeated observations',()=>{const r=record(3);r.painReported=true;assert.equal(assessM3PersonalResponse([record(1),record(2),r],'400m repeats').status,'CONFLICT')})
test('contradictory recovery remains conflict',()=>{const r=record(3);r.recovery48h=2;assert.equal(assessM3PersonalResponse([record(1),record(2),r],'400m repeats').status,'CONFLICT')})
test('M7 projects actual audit, never automatic decision',()=>{const p:any={name:'p',sessions:[],coachEditHistory:[{id:'a1',proposalId:'p1',action:'APPLY',revision:1,timestamp:'2026-10-10T00:00:00Z'}]};const r=projectM7Reasoning(p);assert.equal(r[0]?.automaticDecision,false);assert.equal(r[0]?.basis,'USER_CONFIRMED_PREVIEW')})
