// @ts-nocheck — 合入包 U12 原测试（纯 JS），逻辑模块本身受类型检查
import test from 'node:test';import assert from 'node:assert/strict'
import {classifyFreshness,dailyMetricFreshness} from './recovery-freshness-u12.ts'
const now='2026-10-20T22:00:00Z'
const h=(minutes)=>new Date(Date.parse(now)-minutes*60000).toISOString()
const read=(minutes)=>classifyFreshness({metric:'HEART_RATE',asOf:now,measuredAt:h(minutes),sourceId:'garmin',value:62})
test('fresh HR measured 5m ago is recent device reading',()=>assert.equal(read(5).state,'CURRENT'))
test('hour-old HR not mislabeled real time',()=>assert.equal(read(60).state,'RECENT'))
test('3h old HR is stale',()=>assert.equal(read(180).state,'STALE'))
test('future reading excluded',()=>assert.equal(classifyFreshness({metric:'HEART_RATE',asOf:now,measuredAt:'2026-10-21T00:00:00Z',sourceId:'g',value:70}).state,'UNAVAILABLE'))
test('missing time excluded',()=>assert.equal(classifyFreshness({metric:'BODY_BATTERY',asOf:now,value:70,sourceId:'g'}).state,'UNAVAILABLE'))
test('conflict wins over available data',()=>assert.equal(classifyFreshness({metric:'STRESS',asOf:now,measuredAt:h(5),sourceId:'g',value:20,conflict:true}).state,'CONFLICT'))
test('nightly HRV not evaluated as minute-level data',()=>assert.equal(dailyMetricFreshness('HRV',{asOf:now,measuredAt:h(25*60),sourceId:'g',value:55}).state,'CURRENT'))
test('daily RHR older than 3 days stale',()=>assert.equal(dailyMetricFreshness('RHR',{asOf:now,measuredAt:h(74*60),sourceId:'g',value:50}).state,'STALE'))
test('bad asOf throws',()=>assert.throws(()=>classifyFreshness({metric:'HEART_RATE',asOf:'bad'}),/INVALID_AS_OF/))
