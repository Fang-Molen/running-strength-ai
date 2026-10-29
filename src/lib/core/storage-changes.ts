/** In-process invalidation only; no user records or authoritative versions live here. */
let revision=0
const listeners=new Set<(key:string)=>void>()
export const storageChangeRevision=()=>revision
export function notifyStorageChange(key:string){
 if(key.startsWith('fk-load-derived-cache-v2:'))return
 revision++
 for(const listener of listeners)try{listener(key)}catch{/* A cache cannot block a business write. */}
}
export function onStorageChange(listener:(key:string)=>void){listeners.add(listener);return()=>{listeners.delete(listener)}}
