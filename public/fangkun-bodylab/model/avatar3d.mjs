/* BODYLAB visual renderer only. Profile normalization and all data rules stay in profile.mjs.
 * Athletic illustration, never a scan or a prediction. No replacement of the action GLB. */
import * as THREE from '../vendor/three.module.min.js';
import {computeProfile} from './profile.mjs';
function palette(){
 const canvas=document.createElement('canvas');canvas.width=canvas.height=64;const ctx=canvas.getContext('2d');
 ctx.fillStyle='#999';ctx.fillRect(0,0,64,64);for(let y=0;y<64;y+=2)for(let x=0;x<64;x+=2){ctx.fillStyle=(x+y)%4?'#777':'#aaa';ctx.fillRect(x,y,1,2)}
 const weave=new THREE.CanvasTexture(canvas);weave.wrapS=weave.wrapT=THREE.RepeatWrapping;weave.repeat.set(9,9);
 const cloth=new THREE.MeshPhysicalMaterial({color:0x29323a,roughness:.88,sheen:.32,sheenColor:0x8b97a2,bumpMap:weave,bumpScale:.0007});
 return {skin:new THREE.MeshPhysicalMaterial({color:0xc39175,roughness:.61,metalness:0,clearcoat:.05}),cloth,shorts:cloth.clone(),hair:new THREE.MeshStandardMaterial({color:0x201c1b,roughness:.86}),sole:new THREE.MeshStandardMaterial({color:0x51565a,roughness:.9}),shoe:new THREE.MeshStandardMaterial({color:0xc5c4bd,roughness:.86}),seam:new THREE.MeshStandardMaterial({color:0x55606a,roughness:.9}),accent:new THREE.MeshStandardMaterial({color:0xd97845,roughness:.8}),eye:new THREE.MeshStandardMaterial({color:0x392e28,roughness:.9}),lip:new THREE.MeshStandardMaterial({color:0xa46e5c,roughness:.85}),weave};
}
// Sort stations consistently to avoid inward-facing normals on descending limbs.
function loft(stations,mat,radial=40){
 const s=[...stations].sort((a,b)=>a.y-b.y),dense=[];
 for(let j=0;j<s.length-1;j++)for(let k=0;k<5;k++){
  const t=k/5,a=s[j],b=s[j+1],prev=s[Math.max(0,j-1)],next=s[Math.min(s.length-1,j+2)],row={};
  for(const key of ['x','y','z','rx','rz']){const p0=prev[key]||0,p1=a[key]||0,p2=b[key]||0,p3=next[key]||0;row[key]=key==='y'?p1+(p2-p1)*t:.5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t*t+(-p0+3*p1-3*p2+p3)*t*t*t)}
  row.rx=Math.max(.0005,row.rx);row.rz=Math.max(.0005,row.rz);dense.push(row)
 }
 dense.push(s.at(-1));const positions=[],uvs=[],indices=[];
 for(let j=0;j<dense.length;j++){const {x=0,y,z=0,rx,rz}=dense[j];for(let i=0;i<=radial;i++){const a=i/radial*Math.PI*2;positions.push(x+Math.cos(a)*rx,y,z+Math.sin(a)*rz);uvs.push(i/radial,j/(dense.length-1))}}
 for(let j=0;j<dense.length-1;j++)for(let i=0;i<radial;i++){const a=j*(radial+1)+i,b=a+radial+1;indices.push(a,b,a+1,a+1,b,b+1)}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.setIndex(indices);g.computeVertexNormals();const m=new THREE.Mesh(g,mat);m.castShadow=true;m.receiveShadow=true;return m;
}
function oval(parent,mat,x,y,z,rx,ry,rz){const m=new THREE.Mesh(new THREE.SphereGeometry(1,32,24),mat);m.position.set(x,y,z);m.scale.set(rx,ry,rz);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m}
function human(raw,m){const p=computeProfile(raw),h=p.heightM,r=p.radii,f=p.sex==='female',g=new THREE.Group();
 const body=[{y:h*.48,rx:r.hip*.83,rz:r.hipDepth*.94},{y:h*.53,rx:r.hip*.96,rz:r.hipDepth},{y:h*.59,rx:r.waist*1.06,rz:r.bellyDepth*1.05},{y:h*.65,rx:r.underChest,rz:r.chestDepth},{y:h*.72,rx:r.chest,rz:r.chestDepth*(f?1.08:1.02)},{y:h*.77,rx:r.shoulder*.96,rz:r.chestDepth*.9},{y:h*.799,rx:r.shoulder*.94,rz:r.chestDepth*.74},{y:h*.819,rx:r.neck,rz:r.neck*.88}];
 g.add(loft(body,m.cloth));g.add(loft([{y:h*.812,rx:r.neck*.69,rz:r.neck*.65},{y:h*.86,rx:r.neck*.72,rz:r.neck*.69}],m.skin));
 // Sculpted jaw and cranium, small facial accents, consistent adult proportions.
 g.add(loft([{y:h*.855,rx:h*.016,rz:h*.024,z:h*.016},{y:h*.866,rx:h*.029,rz:h*.033,z:h*.013},{y:h*.895,rx:h*.043,rz:h*.046,z:h*.006},{y:h*.925,rx:h*.046,rz:h*.05},{y:h*.951,rx:h*.041,rz:h*.045,z:-h*.002},{y:h*.972,rx:h*.025,rz:h*.029,z:-h*.005},{y:h*.979,rx:.001,rz:.001,z:-h*.004}],m.skin));
 const hair=new THREE.Mesh(new THREE.SphereGeometry(1,40,24,0,Math.PI*2,0,Math.PI*.50),m.hair);hair.scale.set(h*.047,h*.054,h*.051);hair.position.set(0,h*.929,-h*.002);g.add(hair);
 if(f){oval(g,m.hair,0,h*.921,-h*.044,h*.040,h*.047,h*.024);const pony=oval(g,m.hair,h*.025,h*.861,-h*.064,h*.018,h*.068,h*.021);pony.rotation.z=-.17}else{const sweep=oval(g,m.hair,-h*.014,h*.967,h*.010,h*.036,h*.014,h*.035);sweep.rotation.z=.18}
 oval(g,m.skin,0,h*.907,h*.048,h*.008,h*.019,h*.014);
 oval(g,m.lip,0,h*.881,h*.043,h*.013,h*.002,h*.002);
 for(const sign of [-1,1]){
  oval(g,m.skin,sign*h*.046,h*.911,-.001,h*.008,h*.016,h*.010);
  oval(g,m.eye,sign*h*.018,h*.918,h*.047,h*.007,h*.0024,h*.002);
  const brow=oval(g,m.hair,sign*h*.019,h*.929,h*.046,h*.009,h*.002,h*.002);brow.rotation.z=-sign*.12;
  const lx=sign*r.hip*.55;
  // Single continuous calf/knee/thigh surfaces avoid ball-jointed mannequin shapes.
  g.add(loft([{x:lx+sign*.013,y:h*.064,rx:r.knee*.5,rz:r.knee*.55},{x:lx+sign*.013,y:h*.115,rx:r.knee*.57,rz:r.knee*.59},{x:lx+sign*.018,y:h*.19,z:-.007,rx:r.calf*.94,rz:r.calf},{x:lx+sign*.016,y:h*.235,z:-.009,rx:r.calf*.97,rz:r.calf*1.04},{x:lx+sign*.011,y:h*.285,z:.007,rx:r.knee*.95,rz:r.knee*.98},{x:lx+sign*.008,y:h*.33,rx:r.thigh*.83,rz:r.thigh*.88},{x:lx,y:h*.40,rx:r.thigh*.99,rz:r.thigh*1.03},{x:lx,y:h*.49,rx:r.thigh,rz:r.thigh}],m.skin));
  g.add(loft([{x:lx+sign*.007,y:h*.39,rx:r.thigh*1.04,rz:r.thigh*1.06},{x:lx,y:h*.445,rx:r.thigh*1.13,rz:r.thigh*1.13},{x:lx,y:h*.50,rx:r.thigh*1.12,rz:r.thigh*1.13}],m.shorts));
  g.add(loft([{x:lx+sign*.007,y:h*.391,rx:r.thigh*1.045,rz:r.thigh*1.065},{x:lx+sign*.007,y:h*.395,rx:r.thigh*1.045,rz:r.thigh*1.065}],m.seam));
  const ax=sign*r.shoulder*.91,ex=sign*(r.shoulder+h*.04),wx=sign*(r.shoulder+h*.055);
  g.add(loft([{x:wx,y:h*.475,z:.028,rx:r.forearm*.65,rz:r.forearm*.60},{x:wx,y:h*.51,z:.025,rx:r.forearm*.66,rz:r.forearm*.66},{x:ex,y:h*.585,z:.015,rx:r.forearm,rz:r.forearm*.94},{x:ex,y:h*.635,rx:r.forearm*1.06,rz:r.forearm*1.03},{x:ax+sign*h*.025,y:h*.70,rx:r.upperArm*.93,rz:r.upperArm*.95},{x:ax,y:h*.77,rx:r.upperArm,rz:r.upperArm},{x:ax*.98,y:h*.799,rx:r.upperArm*.82,rz:r.upperArm*.88}],m.skin));
  oval(g,m.cloth,ax,h*.774,0,r.upperArm*1.11,r.upperArm*1.12,r.upperArm*1.13);
  // Short sleeve joins the shoulder, same kit on both sexes and both situations.
  g.add(loft([{x:ax+sign*h*.018,y:h*.728,rx:r.upperArm*1.1,rz:r.upperArm*1.09},{x:ax+sign*.004,y:h*.77,rx:r.upperArm*1.12,rz:r.upperArm*1.15},{x:ax*.96,y:h*.792,rx:r.upperArm*1.03,rz:r.upperArm*1.04}],m.cloth));
  oval(g,m.skin,wx,h*.462,.031,r.forearm*.68,h*.025,r.forearm*.45);oval(g,m.skin,wx-sign*r.forearm*.53,h*.466,.042,r.forearm*.23,h*.013,r.forearm*.25);
  g.add(loft([{x:lx+sign*.013,y:h*.04,rx:r.knee*.56,rz:r.knee*.6},{x:lx+sign*.013,y:h*.098,rx:r.knee*.57,rz:r.knee*.6}],m.shoe));
  oval(g,m.shoe,lx+sign*.013,h*.028,h*.025,h*.029,h*.025,h*.064);oval(g,m.sole,lx+sign*.013,h*.011,h*.028,h*.031,h*.008,h*.067);
  for(let i=0;i<3;i++)oval(g,m.seam,lx+sign*.013,h*.049-i*h*.003,h*.025+i*h*.009,h*.016,.0009,.001);
 }
 g.add(loft([{y:h*.47,rx:r.hip*.84,rz:r.hipDepth*.92},{y:h*.51,rx:r.hip*.98,rz:r.hipDepth*1.01},{y:h*.54,rx:r.waist*1.13,rz:r.bellyDepth*1.08}],m.shorts));
 g.add(loft([{y:h*.537,rx:r.waist*1.135,rz:r.bellyDepth*1.085},{y:h*.543,rx:r.waist*1.135,rz:r.bellyDepth*1.085}],m.seam));
 oval(g,m.accent,-r.chest*.5,h*.748,r.chestDepth*.91,.014,.002,.0015);
 return {group:g,profile:p};
}
export class AvatarViewer{
 constructor(canvas,{onError,onYawChange}={}){this.canvas=canvas;this.onYawChange=onYawChange;this.yaw=0;this.frameHeight=1.8;this.error=null;this.handlers=[];
  try{this.materials=palette();this.renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'low-power',preserveDrawingBuffer:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.12;this.renderer.setClearColor(0,0);
   this.scene=new THREE.Scene();this.camera=new THREE.OrthographicCamera(-.6,.6,2.12,-.12,.01,30);this.camera.position.set(0,1.02,6);this.camera.lookAt(0,1.02,0);
   this.scene.add(new THREE.HemisphereLight(0xf4e9df,0x3f4b53,1.55));for(const [pos,power,color] of [[[-2,3.5,4],3,0xffead7],[[2.5,2,2],1.3,0xc9dce7],[[1,3,-2],2.5,0xe7e1d7]]){const l=new THREE.DirectionalLight(color,power);l.position.set(...pos);this.scene.add(l)}
   const shadow=document.createElement('canvas');shadow.width=shadow.height=128;const c=shadow.getContext('2d'),gr=c.createRadialGradient(64,64,5,64,64,64);gr.addColorStop(0,'rgba(0,0,0,.5)');gr.addColorStop(1,'rgba(0,0,0,0)');c.fillStyle=gr;c.fillRect(0,0,128,128);this.shadowTexture=new THREE.CanvasTexture(shadow);const floor=new THREE.Mesh(new THREE.PlaneGeometry(1.1,.7),new THREE.MeshBasicMaterial({map:this.shadowTexture,transparent:true,depthWrite:false}));floor.rotation.x=-Math.PI/2;floor.position.y=.001;this.scene.add(floor);
   this.resizeObs=new ResizeObserver(()=>this.resize());this.resizeObs.observe(canvas);this.attachControls();this.resize();
  }catch(e){this.error=e;onError?.(e)}
 }
 attachControls(){let down=false,last=0;const start=e=>{if(e.button!==0)return;down=true;last=e.clientX;this.canvas.setPointerCapture?.(e.pointerId)},move=e=>{if(!down)return;const delta=e.clientX-last;last=e.clientX;this.setYaw(this.yaw+delta*.009);this.onYawChange?.(this.yaw)},end=()=>{down=false};for(const [name,fn] of [['pointerdown',start],['pointermove',move],['pointerup',end],['pointercancel',end]]){this.canvas.addEventListener(name,fn);this.handlers.push([name,fn])}}
 setYaw(y){this.yaw=y;if(this.group)this.group.rotation.y=y;this.render()}
 setView(view){this.setYaw(view==='back'?Math.PI:view==='side'?Math.PI/2:0)}
 setFraming(height){this.frameHeight=height;this.resize()}
 resize(){if(!this.renderer||this.disposed)return;const box=this.canvas.getBoundingClientRect(),w=Math.max(1,box.width),h=Math.max(1,box.height);this.renderer.setSize(w,h,false);const span=this.frameHeight+.17;this.camera.position.y=this.frameHeight/2;this.camera.lookAt(0,this.frameHeight/2,0);this.camera.left=-span*w/h/2;this.camera.right=span*w/h/2;this.camera.top=span/2;this.camera.bottom=-span/2;this.camera.updateProjectionMatrix();this.render()}
 update(raw){if(!this.renderer||this.disposed)return;if(this.group){this.scene.remove(this.group);this.group.traverse(o=>o.geometry?.dispose())}const next=human(raw,this.materials);this.group=next.group;this.profile=next.profile;this.group.rotation.y=this.yaw;this.scene.add(this.group);this.render()}
 render(){if(this.renderer&&!this.disposed)this.renderer.render(this.scene,this.camera)}
 screenshot(){return this.canvas.toDataURL('image/png')}
 dispose(){this.disposed=true;for(const [name,fn] of this.handlers)this.canvas.removeEventListener(name,fn);this.resizeObs?.disconnect();this.scene?.traverse(o=>{o.geometry?.dispose();if(o.material&&!Object.values(this.materials||{}).includes(o.material))o.material.dispose?.()});for(const v of Object.values(this.materials||{}))v.dispose?.();this.shadowTexture?.dispose();this.renderer?.dispose()}
}
