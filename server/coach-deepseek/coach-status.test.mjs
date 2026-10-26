import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequestGet} from './coach-status.js';
test('configuration probe identifies missing bindings without calling any service', async () => {
  const never = () => { throw Error('must not invoke'); };
  const env = {FANGKUN_DEEPSEEK_ENABLED:'true', DEEPSEEK_API_KEY:'must-not-leak'};
  const services = {authenticate:never,loadAuthorizedSnapshot:never,getVerifiedPolicy:never,ledger:{reserve:never,markDispatched:never,settle:never}};
  for (const [context, reason] of /** @type {const} */ ([[{},'SERVICE_DISABLED'],[{env},'TRUSTED_BINDINGS_MISSING'],[{env:{...env,DEEPSEEK_API_KEY:''},data:{fangkunCoachServices:services}},'SERVICE_KEY_MISSING'],[{env,data:{fangkunCoachServices:services}},null]])) {
    const response=onRequestGet(context); const body=await response.json();
    assert.equal(body.reason,reason); assert.equal(body.configured,reason===null);
    assert.equal(body.connectionVerified,false);assert.equal(body.authorizationVerified,false);
    assert.equal(body.billingVerified,false);assert.equal(response.headers.get('cache-control'),'no-store');
    assert.doesNotMatch(JSON.stringify(body),/must-not-leak/);
  }
});
