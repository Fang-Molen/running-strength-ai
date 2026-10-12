import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react"
import { AlertTriangle, Camera, Check, ChevronLeft, LoaderCircle, Plus, Trash2, X } from "lucide-react"
import {
  confirmTrainingImport,
  createTrainingImportDraft,
  criticalImportGaps,
  loadConfirmedTrainingImports,
  normalizeConfirmedTrainingImport,
  saveTrainingImportDraft,
  type ImportField,
  type ImportedRunningSegment,
  type ImportedStrengthSet,
  type TrainingImportDraft,
  type TrainingImportReview,
  type ConfirmedTrainingImport,
} from "@/lib/core/training-import"
import { assessImportedTraining, assessImportedTrainingTrend, type CoachEvidenceClaim, type ImportedTrainingCoachAssessment, type ImportedTrainingTrend } from "@/lib/core/training-coach"
import { extractTrainingImport, reviewTrainingImport, type TrainingImportImage } from "@/lib/strength/training-import-ai"
import { TrainingFollowupPanel } from "./training-followup-panel"
import { DeviceEvidenceImport } from "./device-evidence-import"
import { CoachKnowledgePanel } from "./coach-knowledge-panel"
import { assessImportCompleteness, refreshImportCompleteness } from "@/lib/core/import-completeness"
import { observeImportedRunning } from "@/lib/core/running-observation"
import { trialReviewClosed } from "@/lib/core/trial"

type Step = "input" | "review" | "result"

function recorded<T>(value: T | null): ImportField<T> {
  return { value, status: value == null ? "ABSENT" : "RECORDED", sourceIds: value == null ? [] : ["user-edited"] }
}

function empty<T>(): ImportField<T> {
  return { value: null, status: "ABSENT", sourceIds: [] }
}

function sessionRpeField(text: string): ImportField<number> {
  if (!text.trim()) return empty()
  return /^(?:[1-9]|10)$/.test(text.trim()) ? recorded(Number(text)) : { value: null, status: "AMBIGUOUS", sourceIds: ["user-edited"] }
}

function number(text: string): number | null {
  if (!text.trim()) return null
  const value = Number(text)
  return Number.isFinite(value) && value >= 0 ? value : null
}

async function imageFromFile(file: File, index: number): Promise<TrainingImportImage> {
  if (!/^image\/(jpeg|png)$/.test(file.type)) throw new Error("只支持 JPG 或 PNG")
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const mimeType = file.type === "image/png" ? "image/png" : "image/jpeg"
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mimeType, mimeType === "image/jpeg" ? 0.88 : undefined))
  if (!blob || blob.size > 4 * 1024 * 1024) throw new Error("压缩后仍超过 4 MB，请裁剪图片")
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ""))
    reader.onerror = () => reject(new Error("图片读取失败"))
    reader.readAsDataURL(blob)
  })
  return { mimeType, dataUrl, bytes: blob.size, sourceId: `image-${index + 1}` as TrainingImportImage["sourceId"] }
}

function ImportedRunningReadout({ segments }: { segments: TrainingImportDraft["runningSegments"] }) {
  const observation = observeImportedRunning(segments)
  if (!observation.slots) return null
  return <details className="mt-3 rounded-card border border-line bg-surface p-3 text-sm"><summary className="min-h-11 cursor-pointer py-2 font-bold">已记录部分的分段观察</summary><p className="mt-2 text-xs text-muted">计划偏差：不可用。上传记录没有可靠原计划。模式：证据不足。计时误差和个人正常波动未知，只报告数值。这是有效已记录部分，不代表全课。</p><p className="mt-2">完成 {observation.completed} · 跳过 {observation.skipped} · 缺失 {observation.missing} · 槽位 {observation.slots}</p>{observation.rounds.map((round) => <p key={`${round.round}`} className="mt-1">第 {round.round ?? "未标"} 轮：有效 {round.count}，最快 {round.fastest ?? "—"} 秒，最慢 {round.slowest ?? "—"} 秒，平均 {round.mean ?? "—"}，中位 {round.median ?? "—"}{round.withinDelta != null ? `，轮内末减初 ${round.withinDelta} 秒` : ""}</p>)}{observation.betweenRoundMeanDelta != null ? <p className="mt-1">轮间平均差（末轮减首轮）{observation.betweenRoundMeanDelta} 秒</p> : null}{observation.lastDelta != null ? <p className="mt-1">同距末次相对首次 {observation.lastDelta} 秒</p> : null}<p className="mt-2 text-xs text-muted">{observation.paceNote} {observation.formula}</p></details>
}

