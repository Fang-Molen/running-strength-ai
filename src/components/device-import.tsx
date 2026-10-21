import {DecimalInput} from './decimal-input'
import { useRef, useState } from "react"
import { Upload } from "lucide-react"
import { METRIC_LABELS, METRIC_UNITS, mergeResults, healthPreviewKey, paceText, parseDeviceFile, parseSummaryText, type DeviceActivity, type DeviceHealthRow, type DeviceParseResult } from "@/lib/ui/device-parse"
import { healthSavedKey, activityDraftId, existingKeys, isDuplicate, saveDeviceRows } from "@/lib/ui/device-store"
import { SavedBadge } from "@/components/saved-badge"
import { CorosAccount } from "@/components/coros-account"

export { ocr } from "@/lib/vision/local-ocr";
import { ocr } from "@/lib/vision/local-ocr";
import { ImageIntake } from "./image-intake";
const fmtDur = (s: number | null) => s == null ? "—" : s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`

export function DeviceImport({ today, onSaved }: { today: string; onSaved: () => void }) {
  const panel=useRef<HTMLElement>(null)
  const importing = useRef(false);
  const [reading, setReading] = useState(false);
  const [status, setStatus] = useState("")
  const [result, setResult] = useState<DeviceParseResult | null>(null)
  const [pickH, setPickH] = useState<Record<string, boolean>>({})
  const [pickA, setPickA] = useState<Record<string, boolean>>({})
  const [dup, setDup] = useState<{ h: Set<string>; a: Set<string> }>({ h: new Set(), a: new Set() })
  const [stamp, setStamp] = useState(0)
  const [ocrText, setOcrText] = useState("")
  async function handle(files: FileList | null) {
    if (!files?.length || importing.current) return
    importing.current = true; setReading(true)
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
    importing.current = false; setReading(false)
    stage(mergeResults(parts))
  }
  function stage(merged: DeviceParseResult) {

    const have = existingKeys()
    const dh = new Set(merged.health.filter((h) => have.health.has(healthSavedKey(h))).map((h) => h.key))
    const da = new Set(merged.activities.filter((a) => (have.activities.has(activityDraftId(a)) || isDuplicate(a, have))).map((a) => a.key))
    setDup({ h: dh, a: da })
    setPickH(Object.fromEntries(merged.health.map((h) => [h.key, !dh.has(h.key)])))
    setPickA(Object.fromEntries(merged.activities.map((a) => [a.key, !da.has(a.key)])))
    setResult(merged); setStatus("")
  }
  function edit(key: string, patch: Partial<DeviceHealthRow>) {
    if (!result) return
    const old=result.health.find(h=>h.key===key);if(!old)return
    const updated={...old,...patch};updated.key=healthPreviewKey(updated)
    if(patch.day&&updated.observation)updated.observation={...updated.observation,key:`${updated.observation.key}:date:${patch.day}`.slice(0,160),measuredAt:null}
    setResult({...result,health:result.health.map(h=>h.key===key?updated:h)})
    setPickH(p=>({...p,[updated.key]:true}))
    setDup(d=>({...d,h:new Set([...d.h].filter(k=>k!==key))}))
  }

  function save() {
    if(panel.current&&![...panel.current.querySelectorAll("input")].every(e=>e.reportValidity())){setStatus("请先修正读数；空白不会当成0。");return;}
    if (!result) return
    const h = result.health.filter((x) => pickH[x.key] ?? true)
    const a = result.activities.filter((x) => pickA[x.key])
    const r = saveDeviceRows(h, a)
    setStatus(`已保存 ${r.saved} 条${r.skipped ? `，跳过已存在 ${r.skipped} 条` : ""}${r.errors.length ? `；${r.errors.length} 条未保存：${r.errors.slice(0, 3).join("；")}` : ""}`)
    if (r.saved) { setStamp(Date.now()); onSaved() }
    if (!r.errors.length) setResult(null)
  }
  const nPick = result ? result.health.filter((x) => pickH[x.key] ?? true).length + result.activities.filter((x) => pickA[x.key]).length : 0
  return <section ref={panel} className="home-card p-4 text-sm" aria-label="导入设备数据">
    <div className="flex items-center justify-between gap-2"><h2 className="text-base font-bold">导入手表数据</h2><SavedBadge stamp={stamp} /></div>
    <p className="mt-1 text-muted">佳明优先。选文件或截图，自动识别类型 → 核对 → 一次保存。文件在本机解析。图片可选择本地识字或联网识别，均需核对后保存。</p>
    <CorosAccount onResult={stage} />
    <label className="fk-drop mt-3">
      <Upload className="size-5" />
      <span className="font-bold">选择文件或截图</span>
      <small className="text-muted">FIT · GPX · TCX · CSV · 佳明数据导出 ZIP · Apple 健康 ZIP · 截图（可多选）</small>
      <input disabled={reading} type="file" multiple accept=".fit,.gpx,.tcx,.csv,.zip,.json,image/*" className="sr-only" onChange={(e) => { const f = e.target.files; void handle(f).finally(() => { e.target.value = "" }) }} />
    </label>
    <ImageIntake title="联网识别手表 / 健康截图" onText={(text) => { const r = parseSummaryText(text, today); setOcrText(text); stage({kind:"核对后的图片文字",brand:"待核对",activities:r.activity?[r.activity]:[],health:r.health,notes:["请逐项核对日期、单位和分段；缺少日期时页面暂用所选日期，不能当作原图日期。"]}); }} />
    {status ? <p className="mt-2" role="status">{status}</p> : null}
    {result ? <div className="mt-3 space-y-3">
      <p className="text-xs text-muted">识别为：{result.kind}{result.brand && result.brand !== "未知" ? ` · ${result.brand}` : ""}。{result.notes.join(" ")}</p>
      {result.health.length ? <div className="overflow-x-auto rounded-xl border border-line"><table className="fk-table"><thead><tr><th></th><th>日期</th><th>指标</th><th>数值</th><th>来源</th></tr></thead><tbody>
        {result.health.map((h) => <tr key={h.key} className={dup.h.has(h.key) ? "opacity-60" : ""}>
          <td><input type="checkbox" aria-label="保存这条" checked={pickH[h.key] ?? true} onChange={(e) => setPickH({ ...pickH, [h.key]: e.target.checked })} /></td>
          <td><input type="date" value={h.day} onChange={(e) => edit(h.key, { day: e.target.value })} className="fk-cell w-[8.5rem]" /></td>
          <td>{METRIC_LABELS[h.metric]}</td>
          <td><DecimalInput min={0} value={h.value} onCommit={value=>{if(value!==null)edit(h.key,{value})}} className="fk-cell w-16" /> <span className="text-muted">{METRIC_UNITS[h.metric]}</span></td>
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
        <p><b className="text-fg">账号同步：</b>本应用有佳明账号同步入口，请核对登录地区、同步结果与指标日期。本页文件和截图导入需逐项确认。其他品牌是否直连以实际入口和授权状态为准，选择品牌不等于连接成功。</p>
      </div>
    </details>
  </section>
}
