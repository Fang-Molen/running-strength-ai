/** Portable, explicitly user-triggered evidence backup. Never writes training/body facts. */
import { listConfirmedDeviceEvidence, readConfirmedDeviceEvidence, storeConfirmedDeviceEvidence } from './device-evidence-idb.ts'
import { validReading, type DeviceConfirmed } from './device-image-evidence.ts'
export type EvidenceBackupEntry = { record: DeviceConfirmed; imageBase64: string | null; imageType: string | null }
export type EvidenceBackup = { format: 'fr255-device-evidence-backup'; version: 1; exportedAt: string; entries: EvidenceBackupEntry[] }
const MAX_IMAGE_BYTES = 15 * 1024 * 1024
const MAX_ENTRIES = 2000
function encode(bytes: Uint8Array): string { let result=''; for(let i=0;i<bytes.length;i+=8192) result+=String.fromCharCode(...bytes.subarray(i,i+8192)); return btoa(result) }
function decode(data:string):Uint8Array { const raw=atob(data); const out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out }
export function validateEvidenceBackup(value:unknown): asserts value is EvidenceBackup {
  if(!value || typeof value!=='object') throw new Error('备份格式无效')
  const b=value as Partial<EvidenceBackup>
  if(b.format!=='fr255-device-evidence-backup'||b.version!==1||!Array.isArray(b.entries)||b.entries.length>MAX_ENTRIES)throw new Error('不支持的备份格式或数量')
  const ids=new Set<string>()
  for(const e of b.entries){
    const r=e?.record
    if(!r || r.schemaVersion!==1 || r.consent!=='USER_CONFIRMED'||r.destination!=='DEVICE_EVIDENCE_ONLY'||typeof r.id!=='string'||!r.id||ids.has(r.id)||typeof r.rawText!=='string'||typeof r.deviceLabel!=='string'||typeof r.recordedAt!=='string'||typeof r.confirmedAt!=='string'||!Array.isArray(r.readings)||r.readings.length>500||!r.readings.every(validReading))throw new Error('备份包含无效或重复的证据')
    ids.add(r.id)
    if(e.imageBase64!==null){if(typeof e.imageBase64!=='string'||e.imageBase64.length>Math.ceil(MAX_IMAGE_BYTES/3)*4+8||!/^[A-Za-z0-9+/]*={0,2}$/.test(e.imageBase64)||typeof e.imageType!=='string'||!/^image\/(png|jpeg|webp|heic|heif)$/.test(e.imageType))throw new Error('原图格式无效')}
    else if(e.imageType!==null)throw new Error('原图元数据不一致')
  }
}
export async function exportDeviceEvidenceBackup():Promise<EvidenceBackup>{
  const entries:EvidenceBackupEntry[]=[]
  for(const record of await listConfirmedDeviceEvidence()){
    const stored=await readConfirmedDeviceEvidence(record.id)
    if(!stored)throw new Error('导出过程中证据发生变化，请重试')
    const blob=stored.originalImage
    if(blob && blob.size>MAX_IMAGE_BYTES)throw new Error('原图过大，请单独导出')
    entries.push({record:stored.record,imageBase64:blob?encode(new Uint8Array(await blob.arrayBuffer())):null,imageType:blob?blob.type:null})
  }
  return {format:'fr255-device-evidence-backup',version:1,exportedAt:new Date().toISOString(),entries}
}
/** Caller must display a preview and obtain explicit confirmation before passing true. */
export async function importDeviceEvidenceBackup(input:unknown,userConfirmed:boolean):Promise<{saved:number;duplicates:number}>{
  validateEvidenceBackup(input)
  if(!userConfirmed)throw new Error('必须先预览并确认恢复操作')
  let saved=0,duplicates=0
  for(const entry of input.entries){
    const bytes=entry.imageBase64===null?null:decode(entry.imageBase64)
    if(bytes && bytes.byteLength>MAX_IMAGE_BYTES)throw new Error('原图超过允许大小')
    const image=bytes?new Blob([bytes as BlobPart],{type:entry.imageType!}):null
    const status=await storeConfirmedDeviceEvidence(entry.record,image)
    if(status==='SAVED')saved++;else duplicates++
  }
  return {saved,duplicates}
}
