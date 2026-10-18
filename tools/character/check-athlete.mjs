/** CPU asset/rig checks; no browser or WebGL emulation. Run with the existing module resolver. */
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as THREE from '../../public/demo3d/vendor/three.module.min.js';
import {readGlb,parseGlb} from './asset-io.mjs';
import {makeRig,applyPose,applyAppearance,normalizeAppearance,APPEARANCE_CHANNELS} from '../../public/demo3d/viewer3d.js';
import {POSES,figurePose} from '../../public/demo3d/body3d.js';
const source=await readGlb('human'),derived=await readGlb('athlete');
assert.equal(createHash('sha256').update(source.bytes).digest('hex'),'cbf479cf66cb281b96d83b41816b5894e4f9da9833c015821b95499c9440353c');
assert.deepEqual(derived.json.nodes,source.json.nodes,'bone hierarchy, transforms and mesh attachment nodes');
assert.equal(derived.json.meshes.length,source.json.meshes.length);
for(let i=0;i<5;i++)assert.deepEqual(derived.json.skins[i].joints,source.json.skins[i].joints);
const oldGltf=await parseGlb(source),gltf=await parseGlb(derived);
const oldRig=makeRig(oldGltf,{hi:new Array(40).fill(0),border:0}),rig=makeRig(gltf,{hi:new Array(40).fill(0),border:0});
assert.equal(Object.keys(rig.bones).length,53);
const sourceMeshes=[],meshes=[];oldRig.root.traverse(o=>{if(o.isMesh)sourceMeshes.push(o);});rig.root.traverse(o=>{if(o.isMesh)meshes.push(o);});
for(let m=0;m<5;m++){
 const a=sourceMeshes[m],b=meshes[m];assert.equal(b.geometry.index.count,a.geometry.index.count);assert.deepEqual([...b.geometry.index.array],[...a.geometry.index.array]);
 for(const attr of ['uv','skinIndex','skinWeight'])assert.deepEqual([...b.geometry.attributes[attr].array],[...a.geometry.attributes[attr].array],b.name+' '+attr);
 for(let i=0;i<53;i++)assert.deepEqual(b.skeleton.boneInverses[i].elements,a.skeleton.boneInverses[i].elements);
 assert.equal(b.material.transparent,false);assert.equal(b.material.opacity,1);assert.equal(b.material.depthWrite,true);
}
assert.deepEqual(Object.keys(rig.body.morphTargetDictionary),APPEARANCE_CHANNELS);
assert.equal(rig.body.geometry.morphTargetsRelative,true);
assert.equal(rig.body.geometry.morphAttributes.position.length,4);
assert.equal(rig.body.geometry.morphAttributes.normal.length,4);
assert.deepEqual(normalizeAppearance({slender:-1,lean:NaN,muscular:2,adipose:Infinity}),{slender:0,lean:0,muscular:1,adipose:0});
assert.deepEqual(normalizeAppearance({slender:1,lean:1,muscular:1,adipose:1}),{slender:.25,lean:.25,muscular:.25,adipose:.25});
assert.throws(()=>applyAppearance(oldRig,{muscular:1}),/没有可用/);
const another=makeRig(gltf,{hi:new Array(40).fill(0),border:0});applyAppearance(rig,{muscular:1});
assert.deepEqual(another.body.morphTargetInfluences,[0,0,0,0],'comparison panels keep independent weights');
function bounds(object){const box=new THREE.Box3();const v=new THREE.Vector3();object.updateMatrixWorld(true);object.traverse(o=>{if(!o.isMesh)return;for(let i=0;i<o.geometry.attributes.position.count;i++){o.getVertexPosition(i,v);v.applyMatrix4(o.matrixWorld);assert([v.x,v.y,v.z].every(Number.isFinite));box.expandByPoint(v);}});return box;}
const appearances=[{},...APPEARANCE_CHANNELS.map(k=>({[k]:1})),{slender:.2,lean:.2,muscular:.3,adipose:.3},{slender:1,lean:1,muscular:1,adipose:1}];
let poses=0;const grounding=[];
for(const [pose,definition]of Object.entries(POSES)){
 applyAppearance(rig,{});applyPose(rig,figurePose(pose,'athlete'));const baseline=bounds(rig.root);
 for(const channels of appearances){
  applyAppearance(rig,channels);applyPose(rig,figurePose(pose,'athlete'));const b=bounds(rig.root);poses++;
  assert(Math.abs(b.min.y-baseline.min.y)<1e-5,`${pose}: morph moved foot/floor alignment`);
  grounding.push({pose,channels,minimumY:b.min.y});
 }
}
// Whole-shape rescaling would move every region; each target must have an exactly fixed head/feet subset.
for(const target of rig.body.geometry.morphAttributes.position){
 let moved=0,fixed=0;for(let i=0;i<target.count;i++){const d=Math.hypot(target.getX(i),target.getY(i),target.getZ(i));if(d>1e-7)moved++;else fixed++;}
 assert(moved>2000&&fixed>5000);assert(target.array.every(Number.isFinite));
}
// Confirm the bounded athlete-only stand correction improves the actual outsole plane.
const shoeRig=makeRig(gltf,{hi:new Array(40).fill(0),border:0});let shoe;
shoeRig.root.traverse(o=>{if(/shoe/.test(o.name))shoe=o;});shoeRig.root.updateMatrixWorld(true);
const point=new THREE.Vector3(),restSole=[];
for(let i=0;i<shoe.geometry.attributes.position.count;i++){shoe.getVertexPosition(i,point);point.applyMatrix4(shoe.matrixWorld);restSole.push([i,point.x,point.y]);}
const restMinimum=Math.min(...restSole.map(p=>p[2]));const soleIds=restSole.filter(p=>p[1]>0&&p[2]<restMinimum+.011).map(p=>p[0]);
function soleSpread(pose){applyPose(shoeRig,pose);const heights=soleIds.map(i=>{shoe.getVertexPosition(i,point);return point.applyMatrix4(shoe.matrixWorld).y;});return Math.max(...heights)-Math.min(...heights);}
const legacySoleSpread=soleSpread(figurePose('stand','human')),athleteSoleSpread=soleSpread(figurePose('stand','athlete'));
assert(legacySoleSpread>.10&&athleteSoleSpread<.025);
for(const key of Object.keys(POSES)){assert.equal(figurePose(key,'human'),POSES[key].p);if(key!=='stand')assert.equal(figurePose(key,'athlete'),POSES[key].p);}
const report={sourceSHA256:createHash('sha256').update(source.bytes).digest('hex'),athleteSHA256:createHash('sha256').update(derived.bytes).digest('hex'),bytes:derived.bytes.length,jointCount:53,meshCount:5,channels:APPEARANCE_CHANNELS,posedAppearanceChecks:poses,headFeetAndRigPreserved:true,originalSourceUnchanged:true,athleteStandOutsoleSpreadMetres:athleteSoleSpread,legacyStandOutsoleSpreadMetres:legacySoleSpread};
if(process.argv[2]){
 await mkdir(process.argv[2],{recursive:true});await writeFile(process.argv[2]+'/asset-check.json',JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify(report,null,2));
