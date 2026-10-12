import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { decideAiAccess, canSendAiRequest } from './ai-access-contract.ts';
/** @type {Parameters<typeof decideAiAccess>[0]} */
const base={capability:'cloud_vision',online:true,explicitConsent:true,now:100,estimatedCredits:3,grants:[{capability:'cloud_vision',expiresAt:200,remainingCredits:5}],serverVerified:true};
test('local always available',()=>assert.equal(decideAiAccess({...base,capability:'local_ocr',online:false}).reason,'LOCAL_FREE'));
test('cloud requires online',()=>assert.equal(decideAiAccess({...base,online:false}).reason,'OFFLINE'));
test('cloud requires consent',()=>assert.equal(decideAiAccess({...base,explicitConsent:false}).reason,'CONSENT_REQUIRED'));
test('unverified coupon cannot authorize',()=>assert.equal(decideAiAccess({...base,serverVerified:false}).reason,'SERVER_REQUIRED'));
test('expired grant rejected',()=>assert.equal(decideAiAccess({...base,now:200}).reason,'NO_ENTITLEMENT'));
test('insufficient balance rejected',()=>assert.equal(decideAiAccess({...base,estimatedCredits:6}).reason,'INSUFFICIENT_CREDITS'));
test('verified valid grant permits request',()=>assert.equal(decideAiAccess(base).reason,'AUTHORIZED'));
test('upload requires user confirmation',()=>assert.equal(canSendAiRequest({capability:'cloud_vision',imageIds:['img1'],userConfirmed:false,containsSensitiveData:true},decideAiAccess(base)),false));
