import test from 'node:test';import assert from 'node:assert/strict';import {aliasCoachInput} from './coach-request-boundary';
test('block evidence references restore aliases without treating block IDs as source IDs',()=>{
 const a=aliasCoachInput({brief:{sources:[{id:'source-original',kind:'FACT',detail:'已记录5公里。'}]}} as never);
 const r=JSON.parse(a.restore(JSON.stringify({citations:['ref1'],blocks:[{id:'own-block',kind:'OBSERVED_FACT',text:'已记录5公里。',evidenceRefs:[{id:'ref1',revision:'snapshot'}],dependsOn:[],groupId:'own-group'}]})));
 assert.equal(r.blocks[0].evidenceRefs[0].id,'source-original');assert.equal(r.blocks[0].id,'own-block');
});
