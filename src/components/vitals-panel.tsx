import { useEffect, useState } from "react"
import { historyOf, HRV_METHOD_LABELS, latestOnDay, loadVitals, removeVital, saveVital, trendPoints, VITAL_KINDS, VITAL_LABELS, type HrvMethod, type VitalKind, type VitalRecord, type VitalSource } from "@/lib/nutrition/vitals"

export type ImportHint = { kind: "SLEEP" | "RECOVERY"; value: number; observedOn: string | null }

const inputClass = "h-12 w-full min-w-0 max-w-full rounded-card border border-line bg-bg px-3 text-fg outline-none"

function formatValue(record: VitalRecord): string {
  if (record.kind === "SLEEP") return `${record.value} 小时`
  if (record.kind === "RECOVERY") return `${record.value} / 10`
  if (record.kind === "HRV") return `${record.value} 毫秒`
  return `${record.value} 次/分`
}

function Trend({ records, kind, today, days, method }: { records: VitalRecord[]; kind: VitalKind; today: string; days: 7 | 30; method?: HrvMethod }) {
  const points = today ? trendPoints(records, kind, today, days, method) : null
  const title = kind === "HRV" && method ? `${HRV_METHOD_LABELS[method]} · ${days} 天` : `${days} 天`
  if (!points) return <p className="text-xs text-muted">{title}：少于两条同口径记录，不绘制，也不补缺失值。</p>
  const values = points.map((item) => item.value)
  const low = Math.min(...values)
  const high = Math.max(...values)
  const span = Math.max(high - low, 0.1)
  const width = 280
  const height = 72
  const start = Date.parse(`${points[0].observedOn}T00:00:00Z`)
  const end = Date.parse(`${today}T00:00:00Z`)
  const coords = points.map((item) => {
    const at = Date.parse(`${item.observedOn}T00:00:00Z`)
    const x = end === start ? width / 2 : 8 + ((at - start) / (end - start)) * (width - 16)
    const y = 64 - ((item.value - low) / span) * 52
    return `${x},${y}`
  })
  return <div>
    <p className="text-xs text-muted">{title} · {points.length} 条，缺失日期没有补点</p>
    <svg viewBox={`0 0 ${width} ${height}`} className="mt-1 h-20 w-full" role="img" aria-label={title}>
      <polyline fill="none" stroke="currentColor" strokeWidth="2" points={coords.join(" ")} />
      {coords.map((point, index) => {
        const [x, y] = point.split(",")
        return <circle key={points[index].id} cx={x} cy={y} r="2.5" />
      })}
    </svg>
  </div>
}

