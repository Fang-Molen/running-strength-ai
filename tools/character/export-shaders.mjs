/** Expand the real Three.js + athlete material hooks for offline ES3 compile/link checks. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import * as THREE from '../../public/demo3d/vendor/three.module.min.js';
import {makeRig} from '../../public/demo3d/viewer3d.js';
import {readGlb,parseGlb} from './asset-io.mjs';
const output=resolve(process.argv[2]||'/tmp/fangkun-athlete-shaders');await mkdir(output,{recursive:true});
const raw=await readGlb('athlete'),gltf=await parseGlb(raw);
// Texture objects reproduce feature flags without invoking a browser image loader.
gltf.scene.traverse(o=>{if(o.isMesh&&/eyebrow/.test(o.name))o.material.normalMap=new THREE.DataTexture(new Uint8Array([128,128,255,255]),1,1);});
const rig=makeRig(gltf,{hi:new Array(40).fill(0),border:0});
function expand(s){return s.replace(/#include +<([\w\d./]+)>/g,(_,key)=>{assert(THREE.ShaderChunk[key],key);return expand(THREE.ShaderChunk[key]);});}
const common=`precision highp float;
precision highp int;
precision highp sampler2DArray;
#define HIGH_PRECISION
#define USE_MAP
#define USE_UV
#define OPAQUE
#define DOUBLE_SIDED
#define MAP_UV uv
#define NUM_DIR_LIGHTS 0
#define NUM_POINT_LIGHTS 0
#define NUM_SPOT_LIGHTS 0
#define NUM_SPOT_LIGHT_COORDS 0
#define NUM_RECT_AREA_LIGHTS 0
#define NUM_HEMI_LIGHTS 0
#define NUM_DIR_LIGHT_SHADOWS 0
#define NUM_POINT_LIGHT_SHADOWS 0
#define NUM_SPOT_LIGHT_SHADOWS 0
#define NUM_SPOT_LIGHT_MAPS 0
#define NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS 0
#define NUM_CLIPPING_PLANES 0
#define UNION_CLIPPING_PLANES 0
uniform mat4 viewMatrix;
uniform vec3 cameraPosition;
uniform bool isOrthographic;
`;
const vertPrefix=`#version 300 es
#define attribute in
#define varying out
#define texture2D texture
${common}
uniform mat4 modelMatrix;uniform mat4 modelViewMatrix;uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;
attribute vec3 position;attribute vec3 normal;attribute vec2 uv;
#define USE_SKINNING
attribute vec4 skinIndex;attribute vec4 skinWeight;
`;
const fragPrefix=`#version 300 es
#define varying in
#define texture2D texture
#define textureCube texture
#define texture2DProj textureProj
#define texture2DLodEXT textureLod
#define texture2DProjLodEXT textureProjLod
#define textureCubeLodEXT textureLod
#define texture2DGradEXT textureGrad
#define texture2DProjGradEXT textureProjGrad
#define textureCubeGradEXT textureGrad
#define gl_FragColor pc_fragColor
#define gl_FragDepthEXT gl_FragDepth
layout(location=0) out highp vec4 pc_fragColor;
${common}
vec4 linearToOutputTexel(vec4 value) { return value; }
`;
const manifest=[];
rig.root.traverse(o=>{if(!o.isMesh)return;
 const m=o.material,lib=m.isMeshPhysicalMaterial?THREE.ShaderLib.physical:THREE.ShaderLib.standard;
 const shader={uniforms:{},vertexShader:lib.vertexShader,fragmentShader:lib.fragmentShader};m.onBeforeCompile(shader);
 let vflags='',fflags='';
 if(o.geometry.morphAttributes.position?.length)vflags+='#define USE_MORPHTARGETS\n#define USE_MORPHNORMALS\n#define MORPHTARGETS_COUNT 4\n#define MORPHTARGETS_TEXTURE_STRIDE 2\n';
 if(m.normalMap){vflags+='#define USE_NORMALMAP\n#define NORMALMAP_UV uv\n';fflags+='#define USE_NORMALMAP\n#define USE_NORMALMAP_TANGENTSPACE\n';}
 if(m.alphaTest>0)fflags+='#define USE_ALPHATEST\n#define ALPHA_TO_COVERAGE\n';
 manifest.push({name:o.name,morphTargets:o.geometry.morphAttributes.position?.length||0,alphaCutoff:m.alphaTest,normalMap:!!m.normalMap});
 manifest.at(-1).vertex=vertPrefix+vflags+expand(shader.vertexShader);manifest.at(-1).fragment=fragPrefix+fflags+expand(shader.fragmentShader);
});
for(const item of manifest){await writeFile(output+'/'+item.name+'.vert',item.vertex);await writeFile(output+'/'+item.name+'.frag',item.fragment);delete item.vertex;delete item.fragment;}
await writeFile(output+'/shaders.json',JSON.stringify(manifest,null,2));console.log('Prepared 5 vertex+fragment pairs, including 4 position/normal morph targets and 53-bone skinning.');
