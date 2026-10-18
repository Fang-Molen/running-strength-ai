import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync, existsSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {DEMO_ASSETS, DEMO_VERSION, MOTION_KEYS} from './demo/index'

const asset=(name:string)=>new URL('../../../public/demo3d/'+name,import.meta.url)
const hash=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex')

test('v74 preserves original human rig and supplied v74 motions including warmups',()=>{
 const glb=readFileSync(asset('models/human.glb'))
 assert.equal(hash(glb),'cbf479cf66cb281b96d83b41816b5894e4f9da9833c015821b95499c9440353c')
 assert.equal(glb.readUInt32LE(0),0x46546c67)
 assert.equal(glb.readUInt32LE(4),2)
 assert.equal(glb.readUInt32LE(8),glb.length)
 assert.equal(glb.readUInt32LE(16),0x4e4f534a)
 const content=JSON.parse(glb.subarray(20,20+glb.readUInt32LE(12)).toString('utf8'))
 assert.equal(content.skins.length,5)
 assert.ok(content.skins.every((skin:{joints:number[]})=>skin.joints.length===53))
 assert.equal(content.animations?.length??0,0)
 assert.equal(hash(readFileSync(asset('motions.js'))),'65a799cc8fd32f7159cf0c1bcc93a1358ab5cb686dc0d3535c8f0504a886db87')
 assert.equal(hash(readFileSync(asset('models/regions.png'))),'8865d5811229a775c78f1e4d9688b6fde95048f110780f8c9ef89e43ce37e661')
 assert.equal(Object.keys(MOTION_KEYS).length,76)
})

test('R190 JSON and runtime muscle dictionaries share all 35 stable region indices',()=>{
 const json=JSON.parse(readFileSync(asset('muscles.json'),'utf8'))
 const js=JSON.parse(readFileSync(asset('muscles.js'),'utf8').replace(/^export default /,'').trim().replace(/;$/,''))
 assert.deepEqual(json,js)
 assert.equal(json.length,35)
 assert.equal(new Set(json.map((m:{k:string})=>m.k)).size,35)
 assert.deepEqual(json.slice(32).map((m:{k:string})=>m.k),['peroneals','plantar_fascia','foot_intrinsic'])
 assert.equal(hash(readFileSync(asset('muscles.js'))),'0a376021b9ba9dc29a3d334312b10633313ada822fcc7e3771c1ef797cdb9d88')
})

test('paired characters retain local resources, morph channels and the original human reference',()=>{
 for(const sex of ['male','female']){
  const model=readFileSync(asset(`models/athlete-${sex}.glb`));assert.equal(model.readUInt32LE(0),0x46546c67);
  const j=JSON.parse(model.subarray(20,20+model.readUInt32LE(12)).toString());assert.ok(j.skins.every((skin:{joints:number[]})=>skin.joints.length===53));
  assert.deepEqual(j.meshes[0].extras.targetNames,['slender','lean','muscular','adipose']);assert.equal(j.extras.fangkunReference.sexPresentation,sex);
 }
 const viewer=readFileSync(asset('viewer3d.js'),'utf8');assert.match(viewer,/athlete-female/);assert.match(viewer,/from '\/demo3d\/vendor\/three\.module\.min\.js'/);
});

test('R190 opt-in asset cache and service worker use the same new version with local assets',()=>{
 assert.equal(DEMO_VERSION,'fk-demo3d-v74-paired')
 const sw=readFileSync(new URL('../../../public/sw.js',import.meta.url),'utf8')
 assert.ok(sw.includes(DEMO_VERSION))
 assert.doesNotMatch(sw,/fk-demo3d-r189-v1/)
 for(const path of DEMO_ASSETS){
  assert.ok(path.startsWith('/demo3d/') || path.startsWith('/exercise-sources/'))
  assert.ok(existsSync(new URL('../../../public'+path,import.meta.url)),path)
 }
})
