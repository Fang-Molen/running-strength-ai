import {validateOcrImage,mergeOcrText} from '@/lib/core/local-ocr-policy'
import {browserCapabilities,imageEntryMode} from '@/lib/core/browser-capabilities'
import {useEffect, useMemo, useState, type ChangeEvent} from 'react'
import {parseDeviceEvidence, validateDeviceConfirmation, makeDeviceRecord, validReading, type DeviceDraft, type DeviceMetric, type DeviceReading, type DeviceConfirmed} from '@/lib/core/device-image-evidence'
import {storeConfirmedDeviceEvidence, listConfirmedDeviceEvidence, readConfirmedDeviceEvidence} from '@/lib/core/device-evidence-idb'
import {exportDeviceEvidenceBackup, importDeviceEvidenceBackup, validateEvidenceBackup, type EvidenceBackup} from '@/lib/core/device-evidence-backup'

const LABELS:Record<DeviceMetric,string>={SLEEP_HOURS:'睡眠时长',HRV_MS:'HRV',RESTING_HR_BPM:'静息心率',AVERAGE_HR_BPM:'平均心率',WEIGHT_KG:'体重',BODY_FAT_PERCENT:'体脂率',SPO2_PERCENT:'血氧',RUN_SPLIT:'跑步分段',STRENGTH_SET:'力量实际组'}
const UNITS:Record<DeviceMetric,DeviceReading['unit']>={SLEEP_HOURS:'h',HRV_MS:'ms',RESTING_HR_BPM:'bpm',AVERAGE_HR_BPM:'bpm',WEIGHT_KG:'kg',BODY_FAT_PERCENT:'%',SPO2_PERCENT:'%',RUN_SPLIT:'s',STRENGTH_SET:'kg'}
const types=Object.keys(LABELS) as DeviceMetric[]
function saveAs(blob:Blob,filename:string){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000)}
async function hashBlob(blob:Blob):Promise<string>{const bytes=await blob.arrayBuffer();const hash=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(hash)].map(v=>v.toString(16).padStart(2,'0')).join('')}
type BrowserTextDetector={detect:(bitmap:ImageBitmap)=>Promise<Array<{rawValue?:string}>>}
const detectorAvailable=()=>typeof window!=='undefined' && typeof (window as Window & {TextDetector?:new()=>BrowserTextDetector}).TextDetector==='function'