function FieldLabel({ label, field }: { label: string; field: ImportField<unknown> }) {
  const risky = field.status === "AMBIGUOUS" || field.status === "CONFLICTING"
  return <span className="flex items-center gap-1 text-xs text-muted">{label}{risky ? <AlertTriangle className="size-3 text-warn" /> : null}</span>
}

function ClaimList({ title, items, sources }: { title: string; items: { text: string; citations: string[] }[]; sources: Map<string, string> }) {
  if (!items.length) return null
  return <section className="rounded-card border border-line bg-surface p-3">
    <h3 className="font-bold">{title}</h3>
    <ul className="mt-2 space-y-3 text-sm">
      {items.map((item, index) => <li key={`${title}-${index}`}>
        <p>{item.text}</p>
        {item.citations.length ? <p className="mt-1 text-xs text-muted">依据：{item.citations.map((id) => sources.get(id) ?? id).join("；")}</p> : null}
      </li>)}
    </ul>
  </section>
}

function EvidenceLine({ item, sources }: { item: CoachEvidenceClaim; sources: Map<string, string> }) {
  return <div className="rounded-card bg-bg p-2 text-sm"><p>{item.text}</p>{item.citations.length ? <p className="mt-1 text-xs text-muted">依据：{item.citations.map((id) => sources.get(id) ?? id).join("；")}</p> : null}</div>
}

