/** v89 肌肉恢复视图：肌肉状态 / 力量负荷 / 跑步影响 / 恢复趋势。
 *  沿用 U11 的已有 Écorché 3D 肌群网格和同一份恢复投影（readRecoveryProjection）。
 *  颜色只表示训练参与、负荷叠加或自报症状，不是实测疲劳百分比；“预计恢复”是一般经验范围（估算），不自动改课。 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { HeartPulse } from "lucide-react"
import { MESH_KEYS, REGION_LABEL, REGIONS, type Region, type RegionState } from "@/lib/health/muscle-recovery-u11"
import { readRecoveryProjection, recoveryLines, type RecoveryProjection } from "@/lib/health/recovery-host-u11"
import { subscribeGlobalCoach } from "@/lib/coach/global-coach-host-v89"
import "./muscle-target-card.css"
import "./recovery-trend-detail.css"
import { MuscleStimulusChartV90 } from "./muscle-stimulus-chart-v90"

type API = { setView: (v: string) => void; selectKey: (k: string | null) => void; setOverlays: (v: { keys: string[]; color: string }[]) => void; destroy: () => void }
/** 4 级图例（效果图同款层级，但措辞按证据：不是疲劳测量）。 */
export const LEVELS = [
  { id: "pain", label: "疼痛待查", color: "#e85a58", states: ["PAIN_REVIEW"] as RegionState[] },
  { id: "heavy", label: "酸痛/负荷叠加", color: "#f2803a", states: ["REPORTED_SORENESS", "OVERLAP_OBSERVED"] as RegionState[] },
  { id: "light", label: "训练参与", color: "#e9c44a", states: ["TRAINING_EXPOSURE"] as RegionState[] },
  { id: "none", label: "无近期负荷记录", color: "#8b929a", states: ["UNKNOWN"] as RegionState[] },
]
export const levelOf = (s: RegionState) => LEVELS.find(l => l.states.includes(s))!
/* 旧版按状态固定的24–72小时“预计恢复”已取消，避免伪精确。 */
const TABS = [["status", "肌肉状态"], ["strength", "力量负荷"], ["run", "跑步影响"], ["trend", "恢复趋势"]] as const

export function MuscleRecoveryV89({ day, trend, onCoach }: { day: string; trend: ReactNode; onCoach?: () => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("status")
  const [value, setValue] = useState<RecoveryProjection | null>(null)
  useEffect(() => { const refresh = () => { try { setValue(readRecoveryProjection(day)) } catch { setValue(null) } }; refresh(); return subscribeGlobalCoach(refresh) }, [day])
  return <div className="fk-m89 space-y-3" data-testid="m89" data-revision={value?.revision ?? "UNAVAILABLE"}>
    <nav className="fk-h89-tabs" aria-label="肌肉恢复分区">{TABS.map(([id, l]) => <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}>{l}</button>)}</nav>
    {!value ? <p role="status" className="text-sm">暂时无法读取恢复依据，请重试；未把读取失败当作正常。</p> : <>
      <div hidden={tab !== "status"}><MuscleStatus value={value} /></div>
      {tab === "strength" ? <Loads value={value} modality="STRENGTH" /> : null}
      {tab === "run" ? <Loads value={value} modality="RUN" /> : null}
      {tab === "trend" ? trend : null}
      <Advice value={value} onCoach={onCoach} />
    </>}
  </div>
}

function lastLoadHours(v: RecoveryProjection, r: RecoveryProjection["review"]["regions"][number]) {
  const ids = [...r.runEventIds, ...r.strengthEventIds, ...r.symptomEventIds]
  const ts = ids.map(id => v.sources.find(s => s.id === id)?.occurredAt).filter((x): x is string => !!x).map(Date.parse).filter(Number.isFinite)
  return ts.length ? Math.max(0, Math.round((Date.now() - Math.max(...ts)) / 3600e3)) : null
}

