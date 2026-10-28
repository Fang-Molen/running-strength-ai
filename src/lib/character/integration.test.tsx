import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { demoData } from '../strength/demo/provider'
import { catalogue } from '../running-technique/catalogue'
import { R6_EXERCISE_IDS, supplementalMediaId } from './inventory'
import { ACTIONS } from '../strength/action-picker'
import { ActionPicker } from '@/components/action-picker'
import { ID, verifiedMediaBytes, selectVideo, type VideoAsset } from './identity'
import { FangkunExerciseVideo } from '@/components/fangkun-unified-video'
import { FangkunHealthCharacter } from '@/components/fangkun-unified-character'

const video = (sha256: string): VideoAsset => ({ exerciseId:'back-squat',gender:'male',characterId:ID.male,
 url:'/fangkun-video/assets/test-only.mp4',sha256,status:'APPROVED',reviewer:'synthetic test only',licenseEvidence:'docs/media-qa/synthetic.json',qaEvidence:'docs/media-qa/synthetic-qa.json',
 reviews:{rights:'PASS',identity:'PASS',biomechanics:'PASS',equipment:'PASS',mobile:'PASS'} })
test('R6 inventory retains exactly the original 100 strength plus 53 running IDs',()=>{
 assert.equal(demoData.exercises.length,76)
 assert.equal(ACTIONS.length,100)
 const strength=ACTIONS.map(e=>e.catalogId ?? supplementalMediaId(e.name))
 assert.ok(strength.every(Boolean),'all 16 editor extras and 8 foot actions retain exact R6 media IDs')
 const current=[...strength,...catalogue.drills.map(e=>e.id)].sort()
 assert.equal(current.length,153);assert.equal(new Set(current).size,153)
 assert.deepEqual([...R6_EXERCISE_IDS].sort(),current)
 const html=renderToStaticMarkup(<ActionPicker selectedKeys={[]} onAdd={()=>{}} onPreview={()=>{}} onMuscle={()=>{}}/>)
 assert.match(html,/找到 100 个动作/)
 for(const label of ['搜索添加','分类添加','肌肉图选择'])assert.ok(html.includes(label))
})
test('no approved model renders only same-character reference and a hidden canvas',()=>{
 for(const gender of ['male','female'] as const){const html=renderToStaticMarkup(<FangkunHealthCharacter gender={gender} view="back"/>);
 assert.match(html,new RegExp(gender==='male'?'/fangkun-pet/chiyan/chiyan-fullbody.webp':`/fangkun-character/${gender}-back.webp`));assert.match(html,/非3D/);assert.match(html,/visibility:hidden/);assert.match(html,/aria-hidden="true"/)
 assert.doesNotMatch(html,/demo3d\/models|fangkun-new-visual|athlete\.glb|human\.glb/)}
})
test('missing video has no false play controls or wrong exercise frame',()=>{
 const html=renderToStaticMarkup(<FangkunExerciseVideo exerciseId="back-squat" title="杠铃深蹲" gender="female"/>);
 assert.match(html,/female-front.webp/);assert.match(html,/非杠铃深蹲动作姿势/);assert.doesNotMatch(html,/<video|慢放 0.5|>播放</)
})
test('unknown, duplicate or differently gendered video cannot be selected',()=>{
 const v=video('a'.repeat(64)),schema='fangkun-video-v2'
 assert.equal(selectVideo({schema,assets:[v,v]},'back-squat','male'),null)
 assert.equal(selectVideo({schema,assets:[{...v,exerciseId:'unknown-motion'}]},'unknown-motion','male'),null)
 assert.equal(selectVideo({schema,assets:[v]},'back-squat','female'),null)
})
test('asset bytes must match the exact hash before playback; network failures reject',async()=>{
 const old=globalThis.fetch,bytes=new TextEncoder().encode('synthetic-not-a-real-video'),digest=createHash('sha256').update(bytes).digest('hex')
 try{
  globalThis.fetch=async()=>new Response(bytes,{headers:{'content-type':'video/mp4'}})
  assert.deepEqual(new Uint8Array(await verifiedMediaBytes(video(digest))),bytes)
  await assert.rejects(()=>verifiedMediaBytes(video('b'.repeat(64))),/校验失败/)
  globalThis.fetch=async()=>new Response('<html>',{headers:{'content-type':'text/html'}})
  await assert.rejects(()=>verifiedMediaBytes(video(digest)),/不可用/)
 }finally{globalThis.fetch=old}
})
test('release manifests remain empty and cannot claim that synthetic tests approved media',()=>{
 for(const path of ['public/fangkun-character/manifest.json','public/fangkun-video/manifest-r6.json'])
  assert.deepEqual(JSON.parse(readFileSync(path,'utf8')).assets,[])
})
