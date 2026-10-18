import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';
import {makeInternalPreview,validateBundle,verifyInternalPreview} from './index.ts';
import type {ApprovedCoachBundle,DialogueContext,DepthMode} from './index.ts';
interface Fixture {
  case_id: string; dimension:string;
  context:DialogueContext; bundle:ApprovedCoachBundle;
  expect:{mode:DepthMode; requiredClaimIds:string[]; expectedQuestionId:string|null; noDelivery:true};
}
const content=readFileSync('quality/dialogue-e1/public_dev_42.jsonl','utf8').trim();
const fixtures=content.split('\n').map(line=>JSON.parse(line) as Fixture);

test('the public bank contains exactly 42 fixtures (7 for each of 6 axes)',()=>{
  assert.equal(fixtures.length,42);
  const counts=new Map<string,number>();
  for (const f of fixtures) counts.set(f.dimension,(counts.get(f.dimension)??0)+1);
  assert.equal(counts.size,6);
  for (const n of counts.values()) assert.equal(n,7);
});
for (const f of fixtures) {
  test(`${f.case_id}: approved-only dialogue contract`,()=>{
    const valid=validateBundle(f.bundle);
    assert.equal(valid.pass,true);
    const p=makeInternalPreview(f.bundle,f.context);
    assert.equal(p.mode,f.expect.mode);
    assert.equal(p.bundleId,f.case_id);
    assert.equal(p.authorizedForDelivery,false);
    assert.equal(p.modifiesPlan,false);
    assert.equal(p.selectedQuestionId,f.expect.expectedQuestionId);
    assert.equal(p.segments.filter(x=>x.kind==='question').length,p.selectedQuestionId?1:0);
    for (const id of f.expect.requiredClaimIds) assert.ok(p.usedApprovedClaimIds.includes(id));
    const recheck=verifyInternalPreview(f.bundle,f.context,p);
    assert.equal(recheck.pass,true);
    // A strict protected statement must never be rewritten, not even one decimal place.
    for (const c of f.bundle.claims.filter(x=>x.priority==='required')) assert.ok(p.renderedText.includes(c.text));
  });
}
