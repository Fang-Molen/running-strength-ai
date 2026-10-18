/** Export genuine posed/morphed GLB vertices for software GL inspection. No generated mockup. */
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import * as THREE from '../../public/demo3d/vendor/three.module.min.js';
import {makeRig,applyPose,applyAppearance,applyMotionPose,poseAt} from '../../public/demo3d/viewer3d.js';
import MO from '../../public/demo3d/motions.js';
import {figurePose} from '../../public/demo3d/body3d.js';
import {readGlb,parseGlb} from './asset-io.mjs';
const output=resolve(process.argv[2]||'/tmp/fangkun-athlete-render');await mkdir(output,{recursive:true});
const raw=await readGlb('athlete'),gltf=await parseGlb(raw);
const preparation=process.argv.includes('--warmup');
const cases=preparation ? Object.entries(MO).filter(([k])=>k.startsWith('warmup_')).map(([k])=>[k,{}]) : [['neutral',{}],['slender',{slender:1}],['lean',{lean:1}],['muscular',{muscular:1}],['adipose',{adipose:1}]];
const manifest={kind:preparation?'preparation':'appearance',model:'athlete.glb',renderKind:'exact posed/morphed geometry; approximate studio shading',cases:[]};
for(const [label,channels]of cases){
 const rig=makeRig(gltf,{hi:new Array(40).fill(0),border:0});applyAppearance(rig,channels);if(preparation){const mo=MO[label],time=label==='warmup_squat'?2.05:label==='warmup_hinge'?2.1:label==='warmup_arm_circle'?1.6:0;applyMotionPose(rig,mo,poseAt(mo,time).pose);}else applyPose(rig,figurePose('stand','athlete'));
 let minimumY=Infinity;const v=new THREE.Vector3();rig.root.updateMatrixWorld(true);
 rig.root.traverse(o=>{if(!o.isMesh)return;for(let i=0;i<o.geometry.attributes.position.count;i++){o.getVertexPosition(i,v);v.applyMatrix4(o.matrixWorld);minimumY=Math.min(minimumY,v.y);}});
 rig.root.position.y-=minimumY;rig.root.updateMatrixWorld(true);
 const scene={name:label,channels,meshes:[]};let meshIndex=0;
 for(const node of raw.json.nodes.filter(n=>n.mesh!==undefined)){
  const o=rig.root.getObjectByName(node.name.replace(/[.]/g,''))||rig.root.getObjectByName(node.name);
  if(!o)throw new Error('Missing exact source mesh '+node.name);
  const g=o.geometry,count=g.attributes.position.count,vertices=new Float32Array(count*8),normal=new THREE.Vector3(),weighted=new THREE.Matrix4(),tmp=new THREE.Matrix4(),normalMat=new THREE.Matrix3();
  o.skeleton.update();const bones=o.skeleton.bones.map((_,i)=>new THREE.Matrix4().fromArray(o.skeleton.boneMatrices,i*16));
  for(let i=0;i<count;i++){
   o.getVertexPosition(i,v);v.applyMatrix4(o.matrixWorld);vertices.set([v.x,v.y,v.z],i*8);
   normal.fromBufferAttribute(g.attributes.normal,i);
   (g.morphAttributes.normal||[]).forEach((a,k)=>{const w=o.morphTargetInfluences[k];if(w)normal.addScaledVector(new THREE.Vector3().fromBufferAttribute(a,i),w);});
   weighted.elements.fill(0);
   for(let k=0;k<4;k++){
    const id=g.attributes.skinIndex.getComponent(i,k),w=g.attributes.skinWeight.getComponent(i,k);if(!w)continue;
    for(let e=0;e<16;e++)weighted.elements[e]+=bones[id].elements[e]*w;
   }
   tmp.multiplyMatrices(o.bindMatrixInverse,weighted).multiply(o.bindMatrix).premultiply(o.matrixWorld);normalMat.getNormalMatrix(tmp);normal.applyMatrix3(normalMat).normalize();
   vertices.set([normal.x,normal.y,normal.z,g.attributes.uv.getX(i),g.attributes.uv.getY(i)],i*8+3);
  }
  const indices=Uint32Array.from(g.index.array),name=`${label}-${meshIndex++}`,material=raw.json.materials[raw.json.meshes[node.mesh].primitives[0].material];
  await writeFile(output+'/'+name+'.vertices',Buffer.from(vertices.buffer));await writeFile(output+'/'+name+'.indices',Buffer.from(indices.buffer));
  scene.meshes.push({name,sourceName:node.name,vertexCount:count,indexCount:indices.length,imageIndex:raw.json.textures[material.pbrMetallicRoughness.baseColorTexture.index].source,roughnessImageIndex:material.pbrMetallicRoughness.metallicRoughnessTexture?raw.json.textures[material.pbrMetallicRoughness.metallicRoughnessTexture.index].source:null,roughness:material.pbrMetallicRoughness.roughnessFactor,alphaCutoff:material.alphaMode==='MASK'?material.alphaCutoff||.5:0});
 }
 manifest.cases.push(scene);
}
await writeFile(output+'/geometry.json',JSON.stringify(manifest,null,2));console.log(output+'/geometry.json');
