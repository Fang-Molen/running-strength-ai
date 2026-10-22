import { saveReviewedFacts } from '@/lib/health/unified-fact-store'
import { editReviewedHealthRow } from '@/lib/health/reviewed-correction'
import {DecimalInput} from './decimal-input'
import { useEffect, useRef, useState } from "react"
import { Upload } from "lucide-react"
import { METRIC_LABELS, METRIC_UNITS, mergeResults, paceText, parseDeviceFile, parseSummaryText, type DeviceActivity, type DeviceHealthRow, type DeviceParseResult } from "@/lib/ui/device-parse"
import { healthSavedKey, activityDraftId, existingKeys, isDuplicate, saveDeviceRows } from "@/lib/ui/device-store"
import { SavedBadge } from "@/components/saved-badge"
import { fmtDurationPrecise as fmtDur } from "@/lib/ui/activity-format"
import { openDeviceSync } from "@/lib/ui/device-sync-navigation"
import { ATHLETE_SCOPE_CHANGED, currentAthleteId } from '@/lib/core/events'
import { reviewFactKey, reviewStatusFacts, selectReviewedDeviceRows } from '@/lib/ui/device-import-review'
import type { FactQuality } from '@/lib/health/unified-facts'

export { ocr } from "@/lib/vision/local-ocr";
import { ocr } from "@/lib/vision/local-ocr";
import { ImageIntake } from "./image-intake";

type DeviceImportProps = { today: string; onSaved: () => void; hideConnectionLink?: boolean }
const STATUS_LABELS: Record<FactQuality, string> = { VALID: '有效', UNKNOWN: '未知', UNAVAILABLE: '无数据', NOT_WORN: '未佩戴', CONFLICT: '数据冲突', RETRACTED: '撤回记录' }

export function DeviceImport(props: DeviceImportProps) {
  const [scope, setScope] = useState(() => ({ owner: currentAthleteId(), version: 0 }))
  const liveScope = useRef(scope)
  useEffect(() => {
    const changed = () => {
      const next = { owner: currentAthleteId(), version: liveScope.current.version + 1 }
      // Invalidate immediately, including an A → B → A change before React renders.
      liveScope.current = next
      setScope(next)
    }
    window.addEventListener(ATHLETE_SCOPE_CHANGED, changed)
    if (currentAthleteId() !== liveScope.current.owner) changed()
    return () => window.removeEventListener(ATHLETE_SCOPE_CHANGED, changed)
  }, [])
  return <ScopedDeviceImport key={scope.version} {...props} scopeIsCurrent={() => liveScope.current === scope && currentAthleteId() === scope.owner} />
}