export function VitalsPanel({ revision, importHints, onSaved }: { revision: number; importHints: ImportHint[]; onSaved: () => void }) {
  const [records, setRecords] = useState<VitalRecord[]>([])
  const [unreadable, setUnreadable] = useState(false)
  const [today, setToday] = useState("")
  const [kind, setKind] = useState<VitalKind>("HRV")
  const [date, setDate] = useState("")
  const [time, setTime] = useState("")
  const [value, setValue] = useState("")
  const [method, setMethod] = useState<HrvMethod>("UNSPECIFIED")
  const [source, setSource] = useState<VitalSource>("MANUAL")
  const [note, setNote] = useState("")
  const [filter, setFilter] = useState<VitalKind | "ALL">("ALL")
  const [windowDays, setWindowDays] = useState<7 | 30>(7)
  const [message, setMessage] = useState("")

  useEffect(() => {
    const loaded = loadVitals()
    const now = new Date()
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
    setRecords(loaded.records)
    setUnreadable(loaded.unreadable)
    setToday(day)
    setDate((current) => current || day)
  }, [revision])

  function write(draft: Parameters<typeof saveVital>[0]) {
    const result = saveVital(draft)
    if (!result.ok) return setMessage(result.reason)
    setRecords(result.records)
    setMessage("已保存。同一天的其他记录还在，没有取平均。")
    onSaved()
  }

  function saveForm() {
    const parsed = Number(value)
    write({ kind, value: parsed, observedOn: date, observedAt: time, source, note, hrvMethod: kind === "HRV" ? method : null })
  }

  function copyHint(hint: ImportHint) {
    if (!hint.observedOn) return setMessage("这条训练没有可用日期，没有抄入。请在表单里手填。")
    write({
      kind: hint.kind,
      value: hint.value,
      observedOn: hint.observedOn,
      observedAt: null,
      source: "MANUAL",
      note: "用户从已确认训练抄录",
      hrvMethod: null,
    })
  }

  const shown = historyOf(records, filter)

  return <section className="mt-4 rounded-card border border-line bg-surface p-3 text-sm">
    <h2 className="font-bold">手动监测</h2>
    <p className="mt-1 text-muted">数字只在你保存后写入本机。截图不会被识别，也不会存成记录。</p>
    {unreadable ? <p className="mt-2 font-bold">已有监测记录无法读取。为避免覆盖，现在不能保存。</p> : null}
    <div className="mt-3 grid gap-2">
      <label className="grid gap-1 text-muted">指标
        <select value={kind} onChange={(event) => setKind(event.target.value as VitalKind)} className={inputClass}>
          {VITAL_KINDS.map((item) => <option key={item} value={item}>{VITAL_LABELS[item]}</option>)}
        </select>
      </label>
      <div className="grid min-w-0 grid-cols-1 gap-2">
        <label className="grid gap-1 text-muted">日期
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={inputClass} />
        </label>
        <label className="grid gap-1 text-muted">时间，可空
          <input type="time" value={time} onChange={(event) => setTime(event.target.value)} className={inputClass} />
        </label>
      </div>
      <label className="grid gap-1 text-muted">数值 {kind === "HRV" ? "毫秒" : kind === "SLEEP" ? "小时" : kind === "RECOVERY" ? "1–10" : "次/分"}
        <input inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} className={inputClass} />
      </label>
      {kind === "HRV" ? <label className="grid gap-1 text-muted">HRV 口径
        <select value={method} onChange={(event) => setMethod(event.target.value as HrvMethod)} className={inputClass}>
          <option value="RMSSD">RMSSD</option>
          <option value="SDNN">SDNN</option>
          <option value="UNSPECIFIED">未说明</option>
        </select>
      </label> : null}
      <label className="grid gap-1 text-muted">来源
        <select value={source} onChange={(event) => setSource(event.target.value as VitalSource)} className={inputClass}>
          <option value="MANUAL">手工填写</option>
          <option value="IMAGE_CONFIRMED">对照截图后手工填写</option>
        </select>
      </label>
      <label className="grid gap-1 text-muted">备注，最多 80 字
        <input value={note} maxLength={80} onChange={(event) => setNote(event.target.value)} className={inputClass} />
      </label>
      <button type="button" onClick={saveForm} disabled={unreadable} className="min-h-12 rounded-card bg-accent font-bold text-accent-fg disabled:opacity-50">保存监测记录</button>
      {message ? <p>{message}</p> : null}
    </div>
    {importHints.length ? <div className="mt-4 border-t border-line pt-3">
      <h3 className="font-bold">已确认训练里的数字</h3>
      <p className="mt-1 text-muted">这些还不是监测记录。只有按下按钮才会另存一条。</p>
      {importHints.map((hint) => <button key={`${hint.kind}-${hint.observedOn ?? "none"}`} type="button" onClick={() => copyHint(hint)} className="mt-2 min-h-12 w-full rounded-card border border-line px-3 text-left font-bold">
        把{hint.kind === "SLEEP" ? `睡眠 ${hint.value} 小时` : `主观恢复 ${hint.value}/10`}抄成监测记录
      </button>)}
    </div> : null}
    <div className="mt-4 border-t border-line pt-3">
      <div className="flex gap-2">
        <button type="button" aria-pressed={windowDays === 7} onClick={() => setWindowDays(7)} className={"min-h-10 rounded-card border px-3 font-bold " + (windowDays === 7 ? "border-accent" : "border-line")}>7 天</button>
        <button type="button" aria-pressed={windowDays === 30} onClick={() => setWindowDays(30)} className={"min-h-10 rounded-card border px-3 font-bold " + (windowDays === 30 ? "border-accent" : "border-line")}>30 天</button>
      </div>
      <div className="mt-3 grid gap-3">
        {kind === "HRV" ? (["RMSSD", "SDNN", "UNSPECIFIED"] as HrvMethod[]).map((item) => <Trend key={item} records={records} kind="HRV" today={today} days={windowDays} method={item} />) : <Trend records={records} kind={kind} today={today} days={windowDays} />}
      </div>
      <p className="mt-2 text-xs text-muted">{today && latestOnDay(records, kind, today) ? `今天最新一条已在上方概览。` : "今天还没有这个指标。"}</p>
    </div>
    <div className="mt-4 border-t border-line pt-3">
      <label className="grid gap-1 text-muted">历史筛选
        <select value={filter} onChange={(event) => setFilter(event.target.value as VitalKind | "ALL")} className={inputClass}>
          <option value="ALL">全部</option>
          {VITAL_KINDS.map((item) => <option key={item} value={item}>{VITAL_LABELS[item]}</option>)}
        </select>
      </label>
      {shown.length === 0 ? <p className="mt-2 text-muted">暂无记录</p> : <ul className="mt-2 grid gap-2">
        {shown.map((item) => <li key={item.id} className="rounded-xl border border-line px-3 py-2.5">
          <p className="font-bold">{VITAL_LABELS[item.kind]} · {formatValue(item)}</p>
          <p className="text-xs text-muted">{item.observedOn}{item.observedAt ? ` ${item.observedAt}` : " · 时刻未记录"}{item.hrvMethod ? ` · ${HRV_METHOD_LABELS[item.hrvMethod]}` : ""} · {item.source === "MANUAL" ? "手工" : "对照截图"}</p>
          {item.note ? <p className="text-xs">{item.note}</p> : null}
          <button type="button" onClick={() => {
            if (!window.confirm(`确认删除这条${VITAL_LABELS[item.kind]}记录？此操作不可撤销。`)) return
            const result = removeVital(item.id)
            if (!result.ok) return setMessage(result.reason)
            setRecords(result.records)
            setMessage("已删除这一条。其他记录还在。")
            onSaved()
          }} className="mt-1 min-h-10 text-xs text-muted underline underline-offset-4">删除记录…</button>
        </li>)}
      </ul>}
    </div>
  </section>
}