export function TrainingImportSheet({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>("input")
  const [text, setText] = useState("")
  const [images, setImages] = useState<TrainingImportImage[]>([])
  const [draft, setDraft] = useState<TrainingImportDraft | null>(null)
  const [review, setReview] = useState<TrainingImportReview | null>(null)
  const [confirmedRecord, setConfirmedRecord] = useState<ConfirmedTrainingImport | null>(null)
  const [history, setHistory] = useState<ConfirmedTrainingImport[]>([])
  useEffect(() => { setHistory(loadConfirmedTrainingImports().map(normalizeConfirmedTrainingImport).filter((record): record is ConfirmedTrainingImport => record !== null)) }, [])
  const reviewInFlight = useRef(false)
  const extractInFlight = useRef(false)
  const confirmInFlight = useRef(false)
  const [coachAssessment, setCoachAssessment] = useState<ImportedTrainingCoachAssessment | null>(null)
  const [trend, setTrend] = useState<ImportedTrainingTrend | null>(null)
  const [confirmedSources, setConfirmedSources] = useState<{ id: string; detail: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const gaps = draft ? criticalImportGaps(draft) : []
  const sourceMap = useMemo(() => new Map(confirmedSources.map((item) => [item.id, item.detail])), [confirmedSources])

  function openConfirmed(record: ConfirmedTrainingImport) {
    if (busy || reviewInFlight.current) return
    const current = normalizeConfirmedTrainingImport(loadConfirmedTrainingImports().find((item) => item.confirmedImportId === record.confirmedImportId))
    if (!current) return setMessage("这份记录已不可读取，未采用旧页面数据。")
    setDraft(null)
    setImages([])
    setReview(null)
    setConfirmedRecord(current)
    setConfirmedSources(current.sources)
    setCoachAssessment(assessImportedTraining(current))
    setTrend(assessImportedTrainingTrend(loadConfirmedTrainingImports()))
    setMessage("只读回看已确认训练，没有重新确认或调用模型。")
    setStep("result")
  }

  async function pickImages(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])].slice(0, 4)
    setMessage("")
    try {
      const converted: TrainingImportImage[] = []
      for (const [index, file] of files.entries()) converted.push(await imageFromFile(file, index))
      if (converted.reduce((sum, item) => sum + item.bytes, 0) > 12 * 1024 * 1024) throw new Error("图片合计不能超过 12 MB")
      setImages(converted)
    } catch (error) {
      setImages([])
      setMessage(error instanceof Error ? error.message : "图片处理失败")
    }
  }

  async function extract() {
    if (extractInFlight.current || busy) return
    if (!text.trim() && images.length === 0) return setMessage("请粘贴训练文字，或选择训练截图")
    extractInFlight.current = true
    setBusy(true)
    setMessage("正在提取，通常十几秒。超过 50 秒会停，不会写入记录。")
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await Promise.race([
        extractTrainingImport({ data: { text, images } }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("EXTRACT_TIMEOUT")), 50_000)
        }),
      ])
      if (!result.ok) return setMessage(result.reason === "NO_KEY" ? "服务端还没有模型密钥，未生成假结果" : result.reason === "LOCKED" ? "没有调用模型：服务端安全开关未打开，或当前账号无权使用。记录没有写入。" : `没有拿到可核对的提取结果：${result.reason}。记录没有写入，可以手动重试。`)
      const inputKind = images.length > 1 ? "MULTI_IMAGE" : images.length === 1 ? "IMAGE" : "TEXT"
      const inputSourceIds = [...(text.trim() ? ["text" as const] : []), ...images.map((item) => item.sourceId)]
      const next = createTrainingImportDraft(result.candidate, inputKind, inputSourceIds)
      next.importCompleteness = assessImportCompleteness({ text, extractedRunning: next.runningSegments.length, extractedStrength: next.strengthSets.length })
      saveTrainingImportDraft(next)
      setDraft(next)
      setConfirmedRecord(null)
      setReview(null)
      setCoachAssessment(null)
      setTrend(null)
      setConfirmedSources([])
      setImages([])
      setStep("review")
    } catch (error) {
      setMessage(error instanceof Error && error.message === "EXTRACT_TIMEOUT" ? "提取超过 50 秒，没有写入记录。可以先去掉图片，只贴文字再试。" : "提取请求失败，没有写入记录。图片还在，可以手动重试。")
    } finally {
      if (timer) clearTimeout(timer)
      extractInFlight.current = false
      setBusy(false)
    }
  }

  function patch(next: Partial<TrainingImportDraft>) {
    if (!draft) return
    if (confirmedRecord?.draftId === draft.draftId) return setMessage("这份实际记录已确认，不能用旧草稿覆盖。新增训练请返回输入后重新提取。")
    const value = { ...draft, ...next }
    if (value.importCompleteness) value.importCompleteness = refreshImportCompleteness(value.importCompleteness, value.runningSegments.length, value.strengthSets.length)
    setDraft(value)
    saveTrainingImportDraft(value)
  }

  function patchRun(index: number, next: Partial<ImportedRunningSegment>) {
    if (!draft) return
    patch({ runningSegments: draft.runningSegments.map((item, itemIndex) => itemIndex === index ? { ...item, ...next, sourceIds: ["user-edited"] } : item) })
  }

  function patchSet(index: number, next: Partial<ImportedStrengthSet>) {
    if (!draft) return
    patch({ strengthSets: draft.strengthSets.map((item, itemIndex) => itemIndex === index ? { ...item, ...next, sourceIds: ["user-edited"] } : item) })
  }

  async function requestReview(record: ConfirmedTrainingImport) {
    const closed = trialReviewClosed(record)
    if (closed) return setMessage(closed)
    if (reviewInFlight.current) return
    reviewInFlight.current = true
    setBusy(true)
    setReview(null)
    setMessage("实际记录已确认。本次只请求模型复盘，不重复写入记录。")
    try {
      const reviewed = await reviewTrainingImport({ data: { record } })
      if (reviewed.ok) setReview(reviewed.review)
      else setMessage(reviewed.reason === "LOCKED" ? "记录已保留。没有调用模型：服务端安全开关未打开，或当前账号无权使用。" : `记录已保留。模型复盘暂不可用：${reviewed.reason}。可手动重试。`)
    } catch {
      setMessage("记录已保留。模型复盘请求失败，可手动重试。")
    } finally {
      reviewInFlight.current = false
      setBusy(false)
    }
  }

  async function confirm() {
    if (!draft || confirmInFlight.current || busy) return
    confirmInFlight.current = true
    const result = confirmTrainingImport(draft)
    if (!result.ok) {
      confirmInFlight.current = false
      return setMessage(result.reason)
    }
    setConfirmedRecord(result.record)
    setHistory(loadConfirmedTrainingImports().map(normalizeConfirmedTrainingImport).filter((record): record is ConfirmedTrainingImport => record !== null))
    setMessage(result.duplicate ? "这份训练已经确认过，没有重复写入。" : "已确认实际记录。没有改课表，也没有生成训练事件。")
    setConfirmedSources(result.record.sources)
    setCoachAssessment(assessImportedTraining(result.record))
    setTrend(assessImportedTrainingTrend(loadConfirmedTrainingImports()))
    setStep("result")
    // Duplicate confirmation never starts another paid model request.
    if (!result.duplicate) await requestReview(result.record)
    confirmInFlight.current = false
  }

  const phaseIndex = step === "input" ? 0 : step === "review" ? 1 : 2
  const jumpTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })

  return <div className="fixed inset-0 z-50 overflow-y-auto bg-bg">
    <header className="sticky top-0 z-10 border-b border-line bg-bg/95 px-4 py-3 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
        <button type="button" disabled={busy} onClick={step === "input" ? onClose : () => setStep(step === "result" && draft ? "review" : "input")} className="grid size-11 place-items-center rounded-full border border-line disabled:opacity-50" aria-label="返回"><ChevronLeft className="size-5" /></button>
        <div className="min-w-0 flex-1"><p className="text-xs text-muted">人工确认后才分析 · 恢复许可仍需证据</p><h2 className="truncate text-lg font-bold">训练上传与复盘</h2></div>
        <button type="button" onClick={onClose} className="grid size-11 place-items-center rounded-full border border-line" aria-label="关闭"><X className="size-5" /></button>
      </div>
    </header>

    <main className="mx-auto max-w-3xl px-4 py-4 pb-[max(3rem,env(safe-area-inset-bottom))]">
      <nav aria-label="训练上传进度" className="mb-4 grid grid-cols-3 gap-2" >
        {(["1 提供记录", "2 人工核对", "3 查看结果"] as const).map((label, index) => <div key={label} aria-current={phaseIndex === index ? "step" : undefined} className={`rounded-card px-2 py-3 text-center text-xs font-bold ${phaseIndex === index ? "bg-accent text-accent-fg" : phaseIndex > index ? "border border-accent/50 bg-surface text-fg" : "border border-line bg-surface text-muted"}`}>{label}</div>)}
      </nav>
      {step === "input" ? <>
        <details className="mb-3 rounded-card border border-line bg-surface p-3"><summary className="min-h-11 cursor-pointer py-2 font-bold">不用大模型 · 设备截图与身体数据本地识别</summary><DeviceEvidenceImport /></details>
        <section className="rounded-card border border-line bg-surface p-4">
          <h3 className="font-bold">训练文字或截图</h3>
          <p className="mt-1 text-sm text-muted">先识别成草稿。不会直接改课表、疲劳分或教练 Decision。模型提取目前关闭，点按钮也不会产生模型费用或假记录。</p>
          <textarea aria-label="训练记录文字" value={text} onChange={(event) => setText(event.target.value)} maxLength={6000} rows={5} placeholder="例如：今天 200m×4×2，第一轮 34/35/35/36 秒……" className="mt-3 w-full resize-y rounded-card border border-line bg-bg p-3 text-base outline-none" />
          <div className="mt-1 text-right text-xs text-muted">{text.length} / 6000 字 · 可以只输入文字，也可以只上传图片</div>
          <label className="mt-3 flex min-h-14 items-center justify-center gap-2 rounded-card border border-dashed border-line bg-surface-2 font-bold">
            <Camera className="size-5" />选择训练截图（最多 4 张）
            <input type="file" accept="image/jpeg,image/png" multiple className="sr-only" onChange={pickImages} />
          </label>
          {images.length ? <p className="mt-2 text-sm text-muted">已准备 {images.length} 张，合计 {(images.reduce((sum, item) => sum + item.bytes, 0) / 1024 / 1024).toFixed(1)} MB。只用于本次服务端提取，提取后立即从页面内存清除。</p> : null}
        </section>
        <button type="button" disabled={busy} onClick={extract} className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-card bg-accent font-bold text-accent-fg disabled:opacity-60">{busy ? <LoaderCircle className="size-5 animate-spin" /> : null}{busy ? "正在提取事实" : "生成可校对草稿"}</button>
        {busy ? <div role="status" aria-live="polite" className="mt-3 rounded-card border border-line bg-surface p-4 text-sm"><p className="font-bold">正在整理训练事实，请稍候</p><p className="mt-1 text-muted">最多等待 50 秒。这不是完成百分比。完成后进入人工核对，不会自动保存。请勿重复点击。</p></div> : null}
        {message ? <p role="status" aria-live="polite" className="mt-3 rounded-card bg-surface-2 p-3 text-sm">{message}</p> : null}
        {history.length ? <details className="mt-4 rounded-card border border-line bg-surface p-3"><summary className="min-h-11 cursor-pointer py-2 font-bold">回看已确认训练与恢复反馈</summary><div className="mt-2 space-y-2">{history.slice().sort((a, b) => Date.parse(b.occurredAt.value!) - Date.parse(a.occurredAt.value!)).slice(0, 10).map((record) => <button key={record.confirmedImportId} type="button" disabled={busy} onClick={() => openConfirmed(record)} className="min-h-14 w-full break-words rounded-card border border-line bg-bg p-3 text-left text-sm disabled:opacity-50"><b>{record.title.value || "已确认训练"}</b><span className="mt-1 block text-xs text-muted">{new Date(record.occurredAt.value!).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })} · {record.sport}</span></button>)}</div><p className="mt-2 text-xs text-muted">显示最近10份；打开只读取，不自动调用模型。</p></details> : null}
      </> : null}

      {step === "review" && draft ? <>
        <div className="rounded-card border border-line bg-surface p-3">
          <p className="font-bold">核对这节训练</p>
          <p className="mt-1 text-xs text-muted">识别结果只是草稿。先看基本信息和分组，再检查下方遗漏与冲突。</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => jumpTo("import-basic")} className="min-h-11 rounded-full border border-line px-3 text-xs font-bold">基本信息</button>
            {(draft.sport === "RUNNING" || draft.sport === "MIXED") && <button type="button" onClick={() => jumpTo("import-running")} className="min-h-11 rounded-full border border-line px-3 text-xs font-bold">跑步 {draft.runningSegments.length} 段</button>}
            {(draft.sport === "STRENGTH" || draft.sport === "MIXED") && <button type="button" onClick={() => jumpTo("import-strength")} className="min-h-11 rounded-full border border-line px-3 text-xs font-bold">力量 {draft.strengthSets.length} 组</button>}
            <button type="button" onClick={() => jumpTo("import-confirm")} className="min-h-11 rounded-full border border-line px-3 text-xs font-bold">检查并确认</button>
          </div>
        </div>
        <div className="mt-3 rounded-card border border-warn bg-surface p-3 text-sm"><b>这不是已完成记录。</b> 请逐项核对；未记录不会当成 0，冲突不会自动替你选择。</div>
        <section id="import-basic" className="mt-3 scroll-mt-24 grid grid-cols-2 gap-3 rounded-card border border-line bg-surface p-3">
          <label className="col-span-2"><FieldLabel label="训练类型" field={draft.title} /><select value={draft.sport} onChange={(event) => patch({ sport: event.target.value as TrainingImportDraft["sport"] })} className="mt-1 h-12 w-full rounded-card border border-line bg-bg px-3"><option value="UNKNOWN">待确认</option><option value="RUNNING">跑步</option><option value="STRENGTH">力量</option><option value="MIXED">混合课</option></select></label>
          <div className="col-span-2 flex flex-wrap gap-2"><button type="button" className="min-h-11 rounded-full border border-line px-4 text-sm" onClick={() => { const d = new Date(); d.setDate(d.getDate() - 1); const offset = -d.getTimezoneOffset(); const sign = offset >= 0 ? "+" : "-"; const pad = (n: number) => String(n).padStart(2, "0"); const stamp = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T18:00:00${sign}${pad(Math.floor(Math.abs(offset)/60))}:${pad(Math.abs(offset)%60)}`; patch({ occurredAt: recorded(stamp) }) }}>设为昨天18:00（可修改）</button><span className="self-center text-xs text-muted">可补录昨天的跑步、力量或混合训练；时间按设备本地时区填写，请核对。</span></div>
          <label className="col-span-2"><FieldLabel label="训练时间" field={draft.occurredAt} /><input value={draft.occurredAt.value ?? ""} onChange={(event) => patch({ occurredAt: recorded(event.target.value || null) })} placeholder="2026-10-08T18:30:00+08:00" className="mt-1 h-12 w-full rounded-card border border-line bg-bg px-3" /></label>
          <label className="col-span-2"><FieldLabel label="标题" field={draft.title} /><input value={draft.title.value ?? ""} onChange={(event) => patch({ title: recorded(event.target.value || null) })} className="mt-1 h-12 w-full rounded-card border border-line bg-bg px-3" /></label>
          <label><FieldLabel label="总时长（秒）" field={draft.durationSeconds} /><input inputMode="decimal" value={draft.durationSeconds.value ?? ""} onChange={(event) => patch({ durationSeconds: recorded(number(event.target.value)) })} className="mt-1 h-12 w-full rounded-card border border-line bg-bg px-3" /></label>
          <label><FieldLabel label="总距离（米）" field={draft.totalDistanceMeters} /><input inputMode="decimal" value={draft.totalDistanceMeters.value ?? ""} onChange={(event) => patch({ totalDistanceMeters: recorded(number(event.target.value)) })} className="mt-1 h-12 w-full rounded-card border border-line bg-bg px-3" /></label>
          <label className="col-span-2"><FieldLabel label="这节训练整体有多吃力？" field={draft.sessionRpe} /><input inputMode="numeric" value={draft.sessionRpe.value ?? ""} onChange={(event) => patch({ sessionRpe: sessionRpeField(event.target.value) })} placeholder="整课 RPE 1–10，可留空" className="mt-1 h-12 w-full rounded-card border border-line bg-bg px-3" /></label>
          <details className="col-span-2 rounded-card bg-bg p-3 text-xs text-muted"><summary className="min-h-11 cursor-pointer py-2 font-bold text-fg">用力说明（自己选，不会自动打分）</summary><p className="mt-2">这是产品引导，不是经过验证的中文版量表，也不把分数对应到固定配速、心率或剩余次数。空白表示未记录。整课 RPE 和某一组的用力不是一回事。</p><ul className="mt-2 list-disc pl-4"><li>1–2：很轻松，呼吸平稳。</li><li>3–4：轻松，能说话。跑步像放松跑，力量留有很多余力。</li><li>5–6：中等，说话开始断续。</li><li>7–8：很吃力，只能说短句。</li><li>9–10：极吃力。10 不是必须打到，也不等于应该做到失败。</li></ul></details>
          <label><FieldLabel label="恢复 1–10" field={draft.subjectiveRecovery} /><input inputMode="numeric" value={draft.subjectiveRecovery.value ?? ""} onChange={(event) => patch({ subjectiveRecovery: recorded(number(event.target.value)) })} className="mt-1 h-12 w-full rounded-card border border-line bg-bg px-3" /></label>
        </section>

        {(draft.sport === "RUNNING" || draft.sport === "MIXED") ? <section id="import-running" className="mt-3 scroll-mt-24 rounded-card border border-line bg-surface p-3">
          <div className="flex items-center justify-between"><h3 className="font-bold">跑步实际分段</h3><button type="button" onClick={() => patch({ runningSegments: [...draft.runningSegments, { id: `run-${Date.now()}`, kind: "REPETITION", round: empty<number>(), repeat: empty<number>(), distanceMeters: empty<number>(), durationSeconds: empty<number>(), recoverySeconds: empty<number>(), completion: "NOT_RECORDED", sourceIds: ["user-edited"] }] })} className="flex h-10 items-center gap-1 rounded-full px-3 text-sm font-bold text-accent"><Plus className="size-4" />添加</button></div>
          <div className="mt-2 space-y-3">{draft.runningSegments.map((segment, index) => <div key={segment.id} className="rounded-card bg-bg p-3">
            <div className="flex justify-between"><b>分段 {index + 1}</b><button type="button" onClick={() => patch({ runningSegments: draft.runningSegments.filter((_, i) => i !== index) })} aria-label="删除分段"><Trash2 className="size-4 text-risk" /></button></div>
            <div className="mt-2 grid grid-cols-3 gap-2"><input aria-label="轮" placeholder="轮" inputMode="numeric" value={segment.round.value ?? ""} onChange={(e) => patchRun(index, { round: recorded(number(e.target.value)) })} className="h-11 min-w-0 rounded-card border border-line px-2" /><input aria-label="次" placeholder="次" inputMode="numeric" value={segment.repeat.value ?? ""} onChange={(e) => patchRun(index, { repeat: recorded(number(e.target.value)) })} className="h-11 min-w-0 rounded-card border border-line px-2" /><select aria-label="完成状态" value={segment.completion} onChange={(e) => patchRun(index, { completion: e.target.value as ImportedRunningSegment["completion"] })} className="h-11 min-w-0 rounded-card border border-line px-1"><option value="COMPLETED">完成</option><option value="SKIPPED">跳过</option><option value="NOT_RECORDED">未记录</option></select><input aria-label="距离米" placeholder="距离m" inputMode="decimal" value={segment.distanceMeters.value ?? ""} onChange={(e) => patchRun(index, { distanceMeters: recorded(number(e.target.value)) })} className="h-11 min-w-0 rounded-card border border-line px-2" /><input aria-label="用时秒" placeholder="用时s" inputMode="decimal" value={segment.durationSeconds.value ?? ""} onChange={(e) => patchRun(index, { durationSeconds: recorded(number(e.target.value)) })} className="h-11 min-w-0 rounded-card border border-line px-2" /><input aria-label="恢复秒" placeholder="恢复s" inputMode="decimal" value={segment.recoverySeconds.value ?? ""} onChange={(e) => patchRun(index, { recoverySeconds: recorded(number(e.target.value)) })} className="h-11 min-w-0 rounded-card border border-line px-2" /></div>
          </div>)}</div>
        </section> : null}

        {(draft.sport === "STRENGTH" || draft.sport === "MIXED") ? <section id="import-strength" className="mt-3 scroll-mt-24 rounded-card border border-line bg-surface p-3">
          <div className="flex items-center justify-between"><h3 className="font-bold">力量实际组</h3><button type="button" onClick={() => patch({ strengthSets: [...draft.strengthSets, { id: `set-${Date.now()}`, exerciseName: empty<string>(), setOrdinal: empty<number>(), weightKg: empty<number>(), repetitions: empty<number>(), durationSeconds: empty<number>(), recoverySeconds: empty<number>(), completion: "NOT_RECORDED", sourceIds: ["user-edited"] }] })} className="flex h-10 items-center gap-1 rounded-full px-3 text-sm font-bold text-accent"><Plus className="size-4" />添加</button></div>
          <div className="mt-2 space-y-3">{draft.strengthSets.map((set, index) => <div key={set.id} className="rounded-card bg-bg p-3">
            <div className="flex justify-between"><b>组 {index + 1}</b><button type="button" onClick={() => patch({ strengthSets: draft.strengthSets.filter((_, i) => i !== index) })} aria-label="删除力量组"><Trash2 className="size-4 text-risk" /></button></div>
            <input aria-label="动作" placeholder="动作名称" value={set.exerciseName.value ?? ""} onChange={(e) => patchSet(index, { exerciseName: recorded(e.target.value || null) })} className="mt-2 h-11 w-full rounded-card border border-line px-2" />
            <div className="mt-2 grid grid-cols-3 gap-2"><input aria-label="第几组" placeholder="第几组" inputMode="numeric" value={set.setOrdinal.value ?? ""} onChange={(e) => patchSet(index, { setOrdinal: recorded(number(e.target.value)) })} className="h-11 min-w-0 rounded-card border border-line px-2" /><input aria-label="重量" placeholder="kg" inputMode="decimal" value={set.weightKg.value ?? ""} onChange={(e) => patchSet(index, { weightKg: recorded(number(e.target.value)) })} className="h-11 min-w-0 rounded-card border border-line px-2" /><input aria-label="次数" placeholder="次数" inputMode="numeric" value={set.repetitions.value ?? ""} onChange={(e) => patchSet(index, { repetitions: recorded(number(e.target.value)) })} className="h-11 min-w-0 rounded-card border border-line px-2" /></div>
          </div>)}</div>
        </section> : null}

        <div id="import-confirm" className="scroll-mt-24 pt-3"><h3 className="text-sm font-bold">最后一步 · 检查遗漏并确认</h3><p className="mt-1 text-xs text-muted">只有按下确认按钮，才会保存这份实际记录。</p></div>
        {draft.conflicts.length ? <section className="mt-3 rounded-card border border-warn bg-surface p-3"><h3 className="font-bold text-warn">冲突待核对</h3><ul className="mt-2 list-disc pl-5 text-sm">{draft.conflicts.map((item) => <li key={item}>{item}</li>)}</ul><button type="button" onClick={() => patch({ conflicts: [] })} className="mt-3 h-11 w-full rounded-card border border-line font-bold">我已人工核对并改正</button></section> : null}
        {draft.importCompleteness && draft.importCompleteness.status !== "COMPLETE" ? <section className="mt-3 rounded-card border border-warn bg-surface p-3 text-sm"><b>可能未完整提取，请核对总次数、轮次和力量组数。</b><p className="mt-2">{draft.importCompleteness.note}</p>{draft.importCompleteness.acknowledged ? <p className="mt-2 text-xs text-muted">你已核对。这仍不是模型证明的全课，补录来源是用户编辑。</p> : <button type="button" onClick={() => patch({ importCompleteness: { ...draft.importCompleteness!, acknowledged: true } })} className="mt-3 h-11 w-full rounded-card border border-line font-bold">我已核对次数与组数，未列出的不算没做</button>}</section> : null}
        {gaps.length ? <p className="mt-3 text-sm text-risk">还不能确认：{gaps.join("；")}</p> : null}
        <button type="button" disabled={busy || gaps.length > 0} onClick={confirm} className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-card bg-accent font-bold text-accent-fg disabled:opacity-40">{busy ? <LoaderCircle className="size-5 animate-spin" /> : <Check className="size-5" />}确认这份实际记录并分析</button>
      </> : null}

      {step === "result" ? <>
        <div className="mb-3 rounded-card border border-line bg-surface p-4"><h3 className="font-bold">训练记录已确认</h3><p className="mt-1 text-sm text-muted">下面可以查看复盘和恢复反馈，不需要再次确认同一份记录。</p><button type="button" onClick={() => { setStep("input"); setDraft(null); setConfirmedRecord(null); setReview(null); setMessage("") }} className="mt-3 min-h-11 rounded-card border border-line px-4 text-sm font-bold">录入另一节训练</button></div>
        <p className="mb-3 text-xs text-muted">即时判断和连续观察是透明的规则计算，不是模型回答；下面的模型复盘仅在完整返回并通过来源校验后显示。</p>
        <div className="rounded-card border border-line bg-surface p-4"><h3 className="font-bold">已确认，仍与原课表分开</h3><p className="mt-1 text-sm text-muted">这是 ACTUAL_ONLY 导入记录，没有可靠 trainingOccurrenceId，因此没有绑定到既有训练证据链。</p></div>
        {coachAssessment ? <section className="mt-3 rounded-card border border-line bg-surface p-3"><div className="flex items-center justify-between gap-3"><h3 className="font-bold">即时教练判断</h3><span className="rounded-full bg-surface-2 px-2 py-1 text-xs text-muted">{coachAssessment.status === "NEEDS_INPUT" ? "需要补充" : coachAssessment.status === "HOLD_OR_REDUCE" ? "保持或减量" : "只做复盘"}</span></div><div className="mt-2"><EvidenceLine item={coachAssessment.nextSession} sources={sourceMap} /></div><p className="mt-2 text-xs text-muted">单次训练不判定长期能力；没有原计划，因此不比较“是否完成计划”。</p>{coachAssessment.facts.length ? <div className="mt-3 space-y-2"><h4 className="text-sm font-bold">已确认事实</h4>{coachAssessment.facts.map((item, index) => <EvidenceLine key={`${item.text}-${index}`} item={item} sources={sourceMap} />)}</div> : null}{coachAssessment.observations.length ? <div className="mt-3 space-y-2"><h4 className="text-sm font-bold">本次观察</h4>{coachAssessment.observations.map((item, index) => <EvidenceLine key={`${item.text}-${index}`} item={item} sources={sourceMap} />)}</div> : null}{coachAssessment.evidenceGaps.length ? <details className="mt-3"><summary className="text-sm font-bold">证据缺口</summary><div className="mt-2 space-y-2">{coachAssessment.evidenceGaps.map((item, index) => <EvidenceLine key={`${item.text}-${index}`} item={item} sources={sourceMap} />)}</div></details> : null}</section> : null}
        {trend ? <section className="mt-3 rounded-card border border-line bg-surface p-3"><h3 className="font-bold">连续训练观察</h3><p className="mt-1 text-sm text-muted">{trend.sessionCount} 次已确认记录 · {trend.distinctDayCount} 个上海日历日</p>{trend.observations.map((item, index) => <p key={`${item.text}-${index}`} className="mt-2 text-sm">{item.text}</p>)}{trend.evidenceGaps.map((item, index) => <p key={`trend-gap-${index}`} className="mt-2 text-sm">{item.text}</p>)}<p className="mt-2 text-sm font-medium">{trend.adjustment.text}</p><p className="mt-2 text-xs text-muted">任何调整都只是候选，仍需你确认，不会自动改课表。没有可靠原计划时，计划偏差保持不可用。</p></section> : null}
        {confirmedRecord ? <ImportedRunningReadout segments={confirmedRecord.runningSegments} /> : null}
        {confirmedRecord ? <TrainingFollowupPanel key={confirmedRecord.confirmedImportId} record={confirmedRecord} disabled={busy} /> : null}
        <p className="mt-4 text-xs text-muted">模型复盘仅使用这份训练当时的已确认记录，尚不包含上面的后续恢复反馈。</p>
        {busy ? <div className="mt-4 flex items-center gap-2 text-sm text-muted"><LoaderCircle className="size-5 animate-spin" />正在生成有来源的单次训练复盘</div> : null}
        {!busy && !review && confirmedRecord && trialReviewClosed(confirmedRecord) ? <p className="mt-3 rounded-card border border-warn bg-surface p-3 text-sm">{trialReviewClosed(confirmedRecord)}</p> : null}
        {!busy && !review && confirmedRecord && !trialReviewClosed(confirmedRecord) ? <button type="button" onClick={() => requestReview(confirmedRecord)} className="mt-3 min-h-12 w-full rounded-card border border-line font-bold">请求或重试训练当时的模型复盘（不重复确认）</button> : null}
        {review ? <div className="mt-3 space-y-3"><ClaimList title="记录事实" items={review.facts} sources={sourceMap} /><ClaimList title="本次观察" items={review.observations} sources={sourceMap} /><ClaimList title="证据缺口" items={review.evidenceGaps} sources={sourceMap} /><ClaimList title="谨慎解释" items={review.interpretations} sources={sourceMap} /><ClaimList title="风险边界" items={review.risks} sources={sourceMap} />{review.nextSessionBoundary ? <ClaimList title="下一课边界" items={[review.nextSessionBoundary]} sources={sourceMap} /> : null}{review.questions.length ? <section className="rounded-card border border-line bg-surface p-3"><h3 className="font-bold">还需要你确认</h3><ul className="mt-2 list-disc pl-5 text-sm">{review.questions.map((item) => <li key={item}>{item}</li>)}</ul></section> : null}</div> : null}
      </> : null}
      <CoachKnowledgePanel mode="REVIEW" />
      {step !== "input" && message ? <p className="mt-4 rounded-card bg-surface-2 p-3 text-sm">{message}</p> : null}
    </main>
  </div>
}
