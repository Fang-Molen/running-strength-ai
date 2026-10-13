import { useEffect, useState } from "react"
import { Plus } from "lucide-react"
import { loadVitals } from "@/lib/nutrition/vitals"
import { loadExtras } from "@/lib/ui/device-store"
import { recoveryVerdict, type RecoveryInput } from "@/lib/ui/recovery-verdict"
import { SavedBadge } from "@/components/saved-badge"

const avg = (xs: number[]) => xs.length >= 3 ? xs.reduce((a, b) => a + b, 0) / xs.length : null
export function readRecoveryInput(today: string): RecoveryInput {
  const v = loadVitals().records, ex = loadExtras()
  const of = (k: string) => v.filter((r) => r.kind === k).sort((a, b) => a.observedOn.localeCompare(b.observedOn))
  const todayVal = (k: string) => of(k).filter((r) => r.observedOn === today).at(-1)?.value ?? null
  const base = (k: string) => avg(of(k).filter((r) => r.observedOn < today).slice(-7).map((r) => r.value))
  const ext = (m: string) => ex.filter((e) => e.metric === m && e.day === today).at(-1)?.value ?? null
  return { readiness: ext("READINESS"), bodyBattery: ext("BODY_BATTERY"), stress: ext("STRESS"), sleepH: todayVal("SLEEP"), sleepBase: base("SLEEP"), hrv: todayVal("HRV"), hrvBase: base("HRV"), rhr: todayVal("RHR"), rhrBase: base("RHR"), subjective: todayVal("RECOVERY") }
}

export function RecoveryVerdictCard({ today, revision, onImport }: { today: string; revision: number; onImport: () => void }) {
  const [input, setInput] = useState<RecoveryInput | null>(null)
  useEffect(() => { if (today) setInput(readRecoveryInput(today)) }, [today, revision])
  if (!input) return null
  const v = recoveryVerdict(input)
  const tone = v.level === "go" ? "border-[#269775] bg-[#269775]/10" : v.level === "reduce" ? "border-[#e0a46b] bg-[#fdf3e8] dark:bg-transparent" : v.level === "watch" ? "border-[#e0c46b] bg-[#fdf9e8] dark:bg-transparent" : "border-line bg-surface-2"
  return <section aria-label="今日恢复" className={"mb-3 rounded-card border-2 p-4 " + tone}>
    <p className="product-eyebrow">今日恢复</p>
    <h2 className="mt-1 text-xl font-bold">{v.title}</h2>
    <p className="mt-1 text-sm">{v.reasons.join(" · ")}</p>
    <p className="mt-1 text-xs text-muted">{v.note}{v.level === "unknown" ? <button type="button" className="fk-link ml-1" onClick={onImport}>导入手表数据 ›</button> : null}</p>
    <p className="mt-1 text-[10px] text-muted">阈值为本应用经验规则；手册：缺数据不推断恢复良好。</p>
  </section>
}

/** 疼痛/伤病记录：部位、0–10、日期；P-03/P-07 提示。 */
const PAIN_KEY = "fk-pain-log-v1"
type Pain = { id: string; date: string; part: string; score: number; note: string }
export function PainLog({ today }: { today: string }) {
  const [list, setList] = useState<Pain[]>([])
  const [part, setPart] = useState(""), [score, setScore] = useState(3), [stamp, setStamp] = useState(0)
  useEffect(() => { try { setList(JSON.parse(localStorage.getItem(PAIN_KEY) ?? "[]")) } catch { setList([]) } }, [])
  const save = (next: Pain[]) => { setList(next); try { localStorage.setItem(PAIN_KEY, JSON.stringify(next.slice(-200))); setStamp(Date.now()) } catch { /* ignore */ } }
  const byPart = new Map<string, Pain[]>(); for (const p of list) byPart.set(p.part, [...(byPart.get(p.part) ?? []), p])
  const long = [...byPart.entries()].filter(([, ps]) => { const ds = ps.map((p) => p.date).sort(); return (Date.parse(ds.at(-1)!) - Date.parse(ds[0])) / 864e5 >= 14 && ds.at(-1)! >= today.slice(0, 8) })
  return <section className="home-card mt-3 p-4 text-sm" aria-label="疼痛与伤病">
    <div className="flex items-center justify-between"><h2 className="text-base font-bold">疼痛 / 伤病</h2><SavedBadge stamp={stamp} /></div>
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <input value={part} onChange={(e) => setPart(e.target.value.slice(0, 12))} placeholder="部位，如 左膝外侧" className="fk-cell min-h-10 min-w-0 flex-1" aria-label="疼痛部位" />
      <label className="flex items-center gap-1 text-xs">程度<input type="range" min={0} max={10} value={score} onChange={(e) => setScore(+e.target.value)} aria-label="疼痛程度" /><b className="w-5">{score}</b></label>
      <button type="button" disabled={!part.trim()} className="fk-chip" onClick={() => { save([...list, { id: Math.random().toString(36).slice(2), date: today, part: part.trim(), score, note: "" }]); setPart("") }}><Plus className="size-3.5" />记下</button>
    </div>
    {score > 3 && part ? <p className="mt-1 text-xs text-[var(--color-risk)]">疼痛 &gt;3/10 或改变跑姿：停止引起疼痛的训练，48 小时内不做引起疼痛的动作；不缓解请就医。（手册 P-03【经验规则】）</p> : null}
    {long.map(([p]) => <p key={p} className="mt-1 rounded-lg border border-[var(--color-risk)] p-2 text-xs text-[var(--color-risk)]">「{p}」记录跨度已超过 14 天，建议找运动医学/康复专业人员检查。（手册 P-07）</p>)}
    {list.length ? <ul className="mt-2 divide-y divide-line">{[...list].reverse().slice(0, 6).map((p) => <li key={p.id} className="flex items-center justify-between py-1.5"><span>{p.date.slice(5)} · {p.part} · <b>{p.score}/10</b></span><button type="button" className="text-xs text-muted" onClick={() => save(list.filter((x) => x.id !== p.id))}>删除</button></li>)}</ul> : <p className="mt-2 text-xs text-muted">没有记录。方坤不说病名，只提示什么时候该找专业人员。</p>}
  </section>
}
