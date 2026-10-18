import { useState } from 'react'
import { importCorrectionTargets, confirmImportLogCorrection, type ImportCorrectionTarget } from '@/lib/core/import-log-correction'
import { listCorrections } from '@/lib/core/training-correction'
import type { ConfirmedTrainingImport } from '@/lib/core/training-import'

export function ImportLogCorrectionPanel({record, onSaved}: {record: ConfirmedTrainingImport; onSaved: () => void}) {
  const [editing, setEditing] = useState<ImportCorrectionTarget | null>(null)
  const [value, setValue] = useState(''), [reason, setReason] = useState(''), [confirmed, setConfirmed] = useState(false), [notice, setNotice] = useState('')
  const targets = importCorrectionTargets(record)
  const history = listCorrections(record.confirmedImportId)
  return <section data-testid="import-log-corrections" className="space-y-2 rounded-card border border-line p-3">
    <h3 className="font-bold">有效记录与更正</h3>
    <p className="text-xs text-muted">更正后复盘使用新值；原始记录和修改原因保留。</p>
    {targets.map(target => <div key={target.id} className="flex items-center justify-between gap-2">
      <p>{target.label}：<b>{target.value} {target.unit}</b>{target.sourceId.startsWith('correction:') ? <span className="text-xs text-muted">（原值 {target.originalValue}）</span> : null}</p>
      <button type="button" aria-label={`更正${target.label}`} className="min-h-11 shrink-0 px-2 underline" onClick={() => {setEditing(target); setValue(String(target.value)); setReason(''); setConfirmed(false); setNotice('')}}>更正</button>
    </div>)}
    {!targets.length ? <p className="text-xs text-muted">当前没有可唯一关联的有效分段或工作组，暂不能逐项更正；未猜填缺失值。</p> : null}
    {editing ? <form aria-label="更正已确认训练" className="space-y-2 border-t border-line pt-2" onSubmit={event => {
      event.preventDefault()
      const result = confirmImportLogCorrection({occurrenceId: record.confirmedImportId, targetId: editing.id, expectedSourceId: editing.sourceId, value, reason, confirmed})
      setNotice(result.ok ? '更正已保存；原值及判断历史保留，重新复盘将使用新值。' : result.reason)
      if (result.ok) {setEditing(null); onSaved()}
    }}>
      <p className="font-bold">更正{editing.label}（当前 {editing.value} {editing.unit}）</p>
      <label className="block">正确数值（{editing.unit}）<input aria-label="导入训练正确数值" type="text" inputMode={editing.field === 'reps' ? 'numeric' : 'decimal'} required value={value} onChange={event => {setValue(event.target.value); setConfirmed(false)}} className="mt-1 min-h-11 w-full rounded-card border border-line bg-bg px-2"/></label>
      <label className="block">修改原因<input aria-label="导入训练修改原因" required maxLength={300} value={reason} onChange={event => {setReason(event.target.value); setConfirmed(false)}} className="mt-1 min-h-11 w-full rounded-card border border-line bg-bg px-2"/></label>
      <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/>我已核对训练、分段及新数值</label>
      <div className="flex flex-wrap gap-2"><button type="submit" disabled={!confirmed || !value.trim() || !reason.trim()} className="min-h-11 rounded-card border border-line px-3 disabled:opacity-40">确认保存训练更正</button><button type="button" className="min-h-11 px-3" onClick={() => setEditing(null)}>取消更正</button></div>
    </form> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {history.length ? <details><summary className="min-h-11 cursor-pointer py-2">更正历史（{history.length}）</summary>{history.map(row => <p key={row.correctionId} className="break-words text-xs">{row.recordedAt} · {row.originalValue} → {row.newValue} · {row.reason}</p>)}</details> : null}
  </section>
}
