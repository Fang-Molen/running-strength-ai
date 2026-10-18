import {localAsset,type MediaFile} from './registry';
export const MEDIA_CACHE_PREFIX='fk-media-v2-';
export const MEDIA_ACTIVE_KEY='fk-media-v2-active';
export async function cacheMediaRelease(version:string,assets:readonly MediaFile[],env:{caches:CacheStorage;fetch:typeof fetch;storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>;crypto:Crypto},progress?:(n:number,total:number)=>void){
 if(!/^[a-zA-Z0-9-]{1,80}$/.test(version)||!assets.length||assets.some(a=>!localAsset(a))||new Set(assets.map(a=>a.path)).size!==assets.length)throw Error('Invalid media release');
 // A unique staging generation cannot corrupt the active generation even for the same version.
 const staging=MEDIA_CACHE_PREFIX+version+'-'+env.crypto.randomUUID(),old=env.storage.getItem(MEDIA_ACTIVE_KEY);
 try{
  const cache=await env.caches.open(staging);
  for(const [i,a] of assets.entries()){
   const response=await env.fetch(a.path);if(!response.ok||/text\/html/i.test(response.headers.get('content-type')||''))throw Error('Media download failed');
   const bytes=await response.arrayBuffer(),hash=Array.from(new Uint8Array(await env.crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
   if(bytes.byteLength!==a.bytes||hash!==a.sha256)throw Error('Media integrity mismatch');
   await cache.put(a.path,new Response(bytes,{headers:response.headers}));progress?.(i+1,assets.length);
  }
  env.storage.setItem(MEDIA_ACTIVE_KEY,staging);
  if(env.storage.getItem(MEDIA_ACTIVE_KEY)!==staging)throw Error('Media cache promotion failed');
 }catch(error){try{if(env.storage.getItem(MEDIA_ACTIVE_KEY)===staging){if(old===null)env.storage.removeItem(MEDIA_ACTIVE_KEY);else env.storage.setItem(MEDIA_ACTIVE_KEY,old)}}catch{/* no training-data store access */}await env.caches.delete(staging);throw error}
 // Only known media generations may be removed. Training/health and all other stores are untouched.
 if(old?.startsWith(MEDIA_CACHE_PREFIX)&&old!==staging)try{await env.caches.delete(old)}catch{/* cached predecessor is harmless */}
 return staging;
}
