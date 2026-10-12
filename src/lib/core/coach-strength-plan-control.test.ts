import test from 'node:test'
import assert from 'node:assert/strict'
import {applyStrengthReduction,proposeStrengthReduction,rollbackStrengthReduction,type StrengthControl} from './coach-strength-plan-control.ts'
import type {Plan} from '../strength/model.ts'
const plan=():Plan=>({name:'跑步力量',sessions:[{id:'s1',name:'力量课',moves:[{id:'m1',catalogId:null,customName:'深蹲',sets:4,mode:'reps',amount:8,restSec:90,weightKg:60}]}],cycle:{block:1,week:1,logs:[],lastChange:''}})
const control=():StrengthControl=>({previewUnlocked:true,athleteConfirmed:true,confirmedProposalId:'strength:s1:m1:0',hasTrainingStartedToday:false,unresolvedPain:false,timestamp:'2026-10-11T01:00:00Z'})
function setup(){const p=plan();const q=proposeStrengthReduction(p,'s1','m1');if(!q)throw Error('no proposal');return {p,q}}
test('reduce one set only, retain original and audit',()=>{const {p,q}=setup();const r=applyStrengthReduction(p,q,control());assert.equal(r.ok,true);if(!r.ok)return;assert.equal(p.sessions[0]?.moves[0]?.sets,4);assert.equal(r.plan.sessions[0]?.moves[0]?.sets,3);assert.equal(r.plan.sessions[0]?.moves[0]?.weightKg,60);assert.equal(r.plan.coachEditHistory?.[0]?.before.moves[0]?.sets,4)})
test('missing preview unlock denied',()=>{const {p,q}=setup();const c=control();c.previewUnlocked=false;assert.equal(applyStrengthReduction(p,q,c).ok,false)})
test('missing athlete confirmation denied',()=>{const {p,q}=setup();const c=control();c.athleteConfirmed=false;assert.equal(applyStrengthReduction(p,q,c).ok,false)})
test('wrong proposal ID denied',()=>{const {p,q}=setup();const c=control();c.confirmedProposalId='wrong';assert.equal(applyStrengthReduction(p,q,c).ok,false)})
test('stale plan denied',()=>{const {p,q}=setup();p.name='new';assert.equal(applyStrengthReduction(p,q,control()).ok,false)})
test('started today denied',()=>{const {p,q}=setup();const c=control();c.hasTrainingStartedToday=true;assert.equal(applyStrengthReduction(p,q,c).ok,false)})
test('unresolved pain denied',()=>{const {p,q}=setup();const c=control();c.unresolvedPain=true;assert.equal(applyStrengthReduction(p,q,c).ok,false)})
test('pain log denied',()=>{const {p,q}=setup();p.cycle!.logs.push({sessionId:'other',feel:'pain',painIds:[],note:''});assert.equal(applyStrengthReduction(p,q,control()).ok,false)})
test('completed current cycle denied',()=>{const {p,q}=setup();p.cycle!.logs.push({sessionId:'s1',feel:'ok',painIds:[],note:''});assert.equal(applyStrengthReduction(p,q,control()).ok,false)})
test('cannot reduce a one-set move',()=>{const p=plan();p.sessions[0]!.moves[0]!.sets=1;assert.equal(proposeStrengthReduction(p,'s1','m1'),null)})
test('rollback preserves append-only journal and original set',()=>{const {p,q}=setup();const r=applyStrengthReduction(p,q,control());if(!r.ok)throw Error('setup');const c=control();const b=rollbackStrengthReduction(r.plan,c);assert.equal(b.ok,true);if(!b.ok)return;assert.equal(b.plan.sessions[0]?.moves[0]?.sets,4);assert.equal(b.plan.coachEditHistory?.length,2);assert.equal(b.plan.coachEditHistory?.[1]?.action,'ROLLBACK')})
test('rollback denied if manually changed after apply',()=>{const {p,q}=setup();const r=applyStrengthReduction(p,q,control());if(!r.ok)throw Error('setup');r.plan.sessions[0]!.moves[0]!.amount=9;assert.equal(rollbackStrengthReduction(r.plan,control()).ok,false)})
test('rollback denied after training logged',()=>{const {p,q}=setup();const r=applyStrengthReduction(p,q,control());if(!r.ok)throw Error('setup');r.plan.cycle!.logs.push({sessionId:'s1',feel:'ok',painIds:[],note:''});assert.equal(rollbackStrengthReduction(r.plan,control()).ok,false)})
test('no repeated rollback',()=>{const {p,q}=setup();const r=applyStrengthReduction(p,q,control());if(!r.ok)throw Error('setup');const b=rollbackStrengthReduction(r.plan,control());if(!b.ok)throw Error('setup2');assert.equal(rollbackStrengthReduction(b.plan,control()).ok,false)})
