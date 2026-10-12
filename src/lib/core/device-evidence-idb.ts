/** Browser IndexedDB evidence vault. Each record and its original image are one atomic row. */
import type { DeviceConfirmed } from './device-image-evidence.ts'
const DB_NAME = 'fr255-device-evidence-v1'
const STORE = 'confirmed'
export type StoredDeviceEvidence = { id: string; record: DeviceConfirmed; originalImage: Blob | null }
function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error ?? new Error('IndexedDB request failed'))})
}
async function openEvidenceDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') throw new Error('当前浏览器不支持 IndexedDB，无法安全保存原图与证据')
  const request = indexedDB.open(DB_NAME,1)
  request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE,{keyPath:'id'})}
  request.onblocked=()=>{ /* Another tab is migrating this DB; do not delete or overwrite it. */ }
  return requestResult(request)
}
export async function storeConfirmedDeviceEvidence(record:DeviceConfirmed,originalImage:Blob|null):Promise<'SAVED'|'ALREADY_EXISTS'> {
  const db=await openEvidenceDb()
  try {
    return await new Promise<'SAVED'|'ALREADY_EXISTS'>((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite')
      const store=tx.objectStore(STORE)
      let duplicate=false
      const check=store.get(record.id)
      check.onsuccess=()=>{if(check.result)duplicate=true;else store.add({id:record.id,record,originalImage} satisfies StoredDeviceEvidence)}
      tx.oncomplete=()=>resolve(duplicate?'ALREADY_EXISTS':'SAVED')
      tx.onerror=()=>reject(tx.error??new Error('保存失败'))
      tx.onabort=()=>reject(tx.error??new Error('事务中止'))
    })
  } finally {db.close()}
}
export async function listConfirmedDeviceEvidence():Promise<DeviceConfirmed[]> {
  const db=await openEvidenceDb()
  try {const rows=await requestResult(db.transaction(STORE,'readonly').objectStore(STORE).getAll()) as StoredDeviceEvidence[];return rows.map(r=>r.record).sort((a,b)=>b.confirmedAt.localeCompare(a.confirmedAt))} finally {db.close()}
}
export async function readConfirmedDeviceEvidence(id:string):Promise<StoredDeviceEvidence|null> {
  const db=await openEvidenceDb()
  try {return (await requestResult(db.transaction(STORE,'readonly').objectStore(STORE).get(id)) as StoredDeviceEvidence|undefined)??null}finally{db.close()}
}
