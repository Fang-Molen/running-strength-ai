import test from 'node:test'
import assert from 'node:assert/strict'
import { APPROVALS, validateMotionManifest, validateMotionEntry, findApprovedMotion, characterReference } from './approved-motion.ts'
const entry=()=>({
 exercise_id:'back-squat', gender:'female', character_id:'fk-tonight-female', asset_version:'r4-1', rig_version:'fk53-r4', character_sha256:'b'.repeat(64), uri:'/fangkun-motion/assets/back-squat-female.glb',
 sha256:'a'.repeat(64), status:'APPROVED', clip_name:'FK_back-squat_female',
 reviews:Object.fromEntries(APPROVALS.map(x=>[x,'PASS'])),
 reviewed_by:'human-reviewer', evidence_path:'docs/qa/back-squat-female.json'
})

test('empty manifest valid but has no production animation',()=>{
 assert.equal(validateMotionManifest({schema:'fangkun-approved-motion-v1',assets:[]}),true)
 assert.equal(findApprovedMotion({schema:'fangkun-approved-motion-v1',assets:[]},'back-squat','male'),null)
})
test('properly signed single female entry with exact action id resolves',()=>{
 const e=entry(),m={schema:'fangkun-approved-motion-v1',assets:[e]}
 assert.ok(validateMotionEntry(e));assert.ok(validateMotionManifest(m))
 assert.equal(findApprovedMotion(m,'back-squat','male'),null)
 assert.deepEqual(findApprovedMotion(m,'back-squat','female'),e)
 assert.equal(findApprovedMotion(m,'back','female'),null)
})
test('reject path traversal, external URL, legacy URI, fake approvals',()=>{
 for (const uri of ['/demo3d/models/athlete-male.glb','https://elsewhere/asset.glb','/fangkun-motion/assets/../male.glb']){
  assert.equal(validateMotionEntry({...entry(),uri}),false)
 }
 for (const field of APPROVALS){
  const e=entry();e.reviews[field]='PENDING'
  assert.equal(validateMotionEntry(e),false)
 }
 assert.equal(validateMotionEntry({...entry(),status:'DRAFT'}),false)
 assert.equal(validateMotionEntry({...entry(),reviewed_by:'REPLACE_WITH_REVIEWER'}),false)
 assert.equal(validateMotionEntry({...entry(),clip_name:''}),false)
})
test('reject duplicates and fail closed for malformed entries',()=>{
 const e=entry()
 assert.equal(validateMotionManifest({schema:'fangkun-approved-motion-v1',assets:[e,e]}),false)
 assert.equal(validateMotionManifest({schema:'fangkun-approved-motion-v1',assets:[e,{...e,sha256:'bad'}]}),false)
})
test('design reference paths always point to new characters',()=>{
 assert.equal(characterReference('female'),'/fangkun-character/female-front.webp')
 assert.equal(characterReference('male','turnaround'),'/fangkun-character/male-turnaround.webp')
})

test('character identity and immutable version provenance are mandatory',()=>{
 for(const field of ['character_id','asset_version','rig_version','character_sha256'])assert.equal(validateMotionEntry({...entry(),[field]:undefined}),false);
 assert.equal(validateMotionEntry({...entry(),character_id:'legacy-female'}),false);
 assert.equal(validateMotionEntry({...entry(),gender:'male'}),false);
});

test('permitted A2/A4 strength identity still requires all six reviews',()=>{
 const e={...entry(),character_id:'fk-gym-girls-a4'};assert.equal(validateMotionEntry(e),true);
 assert.equal(validateMotionEntry({...e,reviews:{}}),false);
 assert.equal(validateMotionEntry({...e,character_id:'fk-gym-boys-a2'}),false);
});
