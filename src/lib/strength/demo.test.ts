import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,existsSync} from 'node:fs'
import {CATALOG} from './catalog'
import {MOTION_KEYS,DEMO_VERSION} from './demo/index'
import {demoExerciseDefaults,appendDemoMoveCompared,undoDemoMoveCompared} from './demo/plan'
import {PLAN_KEY} from './session-builder'
import type {Plan} from './model'
const data=JSON.parse(readFileSync(new URL('./demo/data.json',import.meta.url),'utf8'))
test('R189 all 76 catalog IDs use exact supplied motion mapping and preserve FIT key',()=>{
 assert.equal(CATALOG.length,76);assert.equal(Object.keys(MOTION_KEYS).length,76)
 for(const e of CATALOG){assert.ok(MOTION_KEYS[e.id],e.id);const demo=data.exercises.find((x:{id:string})=>x.id===e.id);assert.ok(demo);assert.equal(demo.garmin_fit.exercise_key,e.exerciseKey);assert.ok(data.animations[demo.anim]);assert.ok(demo.cues.safety.length)}
 assert.equal(MOTION_KEYS['bb-dl'],'deadlift');assert.equal(MOTION_KEYS['assist-chin'],'chinup')
})
test('R189 every mapped motion exists and has valid duration/frames, local vendor/model present',async()=>{
 const {default:motions}=await import(new URL('../../../public/demo3d/motions.js',import.meta.url).href)
 for(const key of Object.values(MOTION_KEYS)){assert.ok(motions[key],key);assert.ok(motions[key].frames.length>=2,key);for(const f of motions[key].frames){assert.ok(Number.isFinite(f.dur)&&f.dur>0,key);assert.ok(f.pose,key)}}
 for(const name of ['models/human.glb','models/regions.png','vendor/THREE-LICENSE.txt','LICENSES.md','viewer3d.js'])assert.ok(existsSync(new URL('../../../public/demo3d/'+name,import.meta.url)))
 const viewer=readFileSync(new URL('../../../public/demo3d/viewer3d.js',import.meta.url),'utf8');assert.ok(viewer.includes('new URL(`./models/${kind}.glb`, import.meta.url)'));assert.ok(viewer.includes("['athlete','athlete-male','athlete-female'].includes(model) ? model : 'human'"));assert.doesNotMatch(viewer,/(?:from|fetch\(|loadAsync\()[^\n;]*https?:|from 'three'/)
})
function box(drop=false){const m=new Map<string,string>();return {getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>{if(!drop)m.set(k,v)},m}}
const plan:Plan={name:'原计划',sessions:[{id:'today',name:'今天力量',moves:[]},{id:'other',name:'下次',moves:[]}]}
test('R189 add to today appends exact default dose only after caller request, preserves old plan',()=>{const b=box(),expected=JSON.stringify(plan);b.setItem(PLAN_KEY,expected);const r=appendDemoMoveCompared(b,expected,plan,'today','bb-bench',20);assert.ok(r.ok);if(!r.ok)return;assert.deepEqual(r.plan.sessions[1],plan.sessions[1]);assert.equal(plan.sessions[0].moves.length,0);const move=r.plan.sessions[0].moves[0],d=demoExerciseDefaults('bb-bench')!;assert.deepEqual([move.catalogId,move.sets,move.amount,move.restSec,move.weightKg],['bb-bench',d.sets,d.amount,d.restSec,20]);assert.deepEqual(undoDemoMoveCompared(b,r.receipt).ok,true);assert.equal(b.getItem(PLAN_KEY),expected)})
test('R189 duplicate action, stale plan, unknown load, and dropped write never claim saved',()=>{const b=box(),expected=JSON.stringify(plan);b.setItem(PLAN_KEY,expected);assert.equal(appendDemoMoveCompared(b,'stale',plan,'today','pushup',0).ok,false);assert.equal(appendDemoMoveCompared(b,expected,plan,'today','pushup',NaN).ok,false);const r=appendDemoMoveCompared(b,expected,plan,'today','pushup',0);assert.ok(r.ok);if(r.ok)assert.equal(appendDemoMoveCompared(b,r.raw,r.plan,'today','pushup',0).ok,false);const drop=box(true);drop.m.set(PLAN_KEY,expected);assert.equal(appendDemoMoveCompared(drop,expected,plan,'today','pushup',0).ok,false)})
test('R189 undo refuses to overwrite subsequent edits',()=>{const b=box(),raw=JSON.stringify(plan);b.setItem(PLAN_KEY,raw);const r=appendDemoMoveCompared(b,raw,plan,'today','pushup',0);assert.ok(r.ok);if(!r.ok)return;b.setItem(PLAN_KEY,JSON.stringify({...r.plan,name:'用户新改名'}));assert.equal(undoDemoMoveCompared(b,r.receipt).ok,false);assert.match(b.getItem(PLAN_KEY)!,/用户新改名/)})
test('R189 lazy entry does not import viewer or download assets on app boot; old figure absent',()=>{const content=readFileSync(new URL('../../components/exercise-content.tsx',import.meta.url),'utf8');const entry=readFileSync(new URL('../../components/exercise-editor.tsx',import.meta.url),'utf8');assert.match(entry,/lazy\(/);assert.doesNotMatch(entry,/import ExerciseDemo from/);assert.doesNotMatch(content,/FormFigure|form-figure/);const sw=readFileSync(new URL('../../../public/sw.js',import.meta.url),'utf8');assert.ok(sw.includes(`const DEMO_CACHE="${DEMO_VERSION}"`));assert.doesNotMatch(sw,/addAll\(/)})
