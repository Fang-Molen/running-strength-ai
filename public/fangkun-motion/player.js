/** Fangkun own-character GLB player. Never imports legacy athlete or body3d models. */
import * as THREE from '/demo3d/vendor/three.module.min.js';
import { GLTFLoader } from '/demo3d/vendor/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from '/demo3d/vendor/jsm/controls/OrbitControls.js';

const SAFE = /^\/fangkun-motion\/assets\/[A-Za-z0-9_-]+\.glb$/;
const sha256 = async buffer => {
  if (!globalThis.crypto?.subtle) throw Error('当前环境无法核对动画文件完整性');
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,'0')).join('');
};
function disposeTree(root) {
  root?.traverse(obj => {
    // GLTFLoader clones can share geometries; stage owns its own parsed GLB.
    obj.geometry?.dispose?.();
    for (const m of (Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [])) {
      for (const value of Object.values(m)) if (value?.isTexture) value.dispose();
      m.dispose?.();
    }
  });
}

/** Resolves only a preapproved, hashed GLB with baked joint tracks. */
export async function createApprovedMotionStage(canvas, entry, {signal, onFailure, onProgress} = {}) {
  if (!canvas || !entry || !SAFE.test(entry.uri) || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw Error('无效的动作资源');
  if (signal?.aborted) throw new DOMException('动作加载已取消','AbortError');
  const res = await fetch(entry.uri, {signal, cache:'no-store'});
  if (!res.ok || /text\/html/i.test(res.headers.get('content-type') || '')) throw Error('3D动画资源读取失败');
  const data = await res.arrayBuffer();
  if (data.byteLength > 30*1024*1024) throw Error('3D文件超过移动端预算，拒绝加载');
  if (signal?.aborted) throw new DOMException('动作加载已取消','AbortError');
  if (await sha256(data) !== entry.sha256) throw Error('动画文件校验失败，拒绝加载');
  // Parse the GLB JSON before GLTFLoader: a valid hash must not permit external fetches.
  const header=new DataView(data);
  if(data.byteLength<20 || header.getUint32(0,true)!==0x46546c67 || header.getUint32(4,true)!==2 || header.getUint32(8,true)!==data.byteLength || header.getUint32(16,true)!==0x4e4f534a) throw Error('无效的 GLB2 文件');
  const jsonLength=header.getUint32(12,true);
  if(jsonLength>data.byteLength-20) throw Error('GLB 内容损坏');
  const gltfDocument=JSON.parse(new TextDecoder().decode(new Uint8Array(data,20,jsonLength)));
  if([...(gltfDocument.buffers||[]),...(gltfDocument.images||[])].some(x=>x.uri)) throw Error('动画必须包含全部资源，不允许外部资源地址');
  const loaded = await new GLTFLoader().parseAsync(data, '');
  if (signal?.aborted) { disposeTree(loaded.scene); throw new DOMException('动作加载已取消','AbortError'); }
  const meshes=[], bones=new Set();
  loaded.scene.traverse(o => { if (o.isSkinnedMesh && o.skeleton?.bones?.length >= 15) { meshes.push(o); o.skeleton.bones.forEach(b=>bones.add(b.uuid)); } });
  const clip=loaded.animations.find(x=>x.name===entry.clip_name);
  const animated = clip?.tracks?.filter(t=>/\.quaternion$|\.position$/.test(t.name)) ?? [];
  if (!meshes.length || bones.size<15 || !clip || !Number.isFinite(clip.duration) || clip.duration<=0.1 || animated.length<12) {
    disposeTree(loaded.scene); throw Error('动画缺少合格蒙皮、骨架或烘焙轨道');
  }
  let renderer;
  try { renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,powerPreference:'low-power'}); }
  catch(e){disposeTree(loaded.scene);throw e;}
  renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  const scene=new THREE.Scene();scene.background=new THREE.Color('#17191c');
  scene.add(new THREE.HemisphereLight('#ffffff','#999da5',2.25));
  const key=new THREE.DirectionalLight('#ffffff',2.6);key.position.set(2.5,5,4);scene.add(key);
  scene.add(loaded.scene);
  const box=new THREE.Box3().setFromObject(loaded.scene);
  const center=box.getCenter(new THREE.Vector3());
  const size=box.getSize(new THREE.Vector3());
  if (!Number.isFinite(size.length()) || size.length()<0.2) {disposeTree(loaded.scene);renderer.dispose();throw Error('无效人物尺寸');}
  const radius=Math.max(1,size.length()*0.5), pivot=center.clone();
  const camera=new THREE.PerspectiveCamera(35,1,0.02,Math.max(80,radius*15));
  const controls=new OrbitControls(camera,canvas);
  controls.enablePan=false;controls.enableDamping=true;controls.dampingFactor=0.12;
  controls.minPolarAngle=0.62;controls.maxPolarAngle=Math.PI/2;
  controls.minDistance=radius*1.65;controls.maxDistance=radius*4.4;
  controls.minAzimuthAngle=-Math.PI;controls.maxAzimuthAngle=Math.PI;
  controls.target.copy(pivot);
  const distance=Math.max(radius*2.8,size.y*1.5);
  function setView(v) {
    const angles={front:0,side:Math.PI/2,back:Math.PI,three:Math.PI/4};
    const angle=angles[v]??Math.PI/4;
    camera.position.set(pivot.x+Math.sin(angle)*distance,pivot.y+Math.max(0.15,size.y*0.08),pivot.z+Math.cos(angle)*distance);
    controls.update();
  }
  setView('three');
  const mixer=new THREE.AnimationMixer(loaded.scene), action=mixer.clipAction(clip);
  action.setLoop(THREE.LoopRepeat, Infinity);action.play();
  let playing=false, disposed=false, visible=true, raf=0;
  let last=0, lastProgress=0;
  const resize=() => {
    if (disposed) return;
    const w=Math.max(1,canvas.clientWidth),h=Math.max(1,canvas.clientHeight);
    renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();
  };
  function frame(now){
    if(disposed)return;
    raf=requestAnimationFrame(frame);
    const dt=last?Math.min(.05,(now-last)/1000):0;last=now;
    if(document.hidden || !visible)return;
    if(playing)mixer.update(dt);
    if(now-lastProgress>100){onProgress?.(action.time/clip.duration);lastProgress=now;}
    controls.update();renderer.render(scene,camera);
  }
  const ro=typeof ResizeObserver!=='undefined'?new ResizeObserver(resize):null;
  ro?.observe(canvas);resize();
  const io=typeof IntersectionObserver!=='undefined'?new IntersectionObserver(e=>{visible=e.some(r=>r.isIntersecting);last=0;}):null;
  io?.observe(canvas);
  const onLost=event=>{event.preventDefault();playing=false;onFailure?.('3D设备渲染中断，已恢复文字说明');api.destroy();};
  canvas.addEventListener('webglcontextlost',onLost);
  raf=requestAnimationFrame(frame);
  const cancel=()=>api.destroy();signal?.addEventListener('abort',cancel,{once:true});
  const api={
    duration:clip.duration,
    setView,
    play(){playing=true;last=0;},pause(){playing=false;},
    setSpeed(value){mixer.timeScale=Math.min(2,Math.max(0.1,Number(value)||1));},
    seek(seconds){
      const time=Math.max(0,Math.min(clip.duration-1e-6,Number(seconds)||0));
      // AnimationMixer.setTime scales input by timeScale; seeking must use clip seconds.
      const speed=mixer.timeScale;mixer.timeScale=1;mixer.setTime(time);mixer.timeScale=speed;
      last=0;onProgress?.(time/clip.duration);renderer.render(scene,camera);
    },
    destroy(){
      if(disposed)return;disposed=true;cancelAnimationFrame(raf);signal?.removeEventListener('abort',cancel);
      canvas.removeEventListener('webglcontextlost',onLost);
      io?.disconnect();ro?.disconnect();
      controls.dispose();mixer.stopAllAction();mixer.uncacheRoot(loaded.scene);
      disposeTree(loaded.scene);renderer.dispose();
    }
  };
  return api;
}