function MuscleStatus({ value }: { value: RecoveryProjection }) {
  const canvas = useRef<HTMLCanvasElement>(null), api = useRef<API | null>(null)
  const [ready, setReady] = useState(false), [error, setError] = useState(""), [retry, setRetry] = useState(0)
  const [side, setSide] = useState("front"), [selected, setSelected] = useState<Region | null>(null)
  const overlays = useMemo(() => value.review.regions.filter(r => r.state !== "UNKNOWN").map(r => ({ keys: MESH_KEYS[r.region], color: levelOf(r.state).color })), [value.revision]) // eslint-disable-line react-hooks/exhaustive-deps
  const latest = useRef(overlays); latest.current = overlays
  useEffect(() => {
    let dead = false, instance: API | null = null
    setReady(false); setError(""); setSide("front")
    const timer = setTimeout(() => { if (!dead && !instance) setError("模型加载较慢；下方仍可查看肌群依据。") }, 45000)
    import(/* @vite-ignore */ new URL("/demo3d/anatomy3d.js", window.location.origin).href).then(async m => {
      if (dead || !canvas.current) return
      const options = (asset: "r9" | "ecorche") => ({ asset, overlays: latest.current, onPick: (p: { k: string; g?: string | null } | null) => { if (dead) return; setSelected(p ? REGIONS.find(r => MESH_KEYS[r].includes(p.k) || r === p.g) ?? null : null) } })
      // v89.5：默认 R9 友好肌群（1.9 MB）；加载失败退回原 Écorché（6.0 MB），再失败退回下方文字/卡片依据。
      instance = await m.createMuscleExplorer(canvas.current, options("r9")).catch(() => dead || !canvas.current ? null : m.createMuscleExplorer(canvas.current, options("ecorche"))) as API | null
      if (!instance) return
      if (dead) { instance.destroy(); return }
      api.current = instance; instance.setOverlays(latest.current); setReady(true); setError(""); clearTimeout(timer)
    }).catch(() => { if (!dead) setError("3D 模型暂时无法加载；下方仍可查看真实记录依据。") })
    return () => { dead = true; clearTimeout(timer); instance?.destroy(); api.current = null }
  }, [retry])
  useEffect(() => { api.current?.setOverlays(overlays) }, [overlays])
  const observed = value.review.regions.filter(r => r.state !== "UNKNOWN").sort((a, b) => LEVELS.indexOf(levelOf(a.state)) - LEVELS.indexOf(levelOf(b.state)))
  const row = selected ? value.review.regions.find(r => r.region === selected) : null
  return <section aria-label="肌肉状态" className="space-y-3">
    <div className="fk-m89-stage">
      <div className="fk-target-stage"><canvas ref={canvas} aria-label="可旋转点选的3D肌群" data-ready={ready} />
        {!ready ? <div className="fk-target-status" role="status"><p>{error || "正在打开肌群模型…"}</p>{error ? <button type="button" onClick={() => setRetry(n => n + 1)}>重新加载</button> : null}</div> : null}
      </div>
      <div className="fk-m89-side" role="group" aria-label="视角">{[["front", "正面"], ["back", "背面"]].map(([id, t]) => <button key={id} type="button" disabled={!ready} aria-pressed={side === id} onClick={() => { setSide(id); api.current?.setView(id) }}>{t}</button>)}</div>
      <div className="fk-m89-legend" aria-label="图例"><b>训练反应</b>{LEVELS.map(l => <span key={l.id}><i style={{ background: l.color }} />{l.label}</span>)}</div>
    </div>
    <p className="keep text-xs text-muted">颜色只表示近 72 小时已确认训练涉及的区域或你自报的症状，不是肌肉疲劳百分比。拖动旋转，点肌肉看依据。</p>
    <div><b>重点肌群</b>
      {observed.length ? <div className="mt-2 grid grid-cols-2 gap-2" data-testid="m89-cards">{observed.map(r => { const l = levelOf(r.state), h = lastLoadHours(value, r)
        const src = [...r.strengthEventIds.length ? ["力量"] : [], ...r.runEventIds.length ? ["跑步"] : [], ...r.symptomEventIds.length ? ["自报症状"] : []].join(" + ")
        return <button key={r.region} type="button" className="fk-m89-card text-left" aria-pressed={selected === r.region} onClick={() => { api.current?.selectKey(MESH_KEYS[r.region][0]); setSelected(r.region) }}>
          <span className="flex items-center gap-1.5"><b className="text-sm">{REGION_LABEL[r.region]}</b><span className="fk-m89-chip ml-auto" style={{ color: l.color, borderColor: l.color }}>{r.state === "PAIN_REVIEW" && r.notes.some(n => /缺少近期复核/.test(n)) ? "疼痛待复核" : l.label}</span></span>
          <span className="mt-1 block text-[11px] text-muted">负荷来源</span><span className="block text-xs">{src || "—"}{h != null ? ` · ${h} 小时前` : ""}</span>
          <span className="mt-1 block text-xs text-muted">点选查看真实依据及未校准刺激情景</span>
        </button> })}</div>
        : <p className="mt-1 text-sm text-muted">暂无：近 72 小时没有可判断到具体肌群的已确认训练或局部反馈。未记录不等于已恢复。</p>}
    </div>
    {(selected ?? observed[0]?.region) ? <MuscleStimulusChartV90 value={value} region={(selected ?? observed[0].region)} /> : null}
    {row ? <div className="fk-m89-evidence" aria-live="polite" data-testid="u11-muscle-evidence"><b>{REGION_LABEL[row.region]} · {levelOf(row.state).label}</b>
      {row.state === "UNKNOWN" ? <p>没有足够的已确认动作或局部反馈。</p> : null}
      {[...row.strengthEventIds, ...row.runEventIds, ...row.symptomEventIds].map(id => { const s = value.sources.find(x => x.id === id); return <p key={id} className="mt-1 text-sm">{s?.label ?? "训练来源"}：{s?.detail ?? "来源待核对"}{s?.occurredAt ? ` · ${new Date(s.occurredAt).toLocaleString("zh-CN", { hour12: false })}` : ""}</p> })}
      {row.notes.map(n => <p key={n} className="mt-1 text-xs text-muted">{n}</p>)}</div> : null}
    <p className="keep text-xs text-muted">模拟曲线不表示真实肌肉疲劳或恢复百分比；只有实际完成的训练可用于刺激情景，疼痛需独立核对。</p>
    {value.review.gaps.length ? <details className="fk-m89-limits"><summary>缺失与待核对（{value.review.gaps.length}）</summary>{value.review.gaps.map(g => <p key={g}>{g}</p>)}</details> : null}
    <details className="fk-m89-limits"><summary>模型与解释边界</summary><p>肌群模型：R9 友好肌群（由 Écorché / BodyParts3D / Z-Anatomy 派生，CC BY-SA 4.0）；加载失败时退回原 Écorché。足部为外形示意，不是肌肉网格。颜色只来自已确认训练记录与自报症状，区域映射为待复核的解释资料。</p><a href="/demo3d/anatomy/ATTRIBUTION.md" target="_blank" rel="noreferrer">模型来源与授权</a></details>
  </section>
}

