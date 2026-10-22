/** v89.6：首次引导第 0 步“关于你”。全部选填、只存本机；不内置任何人的资料。 */
import { loadProfile, saveProfile } from "@/lib/strength/profile"
import type { Goal } from "@/lib/ui/first-run"

export const ATHLETE_CARD_KEY = "fk-athlete-card-v1"
export type AboutMe = { nickname: string; sex: "" | "female" | "male"; birthYear: string; event: string; pb: string }
export const EMPTY_ME: AboutMe = { nickname: "", sex: "", birthYear: "", event: "", pb: "" }
export const EVENTS: [string, string, number | null][] = [["400", "400米", 400], ["800", "800米", 800], ["1500", "1500米", 1500], ["5k", "5公里", 5000], ["10k", "10公里", 10000], ["half", "半马", 21097], ["fitness", "没有专项 / 综合体能", null]]
export const eventMeters = (e: string) => EVENTS.find(x => x[0] === e)?.[2] ?? null
export function goalsForEvent(event: string, goals: Goal[]): Goal[] {
  if (!event) return goals
  if (event === "fitness") return ["fitness"]
  return event === "half" ? ["race"] : ["speed"]
}
const yearOk = (y: string) => /^\d{4}$/.test(y) && Number(y) >= 1920 && Number(y) <= new Date().getFullYear() - 5
/** 写入本机：昵称等进 fk-athlete-card-v1；性别/年龄/每周天数/专项成绩进原资料键（只填用户这次填写的项）。 */
export function saveAboutMe(me: AboutMe, weeklyDays: number) {
  try {
    localStorage.setItem(ATHLETE_CARD_KEY, JSON.stringify({ nickname: me.nickname.trim().slice(0, 20), sex: me.sex, birthYear: yearOk(me.birthYear) ? me.birthYear : "", event: me.event, pb: me.pb.trim().slice(0, 20), at: new Date().toISOString() }))
    const p = loadProfile(), meters = eventMeters(me.event)
    const marks = p.marks.map(m => ({ ...m }))
    if (meters && me.pb.trim()) { const m = marks.find(x => x.meters === meters); if (m) { if (!m.recent.trim()) m.recent = me.pb.trim() } else marks.unshift({ meters, goal: "", recent: me.pb.trim(), deadline: "" }) }
    saveProfile({ ...p, sex: me.sex || p.sex, age: yearOk(me.birthYear) && !p.age ? String(new Date().getFullYear() - Number(me.birthYear)) : p.age, days: Math.min(6, Math.max(1, weeklyDays || p.days)), marks })
  } catch { /* 存储不可用：引导照常结束，资料可稍后在个人情况里填 */ }
}
export function AboutStep({ me, onChange }: { me: AboutMe; onChange: (m: AboutMe) => void }) {
  const set = (p: Partial<AboutMe>) => onChange({ ...me, ...p })
  const field = "fk-cell w-full min-h-11"
  return <div className="space-y-3" data-testid="onboard-about">
    <label className="block text-sm font-bold">名字或昵称<input className={field} aria-label="名字或昵称" value={me.nickname} maxLength={20} placeholder="朋友怎么称呼你" onChange={e => set({ nickname: e.target.value })} /></label>
    <div><p className="text-sm font-bold">性别</p><div className="mt-1 grid grid-cols-2 gap-1.5">{([["female", "女"], ["male", "男"]] as const).map(([id, l]) => <button key={id} type="button" className="fk-chip justify-center min-h-11" aria-pressed={me.sex === id} onClick={() => set({ sex: me.sex === id ? "" : id })}>{l}</button>)}</div></div>
    <label className="block text-sm font-bold">出生年份<input className={field} aria-label="出生年份" inputMode="numeric" value={me.birthYear} maxLength={4} placeholder="例如 2000" onChange={e => set({ birthYear: e.target.value.replace(/\D/g, "") })} /></label>
    <div><p className="text-sm font-bold">主项或目标</p><div className="mt-1 flex flex-wrap gap-1.5">{EVENTS.map(([id, l]) => <button key={id} type="button" className="fk-chip min-h-10" aria-pressed={me.event === id} onClick={() => set({ event: me.event === id ? "" : id })}>{l}</button>)}</div></div>
    {eventMeters(me.event) ? <label className="block text-sm font-bold">这个项目的最好成绩（PB，选填）<input className={field} aria-label="PB" value={me.pb} maxLength={20} placeholder="例如 58秒、2分20、25分" onChange={e => set({ pb: e.target.value })} /></label> : null}
    <p className="keep text-sm text-muted">没有成绩也可以继续。下一步可连接手表或运动软件，也可以稍后在设置里连接。</p>
  </div>
}
