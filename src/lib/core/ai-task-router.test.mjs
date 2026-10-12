import test from 'node:test';
import assert from 'node:assert/strict';
import {routeAiTask} from './ai-task-router.ts';
const base={online:true,consent:true,serverAuthorized:false,credits:0,estimatedCost:2};
/** @type {Parameters<typeof routeAiTask>[0]['task'][]} */
const tasks=['period_plan','product_management','training_log','basic_coach','image_ocr'];
for(const task of tasks) {
 test(`${task} free without credits`,()=>{const r=routeAiTask({...base,task});assert.equal(r.allowed,true);assert.equal(r.billable,false);assert.equal(r.route,'local')});
}
test('metered needs server grant',()=>assert.equal(routeAiTask({...base,task:'deep_reasoning'}).reason,'SERVER_REQUIRED'));
test('metered needs sufficient credits',()=>assert.equal(routeAiTask({...base,task:'deep_reasoning',serverAuthorized:true}).reason,'CREDITS_REQUIRED'));
test('metered authorized',()=>assert.equal(routeAiTask({...base,task:'deep_reasoning',serverAuthorized:true,credits:3}).billable,true));
test('offline falls back',()=>assert.equal(routeAiTask({...base,task:'image_semantics',online:false,userConfirmedImageUpload:true}).fallback,'manual_review'));
test('image consent independent',()=>assert.equal(routeAiTask({...base,task:'image_semantics'}).reason,'IMAGE_UPLOAD_CONFIRMATION_REQUIRED'));
test('safety vetoes everything',()=>assert.equal(routeAiTask({...base,task:'period_plan',safetyBlocked:true}).reason,'SAFETY_BLOCKED'));
test('explicit paid route does not turn ordinary feature into paid-only',()=>{const r=routeAiTask({...base,task:'period_plan',requestedRoute:'metered_remote'});assert.equal(r.allowed,false);assert.equal(r.fallback,'local')});
