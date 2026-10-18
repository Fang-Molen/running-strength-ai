import {setStoreBackend,type MemoryStore} from './storage.ts'

/** Byte-preserving migration with a synchronous localStorage compatibility copy.
 * A successful write always reaches localStorage before the IndexedDB mirror.
 * Rollback changes the backend, never restores an old snapshot over new training.
 */
export const CORE_DB='fangkun-core-storage-v1'
const MODE_KEY='fangkun-core-storage-mode-v1'
export type MigrationState='LOCAL'|'COPYING'|'INDEXED_DB_MIRROR'|'FALLBACK'|'BLOCKED'
let state:MigrationState='LOCAL',failure='',queue:Promise<void>=Promise.resolve(),database:IDBDatabase|null=null
let busy=false
type Snapshot=Record<string,string>
const snapshot=(box:Storage):Snapshot=>Object.fromEntries(Object.keys(box).filter(k=>k.startsWith('fr255-')).sort().map(k=>[k,box.getItem(k)!]))
const equal=(a:Snapshot,b:Snapshot)=>JSON.stringify(Object.entries(a).sort())===JSON.stringify(Object.entries(b).sort())
const schemaKnown=(rows:Snapshot)=>Object.values(rows).every(raw=>{
 try{const data=JSON.parse(raw);return !(data&&typeof data==='object'&&'schemaVersion' in data&&data.schemaVersion!==1)}catch{return true} // Opaque legacy values are copied exactly.
})
const statusEvent=()=>{if(typeof window!=='undefined')window.dispatchEvent(new Event('fangkun:storage-migration'))}
const report=(s:MigrationState,reason='')=>{state=s;failure=reason;statusEvent();return migrationStatus()}
export const migrationStatus=()=>({state,reason:failure,planWrite:false as const,originalDataDeleted:false as const})
function open():Promise<IDBDatabase>{
 if(database)return Promise.resolve(database)
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open(CORE_DB,1)
  request.onupgradeneeded=()=>{request.result.createObjectStore('kv');request.result.createObjectStore('meta')}
  request.onsuccess=()=>{database=request.result;database.onversionchange=()=>{database?.close();database=null;setStoreBackend(null);report('FALLBACK','VERSION_CHANGED')};resolve(database)}
  request.onerror=()=>reject(request.error??new Error('OPEN_FAILED'))
  request.onblocked=()=>reject(new Error('DATABASE_BLOCKED'))
 })
}
function transact(db:IDBDatabase,write:(tx:IDBTransaction)=>void):Promise<void>{
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(['kv','meta'],'readwrite')
  tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error??new Error('TRANSACTION_FAILED'));tx.onabort=()=>reject(tx.error??new Error('TRANSACTION_ABORTED'))
  try{write(tx)}catch(e){tx.abort();reject(e)}
 })
}
function readAll(db:IDBDatabase):Promise<Snapshot>{
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('kv','readonly'),rows:Snapshot={},cursor=tx.objectStore('kv').openCursor()
  cursor.onsuccess=()=>{const c=cursor.result;if(c){rows[String(c.key)]=String(c.value);c.continue()}}
  tx.oncomplete=()=>resolve(rows);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)
 })
}
async function digest(rows:Snapshot){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(Object.entries(rows).sort()))))).map(b=>b.toString(16).padStart(2,'0')).join('')}
async function copy(db:IDBDatabase,rows:Snapshot,baseline:boolean){
 const sha256=await digest(rows)
 await transact(db,tx=>{
  const data=tx.objectStore('kv'),meta=tx.objectStore('meta');data.clear()
  for(const [key,value] of Object.entries(rows))data.put(value,key)
  if(baseline){const prior=meta.get('rollback');prior.onsuccess=()=>{if(prior.result===undefined)meta.put({schemaVersion:1,rows,sha256,at:new Date().toISOString()},'rollback')}}
  meta.put({schemaVersion:1,state:'PREPARED',count:Object.keys(rows).length,sha256},'migration')
 })
}
function enqueue(key:string,value:string){
 if(!key.startsWith('fr255-')||!database)return
 const db=database
 queue=queue.then(()=>transact(db,tx=>{tx.objectStore('kv').put(value,key)})).catch(()=>{setStoreBackend(null);report('FALLBACK','MIRROR_WRITE_FAILED')})
}
function install(db:IDBDatabase){
 database=db
 const box=localStorage
 const backend:MemoryStore={getItem:key=>box.getItem(key),setItem:(key,value)=>{box.setItem(key,value);enqueue(key,value)},keys:()=>Object.keys(box)}
 setStoreBackend(backend)
}
async function migrate(){
 const db=await open(),rows=snapshot(localStorage)
 if(!schemaKnown(rows))return report('BLOCKED','UNKNOWN_SCHEMA_VERSION')
 report('COPYING')
 await copy(db,rows,true)
 const verified=await readAll(db)
 if(!equal(rows,verified)||!equal(rows,snapshot(localStorage)))return report('FALLBACK','SOURCE_CHANGED_DURING_COPY')
 const sha256=await digest(rows)
 await transact(db,tx=>tx.objectStore('meta').put({schemaVersion:1,state:'VERIFIED',count:Object.keys(rows).length,sha256},'migration'))
 localStorage.setItem(MODE_KEY,'INDEXED_DB_MIRROR')
 install(db)
 return report('INDEXED_DB_MIRROR')
}
export async function migrateCoreStorage(){
 if(busy)return migrationStatus()
 if(typeof indexedDB==='undefined'||typeof localStorage==='undefined')return report('BLOCKED','INDEXED_DB_UNAVAILABLE')
 busy=true
 try{
  if(typeof navigator!=='undefined'&&navigator.locks)return await navigator.locks.request('fangkun-core-migration',()=>migrate())
  return await migrate()
 }catch{setStoreBackend(null);return report('FALLBACK','MIGRATION_FAILED_OR_QUOTA')}
 finally{busy=false}
}
/** Include writers that still use native localStorage, without changing their schemas. */
export async function flushCoreStorage(){
 if(state!=='INDEXED_DB_MIRROR'||!database)return migrationStatus()
 await queue
 if(state!=='INDEXED_DB_MIRROR')return migrationStatus()
 try{
  const rows=snapshot(localStorage)
  if(!schemaKnown(rows))return report('BLOCKED','UNKNOWN_SCHEMA_VERSION')
  await copy(database,rows,false)
  if(!equal(rows,await readAll(database))||!equal(rows,snapshot(localStorage)))return report('FALLBACK','SOURCE_CHANGED_DURING_COPY')
  return migrationStatus()
 }catch{setStoreBackend(null);return report('FALLBACK','FLUSH_FAILED')}
}
/** Leaves all newer writes and both storage copies intact; no deletion or old-snapshot overwrite. */
export async function rollbackCoreStorage(){
 await queue
 setStoreBackend(null)
 try{localStorage.setItem(MODE_KEY,'LOCAL');return report('LOCAL')}catch{return report('FALLBACK','LOCAL_STORE_UNAVAILABLE')}
}
export async function initializeCoreStorage(){
 if(typeof localStorage==='undefined')return migrationStatus()
 try{if(localStorage.getItem(MODE_KEY)!=='INDEXED_DB_MIRROR')return migrationStatus();return await migrateCoreStorage()}
 catch{return report('FALLBACK','LOCAL_STORE_UNAVAILABLE')}
}
/** Read-only export for verification/backup; never pushes old values back into the fact layer. */
export async function readIndexedDbCopy(){return readAll(await open())}
