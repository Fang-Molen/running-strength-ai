import { useState } from "react";
import { ExerciseEditor, PartChips, doseOf, UNIT_LABEL, type Ex } from "@/components/exercise-editor";
import plan from "../lib/plan400-v4.json" with { type: "json" };

type Day = { orig: string; date: string; weekday: string; week: string; title: string; main: string[]; aux: string[]; strength: string[] };
type Log = { done?: string; reps?: string; rest?: string; aux?: string; strength?: string; rpe?: string; pain?: string; r24?: string; r48?: string; note?: string; savedAt?: string };
const KEY = "fk-plan400-v4-log";
const days = plan.days as Day[];
const OKEY = "fk-plan400-v4-overrides";
type Override = { parts: string[]; exercises: Ex[]; savedAt: string };
const loadO = (): Record<string, Override> => { try { return JSON.parse(localStorage.getItem(OKEY) || "{}"); } catch { return {}; } };
export function parseStrength(text: string): Ex[] {
  const body = text.replace(/^[A-Z]\d?：/, "").replace(/；?RPE[^、]*$/, "");
  const out: Ex[] = [];
  for (const m of body.matchAll(/([^、；：\d]+?)\s*(\d+(?:—\d+)?)×(\d+(?:—\d+)?(?:秒|次|触地)?(?:\/(?:腿|侧))?)/g)) { const name = m[1].trim(); const raw = m[3]; const d = doseOf(name); const unit = /秒/.test(raw) ? "sec" : d.unit; out.push({ name, sets: m[2], reps: raw.replace(/秒|次|触地|\/(腿|侧)/g, ""), weight: "", rpe: "", unit, perSide: /\/(腿|侧)/.test(raw) || d.perSide }); }
  return out;
}
function StrengthOverride({ d }: { d: Day }) {
  const [o, setO] = useState<Override | null>(() => loadO()[d.date] ?? null);
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState<Override>(() => o ?? { parts: [], exercises: [], savedAt: "" });
  const text = d.strength.join("");
  if (/^无|^可做|^仅活动度/.test(text) && !o) return null;
  const save = (n: Override | null) => { const all = loadO(); if (n) all[d.date] = n; else delete all[d.date]; localStorage.setItem(OKEY, JSON.stringify(all)); setO(n); setEdit(false); };
  return <div className="mt-2 rounded-card border border-line p-2">
    {o && !edit ? <><p className="font-bold">我的力量安排</p><ul className="text-sm">{o.exercises.map((e, i) => <li key={i}>{e.name} {e.sets}×{e.reps}{UNIT_LABEL[e.unit ?? doseOf(e.name).unit]}{(e.perSide ?? doseOf(e.name).perSide) ? "/每侧" : ""}{e.weight ? ` @${e.weight}kg` : ""}{e.rpe ? ` RPE${e.rpe}` : ""}</li>)}</ul></> : null}
    {edit ? <div className="space-y-2"><PartChips value={draft.parts} onChange={(parts) => setDraft({ ...draft, parts })} /><ExerciseEditor value={draft.exercises} onChange={(exercises) => setDraft({ ...draft, exercises })} parts={draft.parts} />
      <div className="flex gap-2"><button type="button" className="min-h-10 flex-1 rounded-card bg-accent font-bold text-accent-fg" onClick={() => save({ ...draft, savedAt: new Date().toISOString() })}>保存我的安排</button><button type="button" className="min-h-10 rounded-card border border-line px-3" onClick={() => setEdit(false)}>取消</button></div></div>
      : <div className="mt-1 flex gap-2"><button type="button" className="min-h-10 flex-1 rounded-card border border-line" onClick={() => { setDraft(o ?? { parts: [], exercises: parseStrength(text), savedAt: "" }); setEdit(true); }}>{o ? "修改力量" : "编辑力量动作"}</button>{o ? <button type="button" className="min-h-10 rounded-card border border-line px-3" onClick={() => save(null)}>恢复原计划</button> : null}</div>}
  </div>;
}
const load = (): Record<string, Log> => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } };
const bj = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
const FIELDS: [keyof Log, string, string][] = [
  ["reps", "正式主课实际分段", "如 150m: 21.3 / 21.0 / 21.6"], ["rest", "实际组间休息", "如 7分 / 8分"], ["aux", "辅助段（单独记录）", "如 60m渐进×3 完成"],
  ["strength", "力量实际 组×重量×次数", "如 分腿蹲 2×20kg×5/腿"], ["rpe", "整课RPE (1-10)", "7"], ["pain", "疼痛部位/程度 (0-10)", "无 / 跟腱 2"],
  ["r24", "24小时后：睡眠·恢复1-10·酸痛·腿沉", "6.5h · 7 · 小腿酸"], ["r48", "48-72小时后：恢复·热身轻快程度", "恢复好 · 轻快"], ["note", "备注 / 天气 / 场地", ""],
];
function DayCard({ d, log, onSave, open }: { d: Day; log: Log; onSave: (l: Log) => void; open?: boolean }) {
  const [edit, setEdit] = useState<Log>(log);
  const status = log.done === "done" ? "✅" : log.done === "reduced" ? "🟡" : log.done === "skipped" ? "⏭" : "";
  return <details open={open} className="rounded-card border border-line bg-surface p-3">
    <summary className="flex min-h-11 cursor-pointer items-center gap-2"><span className="w-20 shrink-0 font-bold">{md(d.date)} {d.weekday}</span><span className="flex-1">{d.title}</span><span>{status}</span></summary>
    
    <div className="mt-2 space-y-1 text-sm"><p className="font-bold">正式主课 / 恢复课</p>{d.main.slice(1).map((t, i) => <p key={i}>{t}</p>)}
      <p className="pt-1 font-bold">辅助激活与技术</p><p>{d.aux.join("")}</p><p className="pt-1 font-bold">力量与核心</p><p>{d.strength.join("")}</p><StrengthOverride d={d} /></div>
    <div className="mt-3 space-y-2 border-t border-line pt-3 text-sm">
      <div className="flex gap-2">{[["done", "完成"], ["reduced", "减量"], ["skipped", "取消"]].map(([v, t]) => <button key={v} type="button" className={"min-h-10 flex-1 rounded-card border border-line " + (edit.done === v ? "bg-accent text-accent-fg" : "")} onClick={() => setEdit({ ...edit, done: v })}>{t}</button>)}</div>
      {FIELDS.map(([k, label, ph]) => <label key={k} className="block"><span className="text-xs text-muted">{label}</span><input className="min-h-10 w-full rounded-card border border-line bg-surface px-2" placeholder={ph} value={edit[k] ?? ""} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} /></label>)}
      <button type="button" className="min-h-11 w-full rounded-card bg-accent font-bold text-accent-fg" onClick={() => onSave({ ...edit, savedAt: new Date().toISOString() })}>保存记录</button>
      {log.savedAt ? <p className="keep text-xs text-muted">已保存 {log.savedAt.slice(0, 16).replace("T", " ")}</p> : null}
    </div>
  </details>;
}
export function Plan400Today() {
  const [logs, setLogs] = useState(load); const t = bj(); const d = days.find((x) => x.date === t);
  const save = (date: string, l: Log) => { const n = { ...load(), [date]: l }; localStorage.setItem(KEY, JSON.stringify(n)); setLogs(n); };
  if (!d) { const next = days.find((x) => x.date > t); return next ? <div className="home-card mb-3 p-3 text-sm">400m计划：第1天 {md(next.date)} {next.weekday}「{next.title}」</div> : null; }
  return <div className="mb-3"><p className="mb-1 text-sm font-bold">今日 400m 计划课</p><DayCard d={d} log={logs[d.date] ?? {}} open onSave={(l) => save(d.date, l)} /></div>;
}
export function Plan400() {
  const [logs, setLogs] = useState(load); const t = bj();
  const save = (date: string, l: Log) => { const n = { ...load(), [date]: l }; localStorage.setItem(KEY, JSON.stringify(n)); setLogs(n); };
  const weeks = plan.weeks as { week: string; title: string; range: string; principle: string }[];
  return <section className="home-card mb-3 space-y-2 p-4" aria-label="400米计划">
    <h2 className="font-bold">{plan.name}</h2>
    
    {weeks.map((w) => { const ds = days.filter((d) => d.week === w.week); return <details key={w.week} open={ds.some((d) => d.date >= t && d.date <= new Date(Date.now() + 8 * 3600e3 + 6 * 86400e3).toISOString().slice(0, 10))} className="rounded-card border border-line p-2">
      <summary className="min-h-11 cursor-pointer font-bold">{w.week}｜{w.title}｜{md(ds[0].date)}—{md(ds[ds.length - 1].date)}</summary>
      <p className="keep mb-2 text-xs text-muted">{w.principle}</p><div className="space-y-2">{ds.map((d) => <DayCard key={d.date} d={d} log={logs[d.date] ?? {}} onSave={(l) => save(d.date, l)} />)}</div></details>; })}
    {days.filter((d) => d.week === "TEST").map((d) => <DayCard key={d.date} d={{ ...d, main: ["", ...d.main] }} log={logs[d.date] ?? {}} onSave={(l) => save(d.date, l)} />)}
  </section>;
}
