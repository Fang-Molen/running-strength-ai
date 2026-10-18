import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';
import {makeInternalPreview, verifyInternalPreview} from './index.ts';
import type {ApprovedCoachBundle, DialogueContext, DepthMode} from './index.ts';
interface Turn {bundle:ApprovedCoachBundle;context:DialogueContext;expect:{mode:DepthMode;selectedQuestionId:string|null;factVersion:string}}
interface Scenario {scenario_id:string; label:string;turns:Turn[]}
const s:Scenario[]=readFileSync('quality/dialogue-e1/public_multiturn_6x3.jsonl','utf8').trim().split('\n').map(x=>JSON.parse(x) as Scenario);
test('6 actual multi-turn public sequences, 18 frozen turns',()=>{
  assert.equal(s.length,6);assert.equal(s.reduce((a,x)=>a+x.turns.length,0),18);
});
for(const f of s) test(`${f.scenario_id} three-turn version and dialogue continuity`,()=>{
  assert.equal(f.turns.length,3);
  for(const t of f.turns){
    const out=makeInternalPreview(t.bundle,t.context);
    assert.equal(out.factVersion,t.expect.factVersion);
    assert.equal(out.mode,t.expect.mode);
    assert.equal(out.selectedQuestionId,t.expect.selectedQuestionId);
    assert.equal(verifyInternalPreview(t.bundle,t.context,out).pass,true);
    assert.equal(out.authorizedForDelivery,false);
  }
});
test('oral correction does not alter source, official correction does',()=>{
  const turns=s.find(x=>x.scenario_id==='MT01')!.turns;
  assert.equal(turns[0]!.bundle.factVersion,'record-r1');
  assert.equal(turns[1]!.bundle.factVersion,'record-r1');
  assert.equal(turns[2]!.bundle.factVersion,'record-r2');
  assert.equal(turns[2]!.bundle.revokedSourceIds?.includes('evt100-r1'),true);
  const p=makeInternalPreview(turns[2]!.bundle,turns[2]!.context);
  assert.ok(p.usedApprovedClaimIds.includes('MT01-x3'));
});
test('switching users never carries previously approved PB statement',()=>{
  const turns=s.find(x=>x.scenario_id==='MT06')!.turns;
  const b=makeInternalPreview(turns[1]!.bundle,turns[1]!.context);
  assert.doesNotMatch(b.renderedText,/2分00秒/);
});
