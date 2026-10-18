import assert from 'node:assert/strict';import{readFile,writeFile}from'node:fs/promises';
import * as THREE from '../../public/demo3d/vendor/three.module.min.js';
import MO from '../../public/demo3d/motions.js';import{makeRig,applyMotionPose,poseAt,applyAppearance}from'../../public/demo3d/viewer3d.js';import{readGlb,parseGlb}from'./asset-io.mjs';
const data=JSON.parse(await readFile('src/lib/strength/demo/data.json','utf8')),index=await readFile('src/lib/strength/demo/index.ts','utf8');
const keys=Object.fromEntries([...index.split('} as const')[0].matchAll(/'([^']+)': '([^']+)'/g)].map(x=>[x[1],x[2]]));const clips=new Set([...data.exercises.map(e=>keys[e.id]),...Object.keys(MO).filter(k=>k.startsWith('warmup_'))]);
assert.equal(data.exercises.length,76);assert.ok(data.exercises.every(e=>keys[e.id]&&MO[keys[e.id]]));
const results=[],p=new THREE.Vector3();
for(const sex of ['male','female']){
 const raw=await readGlb(`athlete-${sex}`),rig=makeRig(await parseGlb(raw),{hi:Array(40).fill(0),border:0});assert.equal(Object.keys(rig.bones).length,53);assert.equal(rig.body.morphTargetInfluences.length,4);
 for(const key of clips){try{const mo=MO[key],duration=mo.frames.reduce((n,f)=>n+f.dur,0);assert.ok(duration>0);let min=Infinity,max=-Infinity;
 for(let sample=0;sample<4;sample++){applyAppearance(rig,sample===3?{muscular:.4,adipose:.2}:{});applyMotionPose(rig,mo,poseAt(mo,duration*sample/4).pose);rig.root.updateMatrixWorld(true);rig.root.traverse(o=>{if(!o.isSkinnedMesh)return;for(let i=0;i<o.geometry.attributes.position.count;i++){o.getVertexPosition(i,p);p.applyMatrix4(o.matrixWorld);assert.ok([p.x,p.y,p.z].every(Number.isFinite),`${key}: nonfinite`);assert.ok(Math.max(Math.abs(p.x),Math.abs(p.y),Math.abs(p.z))<8,`${key}: out of bounds`);min=Math.min(min,p.y);max=Math.max(max,p.y)}})}results.push({sex,key,status:'PASS',samples:4,minY:min,maxY:max})}catch(e){results.push({sex,key,status:'FAIL',error:String(e)})}}
}
const report={exerciseIds:data.exercises.length,uniqueClips:clips.size,poses:results.reduce((n,r)=>n+(r.samples??0),0),PASS:results.filter(r=>r.status==='PASS').length,FAIL:results.filter(r=>r.status==='FAIL').length,scope:'Real GLB skinning, 4 samples/clip per character; not biomechanical approval or complete self-intersection proof',results};await writeFile('../evidence/paired-geometry.json',JSON.stringify(report,null,2));console.log(JSON.stringify({...report,results:undefined}));if(report.FAIL)process.exitCode=1;
