// @ts-nocheck — R1 候选测试原样保留（JS 夹具未标类型）
import test from 'node:test'
import assert from 'node:assert/strict'
import { v4MovedOut, v4MovedIn, canEnsureV4Original, previewV4Move, rehearseV4Move } from './v4-effective-move.ts'
const base = (p={}) => ({ id:'plan400:2026-10-19:strength',date:'2026-10-19',title:'速度耐力+力量A',kind:'strength',modality:'strength',trainingType:'strength',source:'custom',status:'planned',focus:[],minutes:30,intensity:'MODERATE',lowerHeavy:false,refId:null,...p })
test('original day has no moved badge until actually moved',()=>{assert.equal(v4MovedOut('2026-10-19',[base()]),null);assert.equal(canEnsureV4Original('2026-10-19',[base()]),true)})
test('original moved day has history-only state',()=>{const m=v4MovedOut('2026-10-19',[base({date:'2026-10-20',movedFrom:'2026-10-19'})]);assert.equal(m?.effectiveDate,'2026-10-20');assert.equal(m?.part,'strength');assert.equal(canEnsureV4Original('2026-10-19',[base({date:'2026-10-20'})]),false)})
test('target date still shows moved entry when another plan is present',()=>{const x=v4MovedIn('2026-10-20',[base({date:'2026-10-20'}),base({id:'plan400:2026-10-20:strength',date:'2026-10-20'})]);assert.equal(x.length,1);assert.equal(x[0].sourceDate,'2026-10-19')})
test('missing plan entry does not claim move',()=>{assert.equal(v4MovedOut('2026-10-19',[]),null);assert.deepEqual(v4MovedIn('2026-10-20',[]),[])})
test('invalid dates do not become moves',()=>{assert.equal(v4MovedOut('2026-10-00',[base()]),null);assert.deepEqual(v4MovedIn('bad',[base()]),[])})
test('move preview retains stable identity and reports target existing plans',()=>{const p=previewV4Move([base(),base({id:'other',date:'2026-10-20'})],base().id,'2026-10-20','strength');assert.equal(p.ok,true);assert.deepEqual(p.targetDayExisting,['other']);const moved=rehearseV4Move([base()],p);assert.equal(moved[0].id,base().id);assert.equal(moved[0].date,'2026-10-20');assert.equal(moved[0].movedFrom,'2026-10-19')})
test('duplicate request is not a second move',()=>{const e=base({date:'2026-10-20',movedFrom:'2026-10-19'});assert.deepEqual(previewV4Move([e],e.id,'2026-10-20','strength'),{ok:false,reason:'ALREADY_ON_DATE'})})
test('combined course cannot silently move only strength',()=>{const e=base({modality:'strength',trainingType:'mixed'});assert.deepEqual(previewV4Move([e],e.id,'2026-10-20','strength'),{ok:false,reason:'SPLIT_REQUIRED'})})
test('completed course cannot move actual history',()=>{const e=base({status:'done'});assert.deepEqual(previewV4Move([e],e.id,'2026-10-20','strength'),{ok:false,reason:'ACTIVE_OR_DONE'})})
test('existing actual blocks move',()=>{const e=base({actual:{outcome:'as_planned'}});assert.deepEqual(previewV4Move([e],e.id,'2026-10-20','strength'),{ok:false,reason:'ACTIVE_OR_DONE'})})
test('skipped/rejected blocks ordinary move',()=>{for(const status of ['skipped','rejected'])assert.equal(previewV4Move([base({status})],base().id,'2026-10-20','strength').ok,false)})
test('same ID repeated is conflict not silent first-match',()=>{assert.deepEqual(previewV4Move([base(),base()],base().id,'2026-10-20','strength'),{ok:false,reason:'CONFLICTED_IDENTITY'})})
test('malformed dates fail safely',()=>{assert.deepEqual(previewV4Move([base()],base().id,'2026-02-30','strength'),{ok:false,reason:'INVALID_DATE'})})
test('cannot change unrelated or non-V4 entry',()=>{assert.deepEqual(previewV4Move([base()], 'other','2026-10-20','strength'),{ok:false,reason:'NO_ENTRY'})})
test('can move an already moved course again without losing original source',()=>{const e=base({date:'2026-10-20',movedFrom:'2026-10-19'}),p=previewV4Move([e],e.id,'2026-10-21','strength');assert.equal(p.ok,true);const x=rehearseV4Move([e],p)[0];assert.equal(x.movedFrom,'2026-10-19');assert.equal(x.date,'2026-10-21')})
test('rehearsal does not modify input',()=>{const e=base(),p=previewV4Move([e],e.id,'2026-10-20','strength');rehearseV4Move([e],p);assert.equal(e.date,'2026-10-19');assert.equal(e.movedFrom,undefined)})
test('moving run-only entry preserves modality',()=>{const e=base({modality:'run',trainingType:'run'}),p=previewV4Move([e],e.id,'2026-10-20','run');assert.equal(p.ok,true);assert.equal(v4MovedOut('2026-10-19',rehearseV4Move([e],p)).part,'run')})
test('read-only projection never invents completion',()=>{const e=base({date:'2026-10-20'}),x=v4MovedOut('2026-10-19',[e]);assert.equal(x?.label.includes('完成'),false);assert.equal(e.actual,undefined)})