function Loads({ value, modality }: { value: RecoveryProjection; modality: "STRENGTH" | "RUN" }) {
  const rows = value.sources.filter(s => s.id.endsWith(`|${modality}`)).sort((a, b) => (b.occurredAt ?? "").localeCompare(a.occurredAt ?? ""))
  const regions = value.review.regions.filter(r => (modality === "RUN" ? r.runEventIds : r.strengthEventIds).length)
  const all = value.review.gaps.filter(g => modality === "RUN" ? /跑步/.test(g) : /力量|动作|组次|组记录/.test(g))
  // v89.2：未关联的手表跑步 / 只有摘要的手表力量 = 一句短说明直接显示；其余放进“未纳入的记录”
  const short = all.filter(g => /^\d+ 条手表/.test(g)), gaps = all.filter(g => !short.includes(g))
  return <section className="space-y-2" aria-label={modality === "RUN" ? "跑步影响" : "力量负荷"}>
    <b>{modality === "RUN" ? "近 72 小时跑步" : "近 72 小时力量（按实际完成组）"}</b>
    {rows.length ? rows.map(s => <div key={s.id} className="fk-m89-card"><p className="text-sm font-bold">{s.label}{s.actualSets != null ? ` · 实际 ${s.actualSets} 组` : ""}</p><p className="text-sm">{s.detail}</p><p className="keep text-[11px] text-muted">{s.occurredAt ? new Date(s.occurredAt).toLocaleString("zh-CN", { hour12: false }) : "时间未知"}</p></div>)
      : <p className="text-sm text-muted">暂无{modality === "RUN" ? "可判断肌群的已确认跑步" : "已确认的逐组力量记录"}。</p>}
    {regions.length ? <p className="text-sm">涉及：{regions.map(r => REGION_LABEL[r.region]).join("、")}</p> : null}
    {short.map(g => <p key={g} className="keep text-xs text-muted" data-testid="m89-watch-note">{g}</p>)}
    {gaps.length ? <details className="fk-m89-limits"><summary>未纳入的记录（{gaps.length}）</summary>{gaps.map(g => <p key={g}>{g}</p>)}</details> : null}
  </section>
}