function ScopedDeviceImport({ today, onSaved, hideConnectionLink = false, scopeIsCurrent }: DeviceImportProps & { scopeIsCurrent: () => boolean }) {
  const panel=useRef<HTMLElement>(null)
  const importing = useRef(false);
  const alive = useRef(true)
  const readGeneration = useRef(0)
  useEffect(() => { alive.current = true; return () => { alive.current = false; readGeneration.current++ } }, [])
  const isCurrent = (generation = readGeneration.current) => alive.current && scopeIsCurrent() && generation === readGeneration.current
  const [reading, setReading] = useState(false);
  const [status, setStatus] = useState("")
  const [result, setResult] = useState<DeviceParseResult | null>(null)
  const [pickH, setPickH] = useState<Record<string, boolean>>({})
  const [pickA, setPickA] = useState<Record<string, boolean>>({})
  const [pickF, setPickF] = useState<Record<string, boolean>>({})
  const [visibleStates, setVisibleStates] = useState(20)
  const [visibleActivities, setVisibleActivities] = useState(200)
  const [inputRevision, setInputRevision] = useState<Record<string, number>>({})
  const [dup, setDup] = useState<{ h: Set<string>; a: Set<string> }>({ h: new Set(), a: new Set() })
  const [stamp, setStamp] = useState(0)
  const [ocrText, setOcrText] = useState("")
  async function handle(files: FileList | null) {
    if (!files?.length || importing.current || !isCurrent()) return
    const generation = ++readGeneration.current
    importing.current = true; setReading(true)
    setResult(null); setOcrText("")
    const parts: DeviceParseResult[] = []
    try {
      for (const f of Array.from(files)) {
        if (!isCurrent(generation)) return
        if (f.size > 400 * 1024 * 1024) { parts.push({ kind: "过大", brand: "", activities: [], health: [], notes: [`${f.name} 超过 400MB，请先解压后只选需要的文件。`] }); continue }
        if (f.type.startsWith("image/")) {
          const text = await ocr(f, message => { if (isCurrent(generation)) setStatus(message) })
          if (!isCurrent(generation)) return
          setOcrText(text)
          const r = parseSummaryText(text, today)
          parts.push({ kind: "截图", brand: /garmin|佳明|身体电量|训练准备度/i.test(text) ? "Garmin Connect" : "未知", activities: r.activity ? [r.activity] : [], health: r.health, notes: r.health.length || r.activity ? ["截图识别可能认错数字，请逐项核对。日期默认今天，可在表里改。"] : ["截图里没认出指标。请截“我的一天”/睡眠/HRV/活动汇总页，或直接导出文件。"] })
        } else {
          setStatus(`正在读取 ${f.name}…`)
          const bytes = new Uint8Array(await f.arrayBuffer())
          if (!isCurrent(generation)) return
          const parsed = await parseDeviceFile(f.name, bytes, today)
          if (!isCurrent(generation)) return
          parts.push(parsed)
        }
      }
    } catch (e) { if (!isCurrent(generation)) return; parts.push({ kind: "错误", brand: "", activities: [], health: [], notes: [e instanceof Error ? e.message : "读取失败"] }) }
    if (!isCurrent(generation)) return
    importing.current = false; setReading(false)
    stage(mergeResults(parts))
  }
  function stage(merged: DeviceParseResult) {
    if (!isCurrent()) return
    const have = existingKeys()
    const dh = new Set(merged.health.filter((h) => have.health.has(healthSavedKey(h))).map((h) => h.key))
    const da = new Set(merged.activities.filter((a) => (have.activities.has(activityDraftId(a)) || isDuplicate(a, have))).map((a) => a.key))
    setDup({ h: dh, a: da })
    setPickH(Object.fromEntries(merged.health.map((h) => [h.key, !dh.has(h.key)])))
    setPickA(Object.fromEntries(merged.activities.map((a) => [a.key, !da.has(a.key)])))
    setPickF({}); setVisibleStates(20); setVisibleActivities(200); setInputRevision({})
    setResult(merged); setStatus("")
  }
  function edit(key: string, patch: Partial<Pick<DeviceHealthRow, 'day' | 'value'>>) {
    if (!result || !isCurrent()) return
    const old=result.health.find(h=>h.key===key);if(!old)return
    const correction = editReviewedHealthRow(old, patch)
    if (!correction.ok) {
      // DecimalInput has its own draft. Reset a rejected draft so the visible
      // number cannot differ from the value that the save action would write.
      setInputRevision(p => ({ ...p, [key]: (p[key] ?? 0) + 1 }))
      setStatus(`${correction.reason} 已恢复为更正前的值。`)
      return
    }
    const updated = correction.row
    setStatus("")
    if (updated === old) return
    setResult({...result,health:result.health.map(h=>h.key===key?updated:h)})
    setPickH(p=>{const next={...p};delete next[key];return {...next,[updated.key]:true}})
    setDup(d=>({...d,h:new Set([...d.h].filter(k=>k!==key))}))
  }

  function save() {
    if (!result || !isCurrent()) return
    const inputs = panel.current?.querySelectorAll<HTMLInputElement>('tr[data-review-key] input:not([type="checkbox"])') ?? []
    if (![...inputs].filter(input => pickH[input.closest<HTMLElement>('tr')?.dataset.reviewKey ?? ''] === true).every(input => input.reportValidity())) { setStatus("请先修正选中的读数；空白不会当成0。"); return }
    const selection = selectReviewedDeviceRows(result, pickH, pickA, pickF)
    if (!selection.count) return
    const evidence=saveReviewedFacts(selection.facts)
    if (!isCurrent()) return
    const r = saveDeviceRows(selection.health, selection.activities)
    r.errors.push(...evidence.errors)
    setStatus(`已保存 ${r.saved} 条读数/活动、${evidence.saved} 条原始证据${r.skipped ? `，跳过已存在 ${r.skipped} 条` : ""}${r.errors.length ? `；${r.errors.length} 条未保存：${r.errors.slice(0, 3).join("；")}` : ""}`)
    if (r.saved || evidence.saved) { setStamp(Date.now()); onSaved() }
    if (!r.errors.length) setResult(null)
  }
  const nPick = result ? selectReviewedDeviceRows(result, pickH, pickA, pickF).count : 0
  const statusFacts = result ? reviewStatusFacts(result) : []
  return <section ref={panel} className="home-card p-4 text-sm" aria-label="导入设备数据">
    <div className="flex items-center justify-between gap-2"><h2 className="text-base font-bold">导入手表数据</h2><SavedBadge stamp={stamp} /></div>
    <p className="mt-1 text-muted">选择文件或截图，核对后一次保存。文件在本机解析，截图可选本地识字或联网识别。</p>
    {!hideConnectionLink ? <button type="button" className="mt-2 min-h-11 text-left text-sm text-accent" data-testid="device-connection-link" onClick={() => openDeviceSync()}>连接手表或运动软件 ›</button> : null}
    <label className="fk-drop mt-3">
      <Upload className="size-5" />
      <span className="font-bold">选择文件或截图</span>
      <small className="text-muted">FIT · GPX · TCX · CSV · 佳明数据导出 ZIP · Apple 健康 ZIP · 截图（可多选）</small>
      <input disabled={reading} type="file" multiple accept=".fit,.gpx,.tcx,.csv,.zip,.json,image/*" className="sr-only" onChange={(e) => { const input = e.currentTarget; void handle(input.files).finally(() => { input.value = "" }) }} />
    </label>
    <ImageIntake title="联网识别手表 / 健康截图" onText={(text) => { if (!isCurrent()) return; readGeneration.current++; importing.current = false; setReading(false); const r = parseSummaryText(text, today); setOcrText(text); stage({kind:"核对后的图片文字",brand:"待核对",activities:r.activity?[r.activity]:[],health:r.health,notes:["请逐项核对日期、单位和分段；缺少日期时页面暂用所选日期，不能当作原图日期。"]}); }} />
    {status ? <p className="mt-2" role="status">{status}</p> : null}
    {result ? <div className="mt-3 space-y-3">
      <p className="text-xs text-muted">识别为：{result.kind}{result.brand && result.brand !== "未知" ? ` · ${result.brand}` : ""}。{result.notes.join(" ")}</p>
      {statusFacts.length ? <details className="fk-h89-disclosure" data-testid="import-status-review">
        <summary>缺失与撤回状态（{statusFacts.length} 条）</summary>
        <p>只保存勾选的状态；撤回记录会移除对应读数。</p>
        <ul>{statusFacts.slice(0, visibleStates).map(f => <li key={reviewFactKey(f)}>
          <label className="flex min-h-11 cursor-pointer items-center gap-2">
            <input type="checkbox" aria-label={`保存原始状态 ${f.provider} ${f.metric} ${f.day} ${STATUS_LABELS[f.quality]}`} checked={pickF[reviewFactKey(f)] === true} onChange={e => setPickF(p => ({ ...p, [reviewFactKey(f)]: e.target.checked }))} />
            <span>{f.provider} · {(METRIC_LABELS as Record<string, string>)[f.metric] ?? f.metric} · {f.day} · {STATUS_LABELS[f.quality]}</span>
          </label>
        </li>)}</ul>
        <div className="flex flex-wrap gap-x-4">
          {visibleStates < statusFacts.length ? <button type="button" className="min-h-11 text-accent" onClick={() => setVisibleStates(n => n + 20)}>再显示 {Math.min(20, statusFacts.length - visibleStates)} 条</button> : null}
          <button type="button" className="min-h-11 text-accent" onClick={() => setPickF(p => ({ ...p, ...Object.fromEntries(statusFacts.slice(0, visibleStates).map(f => [reviewFactKey(f), true])) }))}>选中已显示状态</button>
          {Object.values(pickF).some(Boolean) ? <button type="button" className="min-h-11 text-muted" onClick={() => setPickF({})}>清空状态选择</button> : null}
        </div>
      </details> : null}
      {result.health.length ? <div className="overflow-x-auto rounded-xl border border-line"><table className="fk-table"><thead><tr><th></th><th>日期</th><th>指标</th><th>数值</th><th>来源</th></tr></thead><tbody>
        {result.health.map((h) => <tr key={h.key} data-review-key={h.key} className={dup.h.has(h.key) ? "opacity-60" : ""}>
          <td><input type="checkbox" aria-label="保存这条" checked={pickH[h.key] === true} onChange={(e) => setPickH({ ...pickH, [h.key]: e.target.checked })} /></td>
          <td><input type="date" value={h.day} onChange={(e) => edit(h.key, { day: e.target.value })} className="fk-cell w-[8.5rem]" /></td>
          <td>{METRIC_LABELS[h.metric]}</td>
          <td><DecimalInput key={inputRevision[h.key] ?? 0} min={0} value={h.value} onCommit={value=>{if(value!==null)edit(h.key,{value})}} className="fk-cell w-16" /> <span className="text-muted">{METRIC_UNITS[h.metric]}</span></td>
          <td className="text-muted">{dup.h.has(h.key) ? "已有，默认跳过" : h.source}</td></tr>)}
      </tbody></table></div> : null}
      {result.activities.length ? <div className="overflow-x-auto rounded-xl border border-line"><table className="fk-table"><thead><tr><th></th><th>时间</th><th>类型</th><th>距离</th><th>用时</th><th>配速</th><th>心率</th></tr></thead><tbody>
        {result.activities.slice(0, visibleActivities).map((a: DeviceActivity) => <tr key={a.key} className={dup.a.has(a.key) ? "opacity-60" : ""}>
          <td><input type="checkbox" aria-label="保存这次训练" checked={pickA[a.key] ?? false} onChange={(e) => setPickA({ ...pickA, [a.key]: e.target.checked })} /></td>
          <td>{a.startIso ? new Date(a.startIso).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
          <td>{a.sportLabel}{a.sets.length ? ` · ${a.sets.length} 组` : ""}{dup.a.has(a.key) ? " · 已导入" : ""}</td>
          <td>{a.distanceM ? `${(a.distanceM / 1000).toFixed(2)} km` : "—"}</td><td>{fmtDur(a.durationSec)}</td><td>{paceText(a) ?? "—"}</td>
          <td>{a.avgHr ?? "—"}{a.maxHr ? `/${a.maxHr}` : ""}</td></tr>)}
      </tbody></table></div> : null}
      {result.activities.length > visibleActivities ? <button type="button" className="min-h-11 text-accent" onClick={() => setVisibleActivities(n => n + 200)}>再显示 {Math.min(200, result.activities.length - visibleActivities)} 次训练（共 {result.activities.length} 次）</button> : null}
      {result.health.length || result.activities.length || (result.facts??[]).some(f=>f.quality!=='VALID') ? <button type="button" disabled={!nPick} onClick={save} className="fk-primary w-full">保存选中的 {nPick} 条</button> : null}
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
