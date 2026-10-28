import test from 'node:test';
import assert from 'node:assert/strict';
import { contextRecordQuote } from '../coach/online-contract';
import { displayCoachEvidence } from './coach-evidence-display';
test('X07 technical quotations display readable dose, rest and safety with the original retained separately',()=>{
 const text=contextRecordQuote({recordId:'private-hash',revision:'source-v2',category:'TRAINING',state:'ACTUAL',source:'USER_DECLARED:GARMIN',occurredAt:'2026-10-28T08:00:00Z',knownAt:'2026-10-28T09:00:00Z',fields:[{name:'sourceGroup',value:'opaque-device-hash',unit:null},{name:'duration',value:72,unit:'s'},{name:'restAfter',value:180,unit:'s'},{name:'restScope',value:'AFTER_REPEAT',unit:null},{name:'medicalClearance',value:false,unit:null}]});
 const readable=displayCoachEvidence(text);
 assert.ok(readable.hasTechnicalOriginal);
 assert.match(readable.text,/时长：72 s.*随后休息：180 s.*休息位置：每次重复后.*医疗放行：否/);
 assert.match(readable.text,/2026-10-28T08:00:00Z.*GARMIN.*未经独立核验/);
 assert.doesNotMatch(readable.text,/sourceGroup|opaque-device-hash|restAfter/);
 assert.match(text,/sourceGroup=opaque-device-hash.*修订 source-v2/);
 assert.deepEqual(displayCoachEvidence('明天是否调整还要核对疼痛和功能。'),{text:'明天是否调整还要核对疼痛和功能。',hasTechnicalOriginal:false});
});
