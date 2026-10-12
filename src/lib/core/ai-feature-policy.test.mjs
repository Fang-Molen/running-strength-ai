import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {FREE_FEATURES,decideFeatureAccess,decideModelRoute} from './ai-feature-policy.ts';
for(const feature of FREE_FEATURES) test(`${feature} remains free`,()=>assert.deepEqual(decideFeatureAccess(feature),{allowed:true,reason:'FREE_FEATURE',requiresPayment:false}));
/** @type {Parameters<typeof decideModelRoute>[0]} */
const base={route:'metered_remote',online:true,consent:true,serverAuthorized:true,credits:10,cost:2};
test('local model needs no credits',()=>assert.equal(decideModelRoute({...base,route:'local',credits:0}).allowed,true));
test('free remote model needs consent',()=>assert.equal(decideModelRoute({...base,route:'free_remote',consent:false}).allowed,false));
test('free remote model costs no credits',()=>assert.equal(decideModelRoute({...base,route:'free_remote',credits:0}).requiresPayment,false));
test('metered model needs server authorization',()=>assert.equal(decideModelRoute({...base,serverAuthorized:false}).reason,'SERVER_REQUIRED'));
test('metered model requires credits',()=>assert.equal(decideModelRoute({...base,credits:0}).reason,'CREDITS_REQUIRED'));
test('metered model requires explicit consent',()=>assert.equal(decideModelRoute({...base,consent:false}).reason,'CONSENT_REQUIRED'));
test('metered model cannot call offline',()=>assert.equal(decideModelRoute({...base,online:false}).reason,'OFFLINE'));
test('metered model allows verified grant',()=>assert.equal(decideModelRoute(base).allowed,true));
test('invalid negative cost rejected',()=>assert.equal(decideModelRoute({...base,cost:-1}).allowed,false));
