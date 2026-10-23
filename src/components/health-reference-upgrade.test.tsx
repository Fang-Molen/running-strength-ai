import test, {beforeEach, afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {writeFileSync} from 'node:fs'
import {HealthPageV89} from './health-page-v89'
import {setStoreBackend} from '../lib/core/storage'
import {setEventContext} from '../lib/core/events'
import {saveIntraday} from '../lib/health/intraday-store'
import {saveHealthSource} from '../lib/health/snapshot'
import {shiftDay} from '../lib/health/observation'
import {todayDate} from '../lib/nutrition/body'
import type {IntradayDay} from '../lib/health/garmin-intraday'

const today=todayDate(), now=new Date().toISOString(), sourceId='garmin:synthetic'
let data:Map<string,string>
beforeEach(()=>{data=new Map();setStoreBackend({getItem:k=>data.get(k)??null,setItem:(k,v)=>{data.set(k,v)},keys:()=>[...data.keys()]});setEventContext({athleteId:'synthetic-health-view'})})
afterEach(()=>{setStoreBackend(null);setEventContext({athleteId:'local'})})
const row=(day:string):IntradayDay=>({schemaVersion:1,eventTimingVersion:2,day,source:'garmin',sourceId,fetchedAt:now,offsetMin:0,hr:[],bb:(day===today?[0]:[0,1,2]).map(h=>[Date.parse(day+'T00:00:00Z')+h*3600e3,70-h*10]),restingHr:null,sleep:null,training:[]})
function seed(legacy:boolean){saveIntraday(Array.from({length:28},(_,i)=>{const d=row(shiftDay(today,-i));if(legacy&&i)delete d.sourceId;return d}))}
function render(name:string){const before=[...data];const html=renderToStaticMarkup(createElement(HealthPageV89,{body:null,grid:null,stats:null,rest:()=>null,trend:()=>null}));assert.deepEqual([...data],before,'rendering health page must remain read-only');if(process.env.FK_HEALTH_RENDER_DIR)writeFileSync(`${process.env.FK_HEALTH_RENDER_DIR}/${name}.html`,html);return html}

test('actual health page renders dashed baseline and band with comparable history',()=>{
  seed(false);const html=render('health-reference-available')
  assert.match(html,/data-testid="h89-estimate"/);assert.match(html,/data-testid="h89-reference"/)
  assert.match(html,/方坤常态 · 近27天/);assert.doesNotMatch(html,/历史不足7天/)
})
test('actual health page explains legacy source exclusion while retaining measured curve',()=>{
  seed(true);const html=render('health-reference-awaiting-source')
  assert.match(html,/data-testid="h89-chart-bb"/);assert.doesNotMatch(html,/data-testid="h89-estimate"/)
  assert.match(html,/同来源 0\/7 天/);assert.match(html,/27天旧来源待核对/)
  assert.match(html,/27天旧记录缺少账号来源标识/)
})
test('an explicitly selected different provider cannot show the Garmin comparison',()=>{
  seed(false);saveHealthSource('BODY_BATTERY','coros:synthetic|电量|')
  const html=render('health-reference-different-source')
  assert.doesNotMatch(html,/data-testid="h89-estimate"/);assert.match(html,/未混用其他设备或账号数据/)
})
test('no-device page remains useful with no fabricated battery or comparison',()=>{
  const html=render('health-reference-no-device')
  assert.match(html,/data-testid="intraday-empty"/);assert.doesNotMatch(html,/data-testid="h89-estimate"/)
  assert.match(html,/当前来源暂无可用逐时曲线/)
  assert.match(html,/证据不足，暂不能判断疲劳/)
  assert.doesNotMatch(html,/data-testid="h89-chart-bb"/)
})
