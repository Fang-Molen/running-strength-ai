import test from 'node:test'
import assert from 'node:assert/strict'
import { subscribeHealthUpdates } from './health-subscription'
import { setEventContext } from '../core/events'
test('health subscriber hears every provider save, foreground and athlete change, and removes all listeners',()=>{
 const old=Object.getOwnPropertyDescriptor(globalThis,'window'),win=new EventTarget();Object.defineProperty(globalThis,'window',{configurable:true,value:win});let calls=0
 try{const off=subscribeHealthUpdates(()=>calls++);for(const name of ['fk-health-changed','fk-garmin-synced','fk-coros-changed','storage','focus','pageshow'])win.dispatchEvent(new Event(name));assert.equal(calls,6);setEventContext({athleteId:'other-live-test'});assert.equal(calls,7);off();win.dispatchEvent(new Event('fk-health-changed'));setEventContext({athleteId:'local'});assert.equal(calls,7)}finally{old?Object.defineProperty(globalThis,'window',old):Reflect.deleteProperty(globalThis,'window')}
})
test('batched subscriptions reconcile after installation and coalesce a synchronous save burst',async()=>{
 const old=Object.getOwnPropertyDescriptor(globalThis,'window'),win=new EventTarget();Object.defineProperty(globalThis,'window',{configurable:true,value:win});let calls=0
 try{
  const off=subscribeHealthUpdates(()=>calls++,{batch:true,reconcile:true})
  await Promise.resolve();assert.equal(calls,1,'closes render-to-subscribe gap')
  for(let n=0;n<40;n++)win.dispatchEvent(new Event('fk-health-changed'))
  assert.equal(calls,1);await Promise.resolve();assert.equal(calls,2,'one local read-model refresh, no new fetch')
  win.dispatchEvent(new Event('fk-coros-changed'));off();await Promise.resolve();assert.equal(calls,2,'queued callbacks cannot run after unmount')
 }finally{old?Object.defineProperty(globalThis,'window',old):Reflect.deleteProperty(globalThis,'window')}
})
