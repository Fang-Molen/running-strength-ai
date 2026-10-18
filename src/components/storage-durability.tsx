import {useEffect,useState} from 'react'
import {migrateCoreStorage,rollbackCoreStorage,flushCoreStorage,migrationStatus} from '@/lib/core/storage-indexeddb'

/** Best-effort browser persistence; never promises protection against manual deletion or OS eviction. */
export function StorageDurability(){
 const [state,setState]=useState<'CHECKING'|'PERSISTED'|'VOLATILE'|'UNSUPPORTED'|'ERROR'>('CHECKING')
 const [usage,setUsage]=useState<number|null>(null)
 const [migration,setMigration]=useState(migrationStatus())
 async function check(request=false){
  try{
   if(!navigator.storage?.persisted){setState('UNSUPPORTED');return}
   const persisted=request&&navigator.storage.persist?await navigator.storage.persist():await navigator.storage.persisted()
   setState(persisted?'PERSISTED':'VOLATILE')
   const estimate=await navigator.storage.estimate?.();setUsage(estimate?.usage??null)
  }catch{setState('ERROR')}
 }
 useEffect(()=>{void check()},[])
 useEffect(()=>{const update=()=>setMigration(migrationStatus());window.addEventListener('fangkun:storage-migration',update);return()=>window.removeEventListener('fangkun:storage-migration',update)},[])
 return <section data-testid="storage-durability" className="my-3 rounded-card border border-line p-3 text-sm">
  <p role="status">{state==='PERSISTED'?'浏览器已授予持久存储':state==='VOLATILE'?'浏览器尚未授予持久存储':state==='UNSUPPORTED'?'此浏览器不支持持久存储申请':state==='ERROR'?'存储状态暂时无法读取':'正在检查本机存储'}{usage!==null?`，当前约用${(usage/1024/1024).toFixed(1)} MB`:''}。</p>
  <p className="mt-1 text-xs text-muted">仍请定期下载备份；清除网站数据、卸载或系统清理可能删除记录，iOS也不保证永久保留。</p>
  {state!=='PERSISTED'&&state!=='UNSUPPORTED'&&<button type="button" onClick={()=>void check(true)} className="mt-2 min-h-11 rounded-card border border-line px-3">申请保留本机数据</button>}
  <p data-testid="storage-migration-state" className="mt-2 text-xs">{migration.state==='INDEXED_DB_MIRROR'?'本机副本已迁移并核对，原存储保留以便回退':migration.state==='COPYING'?'正在复制并核对本机数据':migration.state==='BLOCKED'?'本机存储迁移暂不可用，原记录保留':migration.state==='FALLBACK'?'副本未完成同步，继续使用原存储':'当前使用原本机存储'}。</p>
  <button type="button" disabled={migration.state==='COPYING'} onClick={()=>void(migration.state==='INDEXED_DB_MIRROR'?flushCoreStorage():migrateCoreStorage()).then(setMigration)} className="mt-2 min-h-11 rounded-card border border-line px-3">{migration.state==='INDEXED_DB_MIRROR'?'核对并同步本机副本':'迁移本机存储（保留原记录）'}</button>
  {migration.state==='INDEXED_DB_MIRROR'&&<button type="button" onClick={()=>void rollbackCoreStorage().then(setMigration)} className="ml-2 mt-2 min-h-11 rounded-card border border-line px-3">回退到原存储</button>}
 </section>
}