function Advice({ value, onCoach }: { value: RecoveryProjection; onCoach?: () => void }) {
  const [portraitError, setPortraitError] = useState(false)
  const l = recoveryLines(value)
  // Only shorten the initial reading; the original projection text remains available in full below.
  const summary = l.summary.split(/[（，。]/)[0] || l.summary
  const next = l.next.split("；")[0]
  const painRegions = value.review.regions.filter(r => r.state === "PAIN_REVIEW")
  const reminders = [...new Set([
    ...l.groups.filter(line => line.includes("自报疼痛")),
    ...l.gaps.filter(line => /疼痛|症状|复核/.test(line)),
    ...painRegions.flatMap(r => r.notes.filter(note => /复核/.test(note)).map(note => `${REGION_LABEL[r.region]}：${note}`)),
  ])]
  return <section className="fk-h89-card fk-recovery-advice" aria-label="方坤分析与建议">
    <div className="fk-recovery-advice-heading"><span className="fk-recovery-advice-portrait" aria-hidden="true">{portraitError ? <HeartPulse data-testid="m89-advice-portrait-fallback" /> : <img src="/fangshen/care-bust.png" alt="" onError={() => setPortraitError(true)} />}</span><b>方坤分析与建议</b>{onCoach ? <button type="button" className="fk-recovery-advice-coach" onClick={onCoach}>问方坤 ›</button> : null}</div>
    <p className="keep fk-recovery-advice-summary">{summary}。</p>
    <p className="keep fk-recovery-advice-next">{next}。</p>
    {reminders.length ? <div className="fk-recovery-advice-reminders" data-testid="m89-pain-reminders">
      <b>{painRegions.length ? "疼痛待核对" : "反馈待核对"}</b>
      {reminders.map(line => <p key={line} className="keep">{line}</p>)}
      {painRegions.length ? <p className="keep">疼痛按最近一次反馈，未复核不自动解除。</p> : null}
    </div> : null}
    <details className="fk-recovery-disclosure" data-testid="m89-advice-details">
      <summary>依据与说明</summary>
      <div className="fk-recovery-disclosure-body fk-recovery-advice-evidence">
        <div><h3>判断摘要</h3><p className="keep">{l.summary}</p></div>
        {l.groups.length ? <div><h3>肌群分组</h3><ul>{l.groups.map(line => <li key={line} className="keep">{line}</li>)}</ul></div> : null}
        {l.evidence.length ? <div><h3>记录依据</h3><ul>{l.evidence.map(line => <li key={line} className="keep">{line}</li>)}</ul></div> : null}
        {l.gaps.length ? <div><h3>资料缺口与说明</h3><ul>{l.gaps.map(line => <li key={line} className="keep">{line}</li>)}</ul></div> : null}
        <div><h3>下一步</h3><p className="keep">{l.next}</p></div>
        <p className="keep">本地规则整理，不调用模型；不是诊断，也不自动改课。</p>
      </div>
    </details>
  </section>
}
