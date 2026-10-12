import { useState } from 'react'
import { DEVICE_GUIDES } from '@/lib/ui/device-guides'
import { preflightDeviceFile, type DeviceFilePreflight } from '@/lib/ui/device-import-contract'
import { parseCsvPreview, type CsvPreview } from '@/lib/ui/device-csv-preview'

/** Guidance only. Deliberately does not create an import record or request device permissions. */
export function DeviceCenter() {
  const [selected, setSelected] = useState('coros')
  const [preflight, setPreflight] = useState<DeviceFilePreflight | null>(null)
  const [csvPreview, setCsvPreview] = useState<CsvPreview | null>(null)
  const [csvError, setCsvError] = useState('')
  const guide = DEVICE_GUIDES.find((item) => item.id === selected) ?? DEVICE_GUIDES[0]
  return <section className="mt-4 rounded-card border border-line bg-surface p-3 text-sm" aria-labelledby="device-center-heading">
    <h2 id="device-center-heading" className="font-bold">智能设备接入指南</h2>
    <p className="mt-1 text-muted">当前仅提供品牌操作指引。尚不支持自动同步、蓝牙连接或 FIT / TCX / GPX / 健康 ZIP 解析；选择品牌不会读取设备数据。</p>
    <label htmlFor="device-brand" className="mt-3 block font-bold">选择设备品牌</label>
    <select id="device-brand" value={selected} onChange={(event) => setSelected(event.target.value)} className="mt-2 min-h-12 w-full rounded-card border border-line bg-bg px-3 text-base">
      {DEVICE_GUIDES.map((item) => <option key={item.id} value={item.id}>{item.brand}</option>)}
    </select>
    <div className="mt-3 rounded-card border border-line p-3" aria-live="polite">
      <h3 className="font-bold">{guide.brand}</h3>
      <p className="mt-2"><span className="font-bold">操作入口：</span>{guide.route}</p>
      <p className="mt-1"><span className="font-bold">常见格式：</span>{guide.format}</p>
      <ol className="mt-3 list-decimal space-y-2 pl-5">{guide.steps.map((step) => <li key={step}>{step}</li>)}</ol>
      <p className="mt-3 text-muted">注意：{guide.caution}</p>
    </div>
    <div className="mt-4 rounded-card border border-line p-3">
      <h3 className="font-bold">本地文件格式预检查（不导入）</h3>
      <p className="mt-1 text-muted">只检查所选文件的名称和大小，不读取内容、不上传、不保存，也不生成训练记录。FIT、TCX、GPX、CSV、健康 ZIP 的实际解析尚未启用。</p>
      <label htmlFor="device-file-preflight" className="mt-3 block font-bold">选择本地文件</label>
      <input id="device-file-preflight" type="file" accept=".fit,.tcx,.gpx,.csv,.zip" className="mt-2 block w-full max-w-full text-sm" onChange={(event) => {
        const file = event.target.files?.[0]
        setPreflight(file ? preflightDeviceFile(file.name, file.size) : null)
        event.target.value = ''
      }} />
      {preflight && <div className="mt-3 rounded-card border border-line p-2" role="status" aria-live="polite">
        <p className="break-all font-bold">{preflight.name}</p>
        <p>类型：{preflight.kind} · 大小：{(preflight.sizeBytes / 1024).toFixed(1)} KB</p>
        <p className="mt-1 text-muted">{preflight.message}</p>
        <button type="button" className="mt-2 underline" onClick={() => setPreflight(null)}>清除预检查</button>
      </div>}
    </div>
    <div className="mt-4 rounded-card border border-line p-3">
      <h3 className="font-bold">CSV 批量本地预览（只读）</h3>
      <p className="mt-1 text-muted">一次查看最多 20 行；仅在当前页面读取，不上传、不保存、不生成训练或身体记录。不同品牌 CSV 字段尚未统一映射。</p>
      <input aria-label="选择 CSV 批量预览文件" type="file" accept=".csv,text/csv" className="mt-2 block w-full max-w-full text-sm" onChange={async (event) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        setCsvPreview(null); setCsvError('')
        if (!file) return
        if (!/\.csv$/i.test(file.name) || file.size > 2_000_000) { setCsvError('请选择不超过 2 MB 的 CSV 文件'); return }
        try { setCsvPreview(parseCsvPreview(await file.text())) }
        catch (error) { setCsvError(error instanceof Error ? error.message : 'CSV 读取失败') }
      }} />
      {csvError && <p role="alert" className="mt-2 text-warn">{csvError}</p>}
      {csvPreview && <div className="mt-3" role="status">
        <p>共 {csvPreview.totalRows} 行数据，预览 {csvPreview.rows.length} 行；{csvPreview.headers.length} 列。</p>
        {csvPreview.warnings.map((warning) => <p key={warning} className="text-warn">{warning}</p>)}
        <div className="mt-2 max-h-64 overflow-auto rounded-card border border-line"><table className="min-w-full text-left text-xs"><thead><tr>{csvPreview.headers.map((header, i) => <th key={i} className="border-b border-line p-2">{header || `第${i + 1}列`}</th>)}</tr></thead><tbody>{csvPreview.rows.map((row, i) => <tr key={i}>{csvPreview.headers.map((_, j) => <td key={j} className="border-b border-line p-2">{row[j] ?? '—'}</td>)}</tr>)}</tbody></table></div>
        <button type="button" className="mt-2 underline" onClick={() => setCsvPreview(null)}>清除预览</button>
      </div>}
    </div>
    <p className="mt-3 text-muted">下一阶段将先验收本地解析、来源标记、重复检测和确认预览，验收前不会显示虚假的「已连接」或「导入成功」。</p>
  </section>
}