/** Offline-first, image never leaves this browser. Imported evidence does not enter the canonical training/medical decision chain. */
export function DeviceEvidenceImport(){
  const [file,setFile]=useState<File|null>(null)
  const [capabilities,setCapabilities]=useState<ReturnType<typeof browserCapabilities>|null>(null)
  const [preview,setPreview]=useState<string|null>(null)
  const [text,setText]=useState('')
  const [ocrUsed,setOcrUsed]=useState(false)
  const [draft,setDraft]=useState<DeviceDraft|null>(null)
  const [deviceLabel,setDeviceLabel]=useState('')
  const [recordedAt,setRecordedAt]=useState('')
  const [ack,setAck]=useState(false)
  const [busy,setBusy]=useState(false)
  const [status,setStatus]=useState('')
  const [history,setHistory]=useState<DeviceConfirmed[]>([])
  const [backupPreview,setBackupPreview]=useState<EvidenceBackup|null>(null)
  const [backupAck,setBackupAck]=useState(false)
  const [manualMetric,setManualMetric]=useState<DeviceMetric>('RESTING_HR_BPM')
  useEffect(()=>{setCapabilities(browserCapabilities())},[])
  useEffect(()=>{listConfirmedDeviceEvidence().then(setHistory).catch(()=>setStatus('本机证据库不可用；不会写入旧训练数据。'))},[])
  useEffect(()=>{if(!file){setPreview(null);return}const url=URL.createObjectURL(file);setPreview(url);return()=>URL.revokeObjectURL(url)},[file])
  const errors=useMemo(()=>draft?validateDeviceConfirmation({draft,deviceLabel,recordedAt,acknowledged:ack}):['尚未生成草稿'],[draft,deviceLabel,recordedAt,ack])
  function pick(event:ChangeEvent<HTMLInputElement>){
    const chosen=event.target.files?.[0]??null
    event.target.value=''
    if(!chosen)return
    if(validateOcrImage(chosen.type,chosen.size)){setFile(null);setStatus('仅支持不超过6MB的JPG、PNG或WebP原图');return}
    setFile(chosen);setText('');setOcrUsed(false);setDraft(null);setAck(false);setStatus('图片只在当前浏览器处理；若不支持本地OCR，可手动输入图中文字。')
  }
  async function tryOcr(){
    if(!file)return setStatus('请先选择图片')
    const Detector=(window as Window & {TextDetector?:new()=>BrowserTextDetector}).TextDetector
    if(!Detector)return setStatus('当前浏览器不提供本地文字识别接口。可直接粘贴/输入截图文字，仍无需联网或大模型。')
    setBusy(true)
    try{
      const bitmap=await createImageBitmap(file)
      try{
        if(bitmap.width*bitmap.height>16_000_000)throw new Error('图片像素过大，请裁剪后重试')
        const results=await new Detector().detect(bitmap)
        const detected=results.map(r=>r.rawValue??'').filter(Boolean).join('\n')
        if(!detected.trim())setStatus('本地OCR没有识别出文字，请手动输入；没有生成任何数据。')
        else {setText(current=>mergeOcrText(current,detected));setOcrUsed(true);setDraft(null);setAck(false);setStatus('已在本机识别文字（置信度不可用），请逐项核对原图和文字，再生成草稿。')}
      }finally{bitmap.close()}
    }catch(e){setStatus(e instanceof Error?`本地OCR失败：${e.message}`:'本地OCR失败，请手动输入')}
    finally{setBusy(false)}
  }
  function parse(){setDraft(parseDeviceEvidence(text));setAck(false);setStatus('只生成草稿，不会自动修改身体、训练、疲劳或计划数据。')}
  function edit(index:number,update:Partial<DeviceReading>){setDraft(current=>current?{...current,readings:current.readings.map((r,i)=>i===index?{...r,...update,provenance:'USER_EDITED'}:r)}:current);setAck(false)}
  function editDetail(index:number,key:keyof NonNullable<DeviceReading['details']>,value:string){
    const current=draft?.readings[index];if(!current)return
    const parsed=key==='exercise'?value:(value.trim()===''?undefined:Number(value))
    edit(index,{details:{...current.details,[key]:parsed}})
  }
  function addManual(){const metric=manualMetric;const item:DeviceReading={id:`manual-${crypto.randomUUID()}`,metric,value:0,unit:UNITS[metric],rawLine:'人工录入',sourceLine:0,provenance:'USER_EDITED',...(metric==='RUN_SPLIT'?{details:{distanceMeters:undefined}}:metric==='STRENGTH_SET'?{details:{exercise:'',repetitions:undefined}}:{})};setDraft(d=>({readings:[...(d?.readings??[]),item],warnings:d?.warnings??[],rawText:d?.rawText??text}));setAck(false)}
  async function confirm(){
    if(!draft||busy)return
    const problems=validateDeviceConfirmation({draft,deviceLabel,recordedAt,acknowledged:ack})
    if(problems.length)return setStatus(problems.join('；'))
    setBusy(true)
    try{
      const imageSha256=file?await hashBlob(file):null
      const id=await hashBlob(new Blob([JSON.stringify({deviceLabel:deviceLabel.trim(),recordedAt,imageSha256,readings:draft.readings})],{type:'application/json'}))
      const record=makeDeviceRecord({draft,deviceLabel,recordedAt,acknowledged:ack,imageName:file?.name??null,imageSha256,textOrigin:ocrUsed?'BROWSER_OCR_REVIEWED':'USER_TRANSCRIBED',confirmedAt:new Date().toISOString(),id})
      const result=await storeConfirmedDeviceEvidence(record,file)
      setHistory(await listConfirmedDeviceEvidence())
      setStatus(result==='ALREADY_EXISTS'?'这份证据已经保存过，未重复写入。':'已确认并保存到本机独立设备证据库（含原图）；尚未绑定正式训练或自动生成建议。')
      if(result==='SAVED'){setDraft(null);setFile(null);setText('');setOcrUsed(false);setAck(false)}
    }catch(e){setStatus(e instanceof Error?`保存失败：${e.message}`:'保存失败，未写入记录')}
    finally{setBusy(false)}
  }
  async function exportOne(id:string,kind:'json'|'image'){
    try{const row=await readConfirmedDeviceEvidence(id);if(!row)return setStatus('记录不存在');if(kind==='image'){if(!row.originalImage)return setStatus('此记录没有原图');saveAs(row.originalImage,row.record.imageName??'device-original.png')}else saveAs(new Blob([JSON.stringify(row.record,null,2)],{type:'application/json'}),`device-evidence-${id.slice(0,12)}.json`)}catch{setStatus('导出失败，请检查浏览器存储权限')}
  }
  async function exportAllEvidence(){
    setBusy(true)
    try{const backup=await exportDeviceEvidenceBackup();saveAs(new Blob([JSON.stringify(backup)],{type:'application/json'}),`fangkun-device-evidence-${new Date().toISOString().slice(0,10)}.json`);setStatus(`已导出 ${backup.entries.length} 份设备证据及原图。文件可能包含敏感健康信息，请妥善保管。`)}
    catch(e){setStatus(e instanceof Error?`备份失败：${e.message}`:'备份失败')}
    finally{setBusy(false)}
  }
  async function chooseBackup(event:ChangeEvent<HTMLInputElement>){
    const chosen=event.target.files?.[0];event.target.value='';setBackupPreview(null);setBackupAck(false)
    if(!chosen)return
    if(chosen.size>50*1024*1024)return setStatus('备份文件超过50MB，请分批处理；没有导入任何记录。')
    setBusy(true)
    try{const data:unknown=JSON.parse(await chosen.text());validateEvidenceBackup(data);setBackupPreview(data);setStatus(`预览成功：${data.entries.length} 份设备证据。尚未写入任何数据。`)}
    catch(e){setStatus(e instanceof Error?`备份验证失败：${e.message}`:'备份验证失败')}
    finally{setBusy(false)}
  }
  async function restoreEvidence(){
    if(!backupPreview||!backupAck||busy)return
    setBusy(true)
    try{const result=await importDeviceEvidenceBackup(backupPreview,true);setHistory(await listConfirmedDeviceEvidence());setBackupPreview(null);setBackupAck(false);setStatus(`恢复完成：新增 ${result.saved} 份，跳过重复 ${result.duplicates} 份。未修改正式训练和身体数据。`)}
    catch(e){setStatus(e instanceof Error?`恢复中断：${e.message}。部分记录可能已保存，可重新导入以跳过重复。`:'恢复中断')}
    finally{setBusy(false)}
  }
  return <section className="rounded-card border border-line bg-surface p-3 text-sm" aria-label="本地设备识图和证据校对">
    <h3 className="font-bold">设备截图与单次训练细节 · 本地识别</h3>
    <p className="mt-1 text-xs text-muted">跨浏览器入口：Safari / Chrome / Edge / Firefox 等均可使用图片选择与人工校对（实际支持由浏览器功能决定）。{capabilities?`当前能力：${imageEntryMode(capabilities)==='LOCAL_OCR'?'可尝试浏览器本地OCR':imageEntryMode(capabilities)==='MANUAL_IMAGE'?'可选图片、手动校对':'仅手动文字录入'}；${capabilities.indexedDb?'本机证据存储可检测':'本机证据存储不可检测'}。`:''}不同浏览器的本地数据不会自动同步。</p>
    <p className="mt-1 text-xs text-muted">支持睡眠、HRV、静息/平均心率、体重、体脂、血氧、跑步分段和力量实际组。仅支持浏览器提供的本机OCR或人工转录；手写识别不保证成功。OCR置信度不可用，不等于视觉理解或医学诊断；暂不读取苹果健康或其他设备账号。</p>
    <label className="mt-3 flex min-h-12 cursor-pointer items-center justify-center rounded-card border border-dashed border-line px-3 text-center font-bold">拍照 / 从相册或文件选择图片（本地，不上传）<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={pick}/></label>
    {preview?<img src={preview} alt="待核对的设备原始截图" className="mt-2 max-h-56 w-full rounded-card object-contain"/>:null}
    {file?<p className="mt-1 break-all text-xs text-muted">原图：{file.name}，{(file.size/1024/1024).toFixed(2)}MB</p>:null}
    <button type="button" disabled={!file||busy} onClick={()=>void tryOcr()} className="mt-2 min-h-11 w-full rounded-card border border-line px-3 font-bold disabled:opacity-50">尝试本机OCR {detectorAvailable()?'（接口可用）':'（本浏览器可能不支持）'}</button>
    <label className="mt-3 block text-xs font-bold">识别文字 / 手动转录（可编辑）<textarea value={text} onChange={e=>{setText(e.target.value);setDraft(null);setAck(false)}} rows={4} maxLength={12000} placeholder={'睡眠 7小时25分\nHRV 62ms\n静息心率 49bpm\n第1段 400m 68.2s 心率168 恢复120s\n深蹲 第2组 60kg x 8次'} className="mt-1 w-full rounded-card border border-line bg-bg p-2 text-base"/></label>
    <button type="button" onClick={parse} disabled={busy||!text.trim()} className="mt-2 min-h-11 w-full rounded-card bg-accent px-3 font-bold text-accent-fg disabled:opacity-50">解析为可校对证据（免费、离线）</button>
    {draft?<div className="mt-3 space-y-3">
      <p className="font-bold">待核对 {draft.readings.length} 条 · 不自动保存</p>
      {draft.warnings.map((w,i)=><p key={i} className="text-xs text-warn">{w}</p>)}
      {draft.readings.map((r,i)=><div key={r.id} className="rounded-card bg-bg p-2">
        <div className="flex items-center justify-between gap-2"><b>{LABELS[r.metric]}</b><button type="button" className="min-h-10 px-2 text-risk" onClick={()=>{setDraft(d=>d?{...d,readings:d.readings.filter((_,n)=>n!==i)}:d);setAck(false)}}>删除</button></div>
        <p className="text-xs text-muted">{r.sourceLine?`原文第${r.sourceLine}行`:'人工补录'} · {r.provenance==='LOCAL_PATTERN'?'规则匹配，非可信度评分':'人工修改'}：{r.rawLine}</p>
        <label className="mt-1 block text-xs">读数（{r.unit}）<input type="number" step="any" value={Number.isFinite(r.value)?r.value:''} onChange={e=>edit(i,{value:e.target.value===''?Number.NaN:Number(e.target.value)})} className="mt-1 h-11 w-full rounded-card border border-line px-2 text-base"/></label>
        {r.metric==='RUN_SPLIT'?<div className="mt-2 grid grid-cols-2 gap-2">{([['distanceMeters','距离（米）'],['recoverySeconds','恢复（秒）'],['heartRateBpm','分段心率（bpm）'],['repeat','分段编号']] as const).map(([key,label])=><label key={key} className="text-xs">{label}<input type="number" step="any" value={r.details?.[key]??''} onChange={e=>editDetail(i,key,e.target.value)} className="mt-1 h-11 w-full rounded-card border border-line px-2 text-base"/></label>)}</div>:null}
        {r.metric==='STRENGTH_SET'?<div className="mt-2 grid grid-cols-2 gap-2">{([['exercise','动作'],['setOrdinal','组号'],['repetitions','次数']] as const).map(([key,label])=><label key={key} className="text-xs">{label}<input type={key==='exercise'?'text':'number'} value={r.details?.[key]??''} onChange={e=>editDetail(i,key,e.target.value)} className="mt-1 h-11 w-full rounded-card border border-line px-2 text-base"/></label>)}</div>:null}
        {!validReading(r)?<p className="mt-1 text-xs text-risk">读数或必填分段字段无效，不能保存</p>:null}
      </div>)}
      <div className="flex gap-2"><select aria-label="手动添加指标" value={manualMetric} onChange={e=>setManualMetric(e.target.value as DeviceMetric)} className="min-w-0 flex-1 rounded-card border border-line px-2">{types.map(t=><option key={t} value={t}>{LABELS[t]}</option>)}</select><button type="button" className="min-h-11 rounded-card border border-line px-3" onClick={addManual}>补一条</button></div>
      <label className="block text-xs font-bold">设备 / 来源（必填）<input value={deviceLabel} maxLength={80} onChange={e=>{setDeviceLabel(e.target.value);setAck(false)}} placeholder="例如：运动手表App截图、智能体脂秤" className="mt-1 h-11 w-full rounded-card border border-line bg-bg px-2 text-base"/></label>
      <label className="block text-xs font-bold">读数采集时间（必须带时区，不猜截图时间）<input value={recordedAt} onChange={e=>{setRecordedAt(e.target.value);setAck(false)}} placeholder="2026-10-10T06:00:00+08:00" className="mt-1 h-11 w-full rounded-card border border-line bg-bg px-2 text-base"/></label>
      <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)} className="mt-1"/>我已对照原图核对单位、采集时间、重复值和全部分段；允许保存在本机独立证据库（不自动参与训练决策）。</label>
      {errors.length?<p className="text-xs text-risk">待处理：{errors.join('；')}</p>:null}
      <button type="button" disabled={busy||errors.length>0} onClick={()=>void confirm()} className="min-h-12 w-full rounded-card bg-accent font-bold text-accent-fg disabled:opacity-50">确认并保存原图与证据</button>
    </div>:null}
    {status?<p role="status" className="mt-2 rounded-card bg-surface-2 p-2 text-xs">{status}</p>:null}
    <details className="mt-3 rounded-card border border-line p-3"><summary className="cursor-pointer font-bold">设备证据完整备份 / 恢复（含原图）</summary>
      <p className="mt-2 text-xs text-muted">备份仅包含独立设备证据库，不包含旧训练历史。文件含敏感信息且未加密，请保存到可信位置。恢复前先验证与预览，已有编号不会覆盖。</p>
      <button type="button" disabled={busy} onClick={()=>void exportAllEvidence()} className="mt-2 min-h-11 w-full rounded-card border border-line px-3 disabled:opacity-50">导出全部证据与原图</button>
      <label className="mt-2 flex min-h-11 cursor-pointer items-center justify-center rounded-card border border-line px-3">选择备份文件并预览<input type="file" accept="application/json,.json" className="sr-only" onChange={e=>void chooseBackup(e)}/></label>
      {backupPreview?<div className="mt-2 space-y-2"><p className="text-xs">备份时间：{backupPreview.exportedAt}；共 {backupPreview.entries.length} 份，包含原图 {backupPreview.entries.filter(e=>e.imageBase64!==null).length} 份。仅恢复独立证据库。</p>
        <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={backupAck} onChange={e=>setBackupAck(e.target.checked)}/>我已核对备份来源、内容和隐私风险，明确同意恢复；理解中途失败可能部分成功。</label>
        <button type="button" disabled={!backupAck||busy} onClick={()=>void restoreEvidence()} className="min-h-11 w-full rounded-card bg-accent font-bold text-accent-fg disabled:opacity-50">确认恢复设备证据</button></div>:null}
    </details>
    {history.length?<details className="mt-3"><summary className="cursor-pointer font-bold">已确认设备证据 {history.length} 份 · 可导出</summary><div className="mt-2 space-y-2">{history.slice(0,20).map(r=><div key={r.id} className="rounded-card bg-bg p-2 text-xs"><b>{r.deviceLabel}</b><p>{r.recordedAt} · {r.readings.length} 条</p><div className="mt-1 flex gap-2"><button type="button" onClick={()=>void exportOne(r.id,'json')} className="min-h-10 rounded-card border border-line px-2">导出JSON</button>{r.imageName?<button type="button" onClick={()=>void exportOne(r.id,'image')} className="min-h-10 rounded-card border border-line px-2">导出原图</button>:null}</div></div>)}</div></details>:null}
    <p className="mt-2 text-xs text-muted">隐私：不联网、不调用付费模型、不自动生成医学结论。已确认数据与原图保存在此浏览器的IndexedDB，旧版“个人与数据”备份不包含该库，请使用上方完整备份；清理浏览器数据可能丢失。</p>
  </section>
}
