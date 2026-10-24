import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { TrainingModelPanel, TrainingModelReview } from './training-model-panel'
import { readTrainingModelWorkbench } from '../lib/coach/training-models/workbench'
import { setStoreBackend } from '../lib/core/storage'
import { fixture, threshold } from '../lib/coach/training-models/test-fixtures'
import { buildTrainingCandidates } from '../lib/coach/training-models/candidates'
test('initial panel offers an explicit local read without reading storage or uploading',()=>{
 let reads=0,writes=0;setStoreBackend({getItem:()=>{reads++;return null},setItem:()=>{writes++}})
 try{const html=renderToStaticMarkup(<TrainingModelPanel revision={0}/>);assert.match(html,/训练模型与课表候选/);assert.match(html,/读取本机资料/);assert.match(html,/尚未写入日程/);assert.match(html,/未知/);assert.equal(reads,0);assert.equal(writes,0)}finally{setStoreBackend(null)}
})
test('candidate review keeps both rounds, per-repeat targets and rest in athlete-readable text',()=>{
 const input=fixture();input.thresholds=[threshold('LT1',3),threshold('LT2',4)]
 const result=buildTrainingCandidates(input),view={input,result,courses:[],asOf:input.context.asOf,missing:result.missing}
 const html=renderToStaticMarkup(<TrainingModelReview view={view} familiar={[]} onFamiliar={()=>{}} onPrepare={()=>{}} disabled={false}/>)
 assert.ok(html.includes('2轮，每轮4次'));assert.ok(html.includes('2轮，每轮3次'))
 assert.match(html,/组间 60 秒/);assert.match(html,/轮间 180 秒/);assert.match(html,/目标80秒/)
 assert.doesNotMatch(html,/repeatCount|roundCount|plannedDurationSeconds|runningPlanSchemaVersion/)
})
test('loaded production review exposes missing evidence and no fabricated executable plan',async()=>{
 setStoreBackend({keys:()=>[],getItem:()=>null,setItem:()=>{throw Error('Read-only')}})
 try{const view=await readTrainingModelWorkbench({},'2026-10-23',new Date().toISOString());let prepared=0
 const html=renderToStaticMarkup(<TrainingModelReview view={view} familiar={[]} onFamiliar={()=>{}} onPrepare={()=>{prepared++}} disabled={false}/>)
 assert.match(html,/金字塔/);assert.match(html,/双阈值/);assert.match(html,/缺失资料/);assert.match(html,/没有当前档案/);assert.equal(prepared,0);assert.doesNotMatch(html,/已排课|已启动训练/)
 }finally{setStoreBackend(null)}
})
