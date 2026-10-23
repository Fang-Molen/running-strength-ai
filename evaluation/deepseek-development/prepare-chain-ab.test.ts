import test from 'node:test'
import assert from 'node:assert/strict'
import {prepareAB} from './prepare-chain-ab'
import {context,training} from '../../src/lib/health/analysis-fixtures'
test('A/B preparation uses one model and facts, never sends answer keys or makes calls',()=>{const r=prepareAB([{caseId:'A01',context,facts:[training()],provenance:'PUBLIC_SYNTHETIC',frozenVersion:'synthetic-v1'}],'same-approved-model');assert.equal(r.actualApiCalls,0);assert.equal(r.requests.length,2);assert.equal(r.blocked.length,59);assert.equal(r.requests[0].model,r.requests[1].model);assert.equal(r.requests[0].snapshotId,r.requests[1].snapshotId);assert.doesNotMatch(JSON.stringify(r.requests),/expectedMetrics|sourceRecordId|SYN-A/);assert.equal(r.requests[0].inputTokens,null)})
test('Concept-only cases remain BLOCKED instead of pretending all 60 requests are ready',()=>{const r=prepareAB([],'same-model');assert.equal(r.plannedCalls,0);assert.equal(r.blocked.length,60);assert.equal(r.actualProviderTokens,0)})
