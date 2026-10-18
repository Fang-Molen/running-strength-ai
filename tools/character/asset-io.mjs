/** Offline GLB loading for exact geometry checks; textures stay available in the source binary. */
import {readFile} from 'node:fs/promises';
import * as THREE from '../../public/demo3d/vendor/three.module.min.js';
import {GLTFLoader} from '../../public/demo3d/vendor/jsm/loaders/GLTFLoader.js';
const project=new URL('../../',import.meta.url);
export async function readGlb(name='athlete'){
 const bytes=await readFile(new URL(`public/demo3d/models/${name}.glb`,project));const len=bytes.readUInt32LE(12);
 return {bytes,json:JSON.parse(bytes.subarray(20,20+len)),binary:bytes.subarray(28+len)};
}
export async function parseGlb(raw){
 globalThis.ProgressEvent??=class ProgressEvent{constructor(type,options){this.type=type;Object.assign(this,options);}};
 const json=structuredClone(raw.json);json.buffers[0].uri='data:application/octet-stream;base64,'+raw.binary.toString('base64');
 for(const m of json.materials){delete m.pbrMetallicRoughness?.baseColorTexture;delete m.pbrMetallicRoughness?.metallicRoughnessTexture;delete m.normalTexture;}
 const gltf=await new GLTFLoader().parseAsync(JSON.stringify(json),'');
 gltf.scene.traverse(o=>{if(o.isMesh)o.material.map=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1);});
 return gltf;
}
