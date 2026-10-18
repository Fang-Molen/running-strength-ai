// R6: embedded, hash-verified GLB bytes only. No legacy person and no external asset URLs.
import * as THREE from '/demo3d/vendor/three.module.min.js';
import {GLTFLoader} from '/demo3d/vendor/jsm/loaders/GLTFLoader.js';
import {OrbitControls} from '/demo3d/vendor/jsm/controls/OrbitControls.js';
const VIEWS={front:0,side:Math.PI/2,back:Math.PI,three:Math.PI/4};
const CHANNELS=['slender','lean','muscular','adipose'];
function embeddedGLB(data){
 if(!(data instanceof ArrayBuffer)||data.byteLength<32)throw Error('模型数据无效');
 const h=new DataView(data);
 if(h.getUint32(0,true)!==0x46546c67||h.getUint32(4,true)!==2||h.getUint32(8,true)!==data.byteLength||h.getUint32(16,true)!==0x4e4f534a)throw Error('不是GLB2模型');
 const n=h.getUint32(12,true);if(n>data.byteLength-20)throw Error('模型区块无效');
 const json=JSON.parse(new TextDecoder().decode(new Uint8Array(data,20,n)).trim());
 if([...(json.buffers??[]),...(json.images??[])].some(x=>x.uri))throw Error('模型必须内嵌贴图和网格');
 return json;
}
export async function createVerifiedViewer(canvas,{data,view='front',appearance={},signal,onFailure=()=>{}}){
 if(!(canvas instanceof HTMLCanvasElement))throw Error('人物画布不可用');
 embeddedGLB(data);
 const gltf=await new GLTFLoader().parseAsync(data,'');
 const avatar=gltf.scene;let renderer,ctl,ro,io,raf=0,alive=true,visible=true;
 const disposeTree=root=>root?.traverse(x=>{x.geometry?.dispose();for(const m of Array.isArray(x.material)?x.material:x.material?[x.material]:[]){for(const v of Object.values(m))if(v?.isTexture)v.dispose();m.dispose()}});
 const lost=e=>{e.preventDefault();destroy();onFailure('WebGL context lost')};
 function destroy(){if(!alive)return;alive=false;cancelAnimationFrame(raf);ro?.disconnect();io?.disconnect();ctl?.dispose();canvas.removeEventListener('webglcontextlost',lost);disposeTree(avatar);disposeTree(floor);renderer?.dispose()}
 let floor;
 try{
  if(signal?.aborted)throw Error('Aborted');
  let bones=0,skins=0;avatar.traverse(x=>{if(x.isBone)bones++;if(x.isSkinnedMesh&&x.geometry.attributes.skinIndex&&x.geometry.attributes.skinWeight)skins++});
  if(bones<20||!skins)throw Error('缺少实际骨骼和蒙皮');
  const box=new THREE.Box3().setFromObject(avatar),height=box.max.y-box.min.y;
  if(!Number.isFinite(height)||height<.3||height>5)throw Error('模型单位或高度异常');
  const center=box.getCenter(new THREE.Vector3());avatar.position.x-=center.x;avatar.position.y-=box.min.y;avatar.position.z-=center.z;avatar.updateMatrixWorld(true);
  function setAppearance(values){
   const found=new Set();avatar.traverse(x=>{if(!x.morphTargetDictionary||!x.morphTargetInfluences)return;for(const name of CHANNELS){const at=x.morphTargetDictionary[name];if(at!==undefined){const v=values[name]??0;if(!Number.isFinite(v))throw Error('无效外形参数');x.morphTargetInfluences[at]=Math.max(0,Math.min(1,v));found.add(name)}}});
   if(CHANNELS.some(n=>!found.has(n)))throw Error('模型缺少四个不同外形通道');
  }
  setAppearance(appearance);
  renderer=new THREE.WebGLRenderer({canvas,antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.outputColorSpace=THREE.SRGBColorSpace;
  const scene=new THREE.Scene();scene.background=new THREE.Color('#15181d');scene.add(avatar,new THREE.HemisphereLight(0xf7f7ff,0x51596b,1.7));
  const key=new THREE.DirectionalLight(0xffe9d1,2);key.position.set(2,4,3);scene.add(key);
  floor=new THREE.Mesh(new THREE.CircleGeometry(1.35,56),new THREE.MeshStandardMaterial({color:0x26292f,roughness:.98}));floor.rotation.x=-Math.PI/2;scene.add(floor);
  const camera=new THREE.PerspectiveCamera(30,1,.03,30);ctl=new OrbitControls(camera,canvas);ctl.enablePan=false;ctl.enableDamping=true;ctl.minPolarAngle=1.08;ctl.maxPolarAngle=1.8;ctl.minDistance=height*2.5;ctl.maxDistance=height*3.8;
  function setView(v){const yaw=VIEWS[v]??0,d=height*3.15;ctl.target.set(0,height*.5,0);camera.position.set(Math.sin(yaw)*d,height*.56,Math.cos(yaw)*d);ctl.update()}
  setView(view);
  const resize=()=>{const w=canvas.clientWidth||canvas.parentElement?.clientWidth,h=canvas.clientHeight||canvas.parentElement?.clientHeight;if(w&&h){renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()}};
  ro=new ResizeObserver(resize);ro.observe(canvas);resize();
  io=typeof IntersectionObserver==='function'?new IntersectionObserver(([x])=>{visible=!!x?.isIntersecting}):null;io?.observe(canvas);canvas.style.touchAction='none';canvas.addEventListener('webglcontextlost',lost);
  function draw(){if(!alive)return;raf=requestAnimationFrame(draw);if(visible&&!document.hidden){ctl.update();renderer.render(scene,camera)}}draw();
  return {setView,setAppearance,destroy};
 }catch(e){destroy();throw e}
}
