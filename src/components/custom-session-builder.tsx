import { useState } from "react";
import type { Intensity, ScheduleEntry } from "@/lib/ui/day-schedule-rules";
import { ExerciseEditor, PartChips, type Ex } from "@/components/exercise-editor";
import { planDays } from "@/lib/plan/active-plan";

const TYPES = [["run", "跑步"], ["strength", "力量"], ["mixed", "混合"], ["other", "其他"]] as const;
const RUN_SUB: [string, Intensity][] = [["轻松跑", "EASY"], ["间歇", "HARD"], ["节奏跑", "MODERATE"], ["加速跑", "MODERATE"], ["技术", "EASY"], ["测试", "HARD"]];
const OTHER_SUB: [string, Intensity][] = [["有氧", "EASY"], ["恢复", "EASY"], ["活动度", "EASY"]];

const isFormal = (t: string) => !/恢复|休息|活动度/.test(t);

export function CustomSessionBuilder({ day, onAdd }: { day: string; onAdd: (e: ScheduleEntry) => void }) {
  const [type, setType] = useState<(typeof TYPES)[number][0] | null>(null);
  const [sub, setSub] = useState<string>(""); const [parts, setParts] = useState<string[]>([]);
  const [dist, setDist] = useState(""); const [reps, setReps] = useState(""); const [exs, setExs] = useState<Ex[]>([]); const [between, setBetween] = useState<number | null>(null);
  const [minutes, setMinutes] = useState("40"); const [slot, setSlot] = useState<"am" | "pm">("pm"); const [hard, setHard] = useState<Intensity>("MODERATE");
  const p400 = planDays().find((d) => d.date === day);
  const intensity: Intensity = type === "run" ? (RUN_SUB.find((x) => x[0] === sub)?.[1] ?? "EASY") : type === "other" ? "EASY" : hard;
  const lowerHeavy = (type === "strength" || type === "mixed") && parts.some((x) => ["下肢", "后链", "全身", "快速力量"].includes(x)) && intensity !== "EASY";
  const conflict = p400 && isFormal(p400.title) && (intensity === "HARD" || lowerHeavy);
  function add() {
    if (!type) return;
    const title = type === "run" ? `${sub || "跑步"}${dist ? ` ${dist}` : ""}${reps ? ` ×${reps}` : ""}` : type === "strength" ? `力量 · ${parts.join("+") || "自选"}` : type === "mixed" ? `混合 · ${sub || "跑步"}+${parts.join("+") || "力量"}` : sub || "有氧";
    const focus = [...(type === "run" || type === "mixed" ? [sub].filter(Boolean) : []), ...parts, ...exs.map((e) => e.name)];
    onAdd({ id: `custom:${day}:${Math.random().toString(36).slice(2, 7)}`, date: day, kind: type === "strength" ? "strength" : "run", modality: type === "strength" || type === "mixed" ? "strength" : "run", title, focus, minutes: Number(minutes) || 30, intensity, lowerHeavy, source: "custom", refId: null, status: "planned", slot, exercises: exs.length ? exs : undefined, betweenRestSec: exs.length ? between : undefined, km: type === "run" && /km/i.test(dist) ? parseFloat(dist) : undefined });
  }
  return <div className="mt-2 space-y-2 rounded-card border border-line p-3 text-sm">
    <div className="flex flex-wrap gap-2">{TYPES.map(([v, t]) => <button key={v} type="button" aria-pressed={type === v} className="fk-chip" onClick={() => { setType(v); setSub(""); setParts([]); }}>{t}</button>)}</div>
    {type === "run" || type === "mixed" ? <div className="flex flex-wrap gap-2">{RUN_SUB.map(([t]) => <button key={t} type="button" aria-pressed={sub === t} className="fk-chip" onClick={() => setSub(t)}>{t}</button>)}</div> : null}
    {type === "other" ? <div className="flex flex-wrap gap-2">{OTHER_SUB.map(([t]) => <button key={t} type="button" aria-pressed={sub === t} className="fk-chip" onClick={() => setSub(t)}>{t}</button>)}</div> : null}
    {type === "run" ? <div className="grid grid-cols-2 gap-2"><input className="min-h-10 rounded-card border border-line bg-surface px-2" placeholder="距离 如 200m / 5km" value={dist} onChange={(e) => setDist(e.target.value)} /><input className="min-h-10 rounded-card border border-line bg-surface px-2" inputMode="numeric" placeholder="组数" value={reps} onChange={(e) => setReps(e.target.value)} /></div> : null}
    {type === "strength" || type === "mixed" ? <>
      <PartChips value={parts} onChange={setParts} />
      <ExerciseEditor value={exs} onChange={setExs} parts={parts} betweenRest={between} onBetweenRest={setBetween} />
      <div className="flex gap-2">{(["EASY", "MODERATE", "HARD"] as Intensity[]).map((v) => <button key={v} type="button" aria-pressed={hard === v} className="fk-chip" onClick={() => setHard(v)}>{v === "EASY" ? "轻" : v === "MODERATE" ? "中" : "重"}</button>)}</div>
    </> : null}
    {type ? <div className="flex items-center gap-2">
      <button type="button" aria-pressed={slot === "am"} className="fk-chip" onClick={() => setSlot("am")}>上午</button><button type="button" aria-pressed={slot === "pm"} className="fk-chip" onClick={() => setSlot("pm")}>下午/晚上</button>
      <input className="min-h-10 w-20 rounded-card border border-line bg-surface px-2" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} /><span>分钟</span>
    </div> : null}
    {p400 ? <p className={conflict ? "font-bold text-amber-700" : "text-muted"}>{conflict ? "⚠ 与当天 400m 计划冲突：" : "当天 400m 计划："}{p400.title}</p> : null}
    {type ? <button type="button" className="min-h-11 w-full rounded-card bg-accent font-bold text-accent-fg" onClick={add}>加入这一天</button> : null}
  </div>;
}
