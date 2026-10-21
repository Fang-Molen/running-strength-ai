// @ts-nocheck  研究模块原样保留（纯 JS，休眠，未接入界面）
import test from 'node:test';import assert from 'node:assert/strict';import {projectDailyTrend,muscleEvidence} from './coros-crossbrand-trend.mjs';
test('provider isolation and no fake Body Battery',()=>{const x=projectDailyTrend([{provider:'COROS',date:'2026-10-20',metric:'STEPS',value:12345,unit:'steps'},{provider:'GARMIN',date:'2026-10-20',metric:'STEPS',value:999,unit:'steps'}]);assert.equal(x[0].steps,12345);assert.equal(x[0].garminBodyBattery,null)});
test('no baseline without sufficient comparable days',()=>assert.equal(projectDailyTrend([{provider:'COROS',date:'2026-10-20',metric:'SLEEP_HRV',value:45,unit:'ms',protocol:'COROS'}])[0].reference.hrvMs,null));
test('no fake muscle score',()=>assert.equal(muscleEvidence({confirmedSessions:[{confirmed:true}]}).muscleFatiguePercent,null));
