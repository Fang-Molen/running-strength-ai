// Shared identity for BOTH health-3D and strength/running demonstration videos.
import { R6_EXERCISE_IDS } from './inventory.ts';
export type Gender = 'male'|'female';
export const ID = { male:'fk-male-20261017', female:'fk-female-20261017' } as const;
export const REVIEWS=['rights','identity','rig','morph','mobile'] as const;
export const VIDEO_REVIEWS=['rights','identity','biomechanics','equipment','mobile'] as const;
export const preview=(sex:Gender,view:'front'|'side'|'back'|'three'='front')=>`/fangkun-character/${sex}-${view}.webp`;
export type ModelAsset={id:string;gender:Gender;url:string;sha256:string;status:'APPROVED';version:number;reviewer:string;licenseEvidence:string;qaEvidence:string;reviews:Record<(typeof REVIEWS)[number],'PASS'>};
export type VideoAsset={exerciseId:string;gender:Gender;characterId:string;url:string;sha256:string;status:'APPROVED';reviewer:string;licenseEvidence:string;qaEvidence:string;reviews:Record<(typeof VIDEO_REVIEWS)[number],'PASS'>};
const obj=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const sha=(x:unknown)=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const proof=(x:unknown)=>typeof x==='string'&&/^docs\/media-qa\/[a-zA-Z0-9_./-]+\.(?:json|pdf|md)$/.test(x)&&!x.includes('..');
const review=(x:unknown,n:readonly string[])=>obj(x)&&n.every(k=>x[k]==='PASS');
const reviewer=(x:unknown)=>typeof x==='string'&&x.trim().length>2&&!/TODO|TBD|PENDING|待填/i.test(x);
export function isModel(x:unknown):x is ModelAsset{
 if(!obj(x)||(x.gender!=='male'&&x.gender!=='female'))return false;
 const s=x.gender as Gender;
 return x.id===ID[s]&&x.status==='APPROVED'&&typeof x.url==='string'&&new RegExp(`^/fangkun-character/models/${s}-[a-zA-Z0-9_-]+\\.glb$`).test(x.url)&&sha(x.sha256)&&Number.isInteger(x.version)&&(x.version as number)>0&&reviewer(x.reviewer)&&proof(x.licenseEvidence)&&proof(x.qaEvidence)&&review(x.reviews,REVIEWS);
}
export function isVideo(x:unknown):x is VideoAsset{
 if(!obj(x)||(x.gender!=='male'&&x.gender!=='female'))return false;
 const s=x.gender as Gender;
 return x.characterId===ID[s]&&x.status==='APPROVED'&&typeof x.exerciseId==='string'&&(R6_EXERCISE_IDS as readonly string[]).includes(x.exerciseId)&&typeof x.url==='string'&&/^\/fangkun-video\/assets\/[a-zA-Z0-9_-]+\.mp4$/.test(x.url)&&sha(x.sha256)&&reviewer(x.reviewer)&&proof(x.licenseEvidence)&&proof(x.qaEvidence)&&review(x.reviews,VIDEO_REVIEWS);
}
export function selectModel(x:unknown,s:Gender):ModelAsset|null{
 if(!obj(x)||x.schema!=='fangkun-character-v1'||!Array.isArray(x.assets)||!x.assets.every(isModel))return null;
 if(new Set(x.assets.map((a:ModelAsset)=>a.gender)).size!==x.assets.length)return null;
 return x.assets.find((a:ModelAsset)=>a.gender===s)??null;
}
export function validateVideoManifest(x:unknown):x is {schema:'fangkun-video-v2';assets:VideoAsset[]}{
 if(!obj(x)||x.schema!=='fangkun-video-v2'||!Array.isArray(x.assets)||!x.assets.every(isVideo))return false;
 if(new Set(x.assets.map((a:VideoAsset)=>`${a.exerciseId}|${a.gender}`)).size!==x.assets.length)return false;
 return true;
}
export function selectVideo(x:unknown,ex:string,s:Gender):VideoAsset|null{
 if(!validateVideoManifest(x))return null;
 return x.assets.find((a:VideoAsset)=>a.exerciseId===ex&&a.gender===s)??null;
}
export async function fetchModel(s:Gender,signal?:AbortSignal){const r=await fetch('/fangkun-character/manifest.json',{cache:'no-store',signal});if(!r.ok)throw Error('人物资源认证清单不可用');return selectModel(await r.json(),s)}
export async function fetchVideo(ex:string,s:Gender,signal?:AbortSignal){const r=await fetch('/fangkun-video/manifest-r6.json',{cache:'no-store',signal});if(!r.ok)throw Error('动作资源认证清单不可用');return selectVideo(await r.json(),ex,s)}

/** A manifest label alone is not enough: verify the bytes before handing them to a player. */
export async function verifiedMediaBytes(asset:ModelAsset|VideoAsset,signal?:AbortSignal):Promise<ArrayBuffer>{
 if(!isModel(asset)&&!isVideo(asset))throw Error('素材审核条目无效');
 const r=await fetch(asset.url,{signal,cache:'no-store',redirect:'error'});
 if(!r.ok||/text\/html/i.test(r.headers.get('content-type')??''))throw Error('素材文件不可用');
 const data=await r.arrayBuffer(),limit=isModel(asset)?32*1024*1024:15*1000*1000;
 if(!data.byteLength||data.byteLength>limit)throw Error('素材大小不符合移动端限制');
 const digest=await crypto.subtle.digest('SHA-256',data);
 const hash=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
 if(hash!==asset.sha256)throw Error('素材版本校验失败');
 if(signal?.aborted)throw new DOMException('Aborted','AbortError');
 return data;
}
