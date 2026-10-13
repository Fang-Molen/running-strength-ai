import { useState } from "react"
import { Upload } from "lucide-react"
import { METRIC_LABELS, METRIC_UNITS, mergeResults, paceText, parseDeviceFile, parseSummaryText, type DeviceActivity, type DeviceHealthRow, type DeviceParseResult } from "@/lib/ui/device-parse"
import { activityDraftId, existingKeys, saveDeviceRows } from "@/lib/ui/device-store"
import { SavedBadge } from "@/components/saved-badge"

declare global { interface Window { Tesseract?: { createWorker: (lang: string, oem: number, opts: Record<string, unknown>) => Promise<{ recognize: (img: Blob) => Promise<{ data: { text: string } }> }> } } }
let ocrWorker: Awaited<ReturnType<NonNullable<Window["Tesseract"]>["createWorker"]>> | null = null
export async function ocr(file: Blob, onStatus: (s: string) => void): Promise<string> {
  if (!window.Tesseract) await new Promise<void>((ok, bad) => { const s = document.createElement("script"); s.src = "/vendor/tesseract/tesseract.min.js"; s.onload = () => ok(); s.onerror = () => bad(new Error("识别组件加载失败")); document.head.appendChild(s) })
  if (!ocrWorker) { onStatus("首次识别：加载本机识别组件（约 6MB，之后可离线）…"); ocrWorker = await window.Tesseract!.createWorker("chi_sim", 1, { workerPath: "/vendor/tesseract/worker.min.js", corePath: "/vendor/tesseract/", langPath: "/vendor/tesseract/", gzip: true, cacheMethod: "write" }) }
  onStatus("正在识别截图…")
  return (await ocrWorker.recognize(file)).data.text
}
const fmtDur = (s: number | null) => s == null ? "—" : s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`

export function DeviceImport({ today, onSaved }: { today: string; onSaved: () => void }) {
  const [status, setStatus] = useState("")
  const [result, setResult] = useState<DeviceParseResult | null>(null)
  const [pickH, setPickH] = useState<Record<string, boolean>>({})
  const [pickA, setPickA] = useState<Record<string, boolean>>({})
  const [dup, setDup] = useState<{ h: Set<string>; a: Set<string> }>({ h: new Set(), a: new Set() })
  const [stamp, setStamp] = useState(0)
  const [ocrText, setOcrText] = useState("")
  async function handle(files: FileList | null) {
    if (!files?.length) return
    setResult(null); setOcrText("")
    const parts: DeviceParseResult[] = []
    try {
      for (const f of Array.from(files)) {
        if (f.size > 400 * 1024 * 1024) { parts.push({ kind: "过大", brand: "", activities: [], health: [], notes: [`${f.name} 超过 400MB，请先解压后只选需要的文件。`] }); continue }
        if (f.type.startsWith("image/")) {
          const text = await ocr(f, setStatus); setOcrText(text)
          const r = parseSummaryText(text, today)
          parts.push({ kind: "截图", brand: /garmin|佳明|身体电量|训练准备度/i.test(text) ? "Garmin Connect" : "未知", activities: r.activity ? [r.activity] : [], health: r.health, notes: r.health.length || r.activity ? ["截图识别可能认错数字，请逐项核对。日期默认今天，可在表里改。"] : ["截图里没认出指标。请截“我的一天”/睡眠/HRV/活动汇总页，或直接导出文件。"] })
        } else {
          setStatus(`正在读取 ${f.name}…`)
          parts.push(await parseDeviceFile(f.name, new Uint8Array(await f.arrayBuffer()), today))
        }
      }
    } catch (e) { parts.push({ kind: "错误", brand: "", activities: [], health: [], notes: [e instanceof Error ? e.message : "读取失败"] }) }
    const merged = mergeResults(parts)
    merged.kind = parts.map((p) => p.kind).join(" + ")
    const have = existingKeys()
    const dh = new Set(merged.health.filter((h) => have.health.has(h.key)).map((h) => h.key))
    const da = new Set(merged.activities.filter((a) => have.activities.has(activityDraftId(a))).map((a) => a.key))
    setDup({ h: dh, a: da })
    setPickH(Object.fromEntries(merged.health.map((h) => [h.key, !dh.has(h.key)])))
    setPickA(Object.fromEntries(merged.activities.map((a) => [a.key, !da.has(a.key)])))
    setResult(merged); setStatus("")
  }
  function edit(key: string, patch: Partial<DeviceHealthRow>) {
    if (!result) return
    setResult({ ...result, health: result.health.map((h) => h.key === key ? { ...h, ...patch, key: `${patch.metric ?? h.metric}:${patch.day ?? h.day}` } : h) })
    if (patch.day) setPickH((p) => ({ ...p, [`${result.health.find((h) => h.key === key)!.metric}:${patch.day}`]: true }))
  }
  function save() {
    if (!result) return
    const h = result.health.filter((x) => pickH[x.key] ?? true)
    const a = result.activities.filter((x) => pickA[x.key])
    const r = saveDeviceRows(h, a)
    setStatus(`已保存 ${r.saved} 条${r.skipped ? `，跳过已存在 ${r.skipped} 条` : ""}${r.errors.length ? `；${r.errors.length} 条未保存：${r.errors.slice(0, 3).join("；")}` : ""}`)
    setStamp(Date.now()); setResult(null); onSaved()
  }
  const nPick = result ? result.health.filter((x) => pickH[x.key] ?? true).length + result.activities.filter((x) => pickA[x.key]).length : 0
  return <section className="home-card p-4 text-sm" aria-label="导入设备数据">
    <div className="flex items-center justify-between gap-2"><h2 className="text-base font-bold">导入手表数据</h2><SavedBadge stamp={stamp} /></div>
    <p className="mt-1 text-muted">佳明优先。选文件或截图，自动识别类型 → 核对 → 一次保存。只在本机解析，不上传。</p>
    <label className="fk-drop mt-3">
      <Upload className="size-5" />
      <span className="font-bold">选择文件或截图</span>
      <small className="text-muted">FIT · GPX · TCX · CSV · 佳明数据导出 ZIP · Apple 健康 ZIP · 截图（可多选）</small>
      <input type="file" multiple accept=".fit,.gpx,.tcx,.csv,.zip,.json,image/*" className="sr-only" onChange={(e) => { const f = e.target.files; void handle(f).finally(() => { e.target.value = "" }) }} />
    </label>
    {status ? <p className="mt-2" role="status">{status}</p> : null}
    {result ? <div className="mt-3 space-y-3">
      <p className="text-xs text-muted">识别为：{result.kind}{result.brand && result.brand !== "未知" ? ` · ${result.brand}` : ""}。{result.notes.join(" ")}</p>
      {result.health.length ? <div className="overflow-x-auto rounded-xl border border-line"><table className="fk-table"><thead><tr><th></th><th>日期</th><th>指标</th><th>数值</th><th>来源</th></tr></thead><tbody>
        {result.health.map((h) => <tr key={h.key} className={dup.h.has(h.key) ? "opacity-60" : ""}>
          <td><input type="checkbox" aria-label="保存这条" checked={pickH[h.key] ?? true} onChange={(e) => setPickH({ ...pickH, [h.key]: e.target.checked })} /></td>
          <td><input type="date" value={h.day} onChange={(e) => edit(h.key, { day: e.target.value })} className="fk-cell w-[8.5rem]" /></td>
          <td>{METRIC_LABELS[h.metric]}</td>
          <td><input inputMode="decimal" value={h.value} onChange={(e) => edit(h.key, { value: Number(e.target.value) || 0 })} className="fk-cell w-16" /> <span className="text-muted">{METRIC_UNITS[h.metric]}</span></td>
          <td className="text-muted">{dup.h.has(h.key) ? "已有，默认跳过" : h.source}</td></tr>)}
      </tbody></table></div> : null}
      {result.activities.length ? <div className="overflow-x-auto rounded-xl border border-line"><table className="fk-table"><thead><tr><th></th><th>时间</th><th>类型</th><th>距离</th><th>用时</th><th>配速</th><th>心率</th></tr></thead><tbody>
        {result.activities.slice(0, 200).map((a: DeviceActivity) => <tr key={a.key} className={dup.a.has(a.key) ? "opacity-60" : ""}>
          <td><input type="checkbox" aria-label="保存这次训练" checked={pickA[a.key] ?? false} onChange={(e) => setPickA({ ...pickA, [a.key]: e.target.checked })} /></td>
          <td>{a.startIso ? new Date(a.startIso).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
          <td>{a.sportLabel}{a.sets.length ? ` · ${a.sets.length} 组` : ""}{dup.a.has(a.key) ? " · 已导入" : ""}</td>
          <td>{a.distanceM ? `${(a.distanceM / 1000).toFixed(2)} km` : "—"}</td><td>{fmtDur(a.durationSec)}</td><td>{paceText(a) ?? "—"}</td>
          <td>{a.avgHr ?? "—"}{a.maxHr ? `/${a.maxHr}` : ""}</td></tr>)}
      </tbody></table></div> : null}
      {result.health.length || result.activities.length ? <button type="button" disabled={!nPick} onClick={save} className="fk-primary w-full">保存选中的 {nPick} 条</button> : null}
      {ocrText ? <details className="text-xs"><summary className="min-h-10 cursor-pointer text-muted">查看识别出的原文</summary><pre className="whitespace-pre-wrap text-muted">{ocrText}</pre></details> : null}
    </div> : null}
    <details className="mt-3 text-xs">
      <summary className="min-h-10 cursor-pointer font-bold">佳明怎么导出？自动同步行不行？</summary>
      <div className="mt-1 space-y-1.5 text-muted">
        <p><b className="text-fg">单次训练：</b>佳明 Connect App → 活动 → 右上角 ⋯ → 导出原始文件（FIT），或网页版 connect.garmin.cn 活动页 ⚙ → 导出原始数据 / GPX / TCX。</p>
        <p><b className="text-fg">批量 + 睡眠/HRV/静息心率：</b>账户设置 → 数据管理 → 导出你的数据，邮件收到 ZIP 后整包选进来即可，会自动读里面的 FIT 和健康 JSON（只取最近 120 天）。中国区账号入口在 garmin.cn 的隐私/数据管理里，格式相同。</p>
        <p><b className="text-fg">身体电量/训练准备度/HRV：</b>文件里不一定有，最快是截“我的一天”页面上传识别。</p>
        <p><b className="text-fg">实时自动同步：</b>需要佳明官方 Health / Activity API，必须以企业身份申请开发者计划并获批，且国际区和中国区（garmin.cn）是两套账号与接口；目前没有接入，也不会用账号密码去抓网页。华为（Health Kit）、小米、COROS、Apple 健康（只能在 iOS App 内用 HealthKit）同样需要官方授权或原生 App，暂未接入。</p>
      </div>
    </details>
  </section>
}
