import { stampCN } from "@/lib/ui/activity-format";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, TriangleAlert, X } from "lucide-react";
import { ExerciseEditor, PartChips, doseOf, UNIT_LABEL, type Ex } from "@/components/exercise-editor";
import { fmtRest } from "@/lib/strength/rest";
import { plan400TodayEntry, parseV4StrengthText } from "@/lib/ui/plan400-start";
import { loadSchedule, saveScheduledEntry } from "@/lib/ui/day-schedule";
import { listTrainingOccurrences } from "@/lib/core/occurrence";
import { scheduleExecutionId } from "@/lib/ui/scheduled-execution";
import { discardGuided, guidedLive, latestOccurrence } from "@/lib/ui/guided-discard";
import { KIND_LABEL, STATUS_LABEL, currentWeek, dateConflicts, dayKind, dayOf, entryLink, dayStatus, hasStrength, joinLines, primaryCta, progressCounts, shiftSummary, loadDateConfirm, saveDateConfirm, clearDateConfirm, migrateUserConfirmedDates, shiftedText, DATE_CONFIRM_KEY, strengthEntryId, weekDays, type DayStatus, type V4Day, type V4Log, type V4Plan } from "@/lib/ui/plan400-view";
import { comboView, deviceRunFacts, deviceRunsOn, recoveryTiming, sharedSleepFor, type ComboView, type ComponentState, type DeviceRun } from "@/lib/ui/plan400-components";
import { loadTrainingActivities } from "@/lib/ui/training-read-model";
import { matchLaps, plannedRepsFromText } from "@/lib/ui/lap-structure";
import { fillFromTarget, lastSplitTarget, splitsFromText, splitsToText, targetSecFromText } from "@/lib/ui/split-fill";
import { cachedLaps } from "@/lib/coach/online-coach";
import { RunLinkPanel, PartFeedbackForm, RecoveryParts, useParts, useV4RunLink, usePartsAll, PendingFeedbackList } from "@/components/plan400-parts";
import type { DayParts } from "@/lib/ui/plan400-view";
import { loadVitals } from "@/lib/nutrition/vitals";
import { currentAthleteId } from "@/lib/core/events";
import planJson from "../lib/plan400-v4.json" with { type: "json" };

/* 原课表只读：plan400-v4.json 永不写回。执行记录沿用原 key 与字段（fk-plan400-v4-log / fk-plan400-v4-overrides），无 schema 变化。 */
const plan = planJson as V4Plan;
const days = plan.days;
type Log = V4Log;
const KEY = "fk-plan400-v4-log";
const OKEY = "fk-plan400-v4-overrides";
const EVT = "fk-plan400-changed";
const OPEN_EVT = "fk-open-plan400-day";
type Override = { parts: string[]; exercises: Ex[]; savedAt: string; betweenRestSec?: number | null };
type Tab = "plan" | "during" | "after" | "later";
const loadO = (): Record<string, Override> => { try { return JSON.parse(localStorage.getItem(OKEY) || "{}"); } catch { return {}; } };
/** v81：今天的 V4 课 → 确保有一条可执行条目（同一 id，已存在且结构一致就原样用；已开始/已有结果的不改结构）。返回条目 id；解析不出返回 null。 */
export async function ensurePlan400Entry(date: string): Promise<{ id: string | null; reason?: string }> {
  const d = dayOf(plan, date); if (!d || dayKind(d) === "rest") return { id: null };
  const want = plan400TodayEntry(d, loadO()[date] ?? null, doseOf); if (!want) return { id: null };
  const old = loadSchedule().entries.find((e) => e.id === want.id);
  const live = listTrainingOccurrences().some((o) => o.lifecycle === "IN_PROGRESS" && o.sessionId.startsWith(`scheduled:${want.id}:`));
  if (old && (live || old.actual || (JSON.stringify(old.exercises) === JSON.stringify(want.exercises) && JSON.stringify(old.runComponents ?? null) === JSON.stringify(want.runComponents ?? null) && old.betweenRestSec === want.betweenRestSec))) return { id: old.id };
  const r = await saveScheduledEntry(old ? { ...want, status: old.status === "done" ? "done" : want.status } : want, old);
  return r.ok ? { id: want.id } : { id: null, reason: r.reason };
}
export const PLAN400_GUIDED_EVT = "fk-open-plan400-guided";
const load = (): Record<string, Log> => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } };
/** 合并写入同一天记录；读回校验，失败不报成功。 */
function saveLog(date: string, patch: Log): boolean {
  try {
    const all = load(); const next = { ...all, [date]: { ...(all[date] ?? {}), ...patch, savedAt: new Date().toISOString() } };
    const raw = JSON.stringify(next); localStorage.setItem(KEY, raw);
    if (localStorage.getItem(KEY) !== raw) return false;
    window.dispatchEvent(new Event(EVT)); return true;
  } catch { return false; }
}
function useLogs(): Record<string, Log> {
  const [logs, setLogs] = useState<Record<string, Log>>({});
  useEffect(() => { const f = () => setLogs(load()); f(); window.addEventListener(EVT, f); window.addEventListener("storage", f); return () => { window.removeEventListener(EVT, f); window.removeEventListener("storage", f); }; }, []);
  return logs;
}
/** v81（t513）：逐组引导进行中时，详情页给出口：继续引导 / 放弃本次（不记录）。 */
function GuidedLiveActions({ date, onClose }: { date: string; onClose: () => void }) {
  const [rev, setRev] = useState(0), [msg, setMsg] = useState("");
  const sid = scheduleExecutionId(strengthEntryId(date), "strength");
  let live = false; try { live = guidedLive(sid); } catch { live = false; }
  void rev;
  if (!live) return msg ? <p role="status" className="keep text-xs text-muted" data-testid="guided-discarded">{msg}</p> : null;
  return <div className="flex gap-2 rounded-xl border border-accent/60 p-2" data-testid="guided-live-actions">
    <button type="button" className="min-h-11 flex-1 rounded-xl bg-accent text-sm font-bold text-accent-fg" onClick={() => { onClose(); window.dispatchEvent(new CustomEvent("fk-open-scheduled", { detail: strengthEntryId(date) })); }}>继续引导</button>
    <button type="button" className="min-h-11 flex-1 rounded-xl border border-risk text-sm font-bold text-risk" onClick={() => { if (!window.confirm("放弃本次逐组引导？已做的组不会保存，日志、复盘和五维都不会出现这次记录。")) return; if (discardGuided(sid)) { setMsg("已放弃本次，力量回到未记录。"); setRev((n) => n + 1); } else setMsg("放弃未能核实保存，请重试。"); }}>放弃本次</button>
  </div>;
}
function strengthLive(date: string): boolean {
  try { const sid = scheduleExecutionId(strengthEntryId(date), "strength"); return guidedLive(sid); } catch { return false; }
}
/* ui-r2：组合课分项（只读派生，见 plan400-components.ts）。设备跑步只作同日候选，不关联、不写入任何记录。 */
function useDeviceRuns(date: string): DeviceRun[] {
  const [runs, setRuns] = useState<DeviceRun[]>([]);
  useEffect(() => { const f = () => { try { setRuns(deviceRunsOn(date, loadTrainingActivities())); } catch { setRuns([]); } }; f(); window.addEventListener("fk-training-activities-changed", f); window.addEventListener("storage", f); return () => { window.removeEventListener("fk-training-activities-changed", f); window.removeEventListener("storage", f); }; }, [date]);
  return runs;
}
function useCombo(d: V4Day, log: Log | undefined): ComboView & { runs: DeviceRun[]; dayParts: DayParts } {
  const runs = useDeviceRuns(d.date);
  let entry; try { entry = loadSchedule().entries.find((e) => e.id === strengthEntryId(d.date)); } catch { entry = undefined; }
  // v81：组合课（跑步＋力量同一条目）只做完力量时，日程条目还不投影整节结果；力量分项直接看最近一次（未作废）逐组课次。
  try { const o = latestOccurrence(scheduleExecutionId(strengthEntryId(d.date), "strength")); if (o && o.lifecycle !== "IN_PROGRESS" && !entry?.actual?.executionState) entry = { ...(entry ?? { id: strengthEntryId(d.date) }), actual: { ...(entry?.actual ?? {}), executionState: o.lifecycle === "COMPLETED" ? "COMPLETED" : "INTERRUPTED", occurrenceIds: [o.trainingOccurrenceId] } } as typeof entry; } catch { /* 读不到就按条目 */ }
  const parts = useParts(d.date), { link } = useV4RunLink(d.date), shared = usePartsAll()[d.date];
  const live = strengthLive(d.date);
  const v = comboView(d, log, { deviceRuns: runs, strengthEntry: entry, strengthLive: live, parts, runLinked: !!link, shared: shared ? { ...shared, runLinked: !!link } : undefined });
  // v83：DaySheet 的状态与计划列表/首页/日志用同一份分项输入
  return { ...v, runs, dayParts: { ...(shared ?? {}), parts, runLinked: !!link } };
}
const TONE_CLS: Record<ComponentState["tone"], string> = { none: "border-line text-muted", candidate: "border-warn/60 text-warn", partial: "border-accent/60 text-accent", live: "border-accent text-accent", done: "border-[#47C29A] text-[#47C29A]", skipped: "border-line text-muted" };
function CompChip({ s }: { s: ComponentState }) { return <span className={"shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-bold " + TONE_CLS[s.tone]}>{s.label}</span>; }
function ComboStatus({ v }: { v: ComboView }) {
  if (!v.combo) return null;
  return <section className="home-card p-3" aria-label="组合课分项状态" data-testid="combo-status">
    <p className="keep text-xs text-muted">组合课分两项记录 · {v.overall}</p>
    <div className="mt-2 grid gap-1.5"><div className="flex items-center justify-between gap-2"><span className="font-bold">跑步</span><CompChip s={v.running} /></div>{v.running.detail ? <p className="keep text-[11px] text-muted">{v.running.detail}</p> : null}
      {v.strength ? <div className="flex items-center justify-between gap-2"><span className="font-bold">力量</span><CompChip s={v.strength} /></div> : null}</div>
    {v.legacy.done ? <p className="keep mt-2 text-[11px] text-muted">整课标记（旧口径，跑步与力量没分开）：{v.legacy.done === "done" ? "完成" : v.legacy.done === "reduced" ? "减量完成" : v.legacy.done === "skipped" ? "没练/取消" : v.legacy.done}</p> : null}
  </section>;
}
function DeviceRunList({ runs }: { runs: DeviceRun[] }) {
  if (!runs.length) return <p className="keep text-xs text-muted">这天没有手表跑步记录。佳明账号同步只在打开 App / 手动同步时拉取；也可以在「健康 › 导入」导入 FIT/TCX/GPX 文件。</p>;
  return <div className="space-y-2" data-testid="device-run-candidates">
    <p className="keep text-xs text-muted">同日手表跑步{runs.length > 1 ? `（${runs.length} 条，未判断是哪一条）` : ""} · 只显示设备给出的字段，未关联到这节课</p>
    {runs.map((r) => <div key={r.id} className="rounded-xl bg-surface-2 p-2.5 text-xs leading-5"><p className="font-bold">{r.title || "跑步"} <span className="font-normal text-muted">· {r.sourceLabel}</span></p><p>{deviceRunFacts(r).join(" · ") || "设备没有给出距离/用时"}</p><p className="keep text-muted">没有确认是这节课的跑步前，不拿它的圈段对照；各组成绩和组间休息请按实际手填，没填就保持未知。</p></div>)}
    <p className="keep text-[11px] text-muted">这些手表跑步不是这节课的候选（你标过“不是这节”，或已关联到别的计划课），作为计划外记录保留在日志里。</p>
  </div>;
}
export function openPlan400Day(date: string, tab: Tab = "plan") { window.dispatchEvent(new CustomEvent(OPEN_EVT, { detail: { date, tab } })); }
export function plan400DayFor(date: string): { title: string; kind: ReturnType<typeof dayKind>; week: string } | null { const d = dayOf(plan, date); return d ? { title: d.title, kind: dayKind(d), week: d.week } : null; }
const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
const STATUS_CLS: Record<DayStatus, string> = { rest: "border-line text-muted", not_started: "border-line text-fg", upcoming: "border-line text-muted", in_progress: "border-accent text-accent", done: "border-[#47C29A] text-[#47C29A]", reduced: "border-[#47C29A] text-[#47C29A]", skipped: "border-line text-muted line-through decoration-1", unrecorded: "border-warn text-warn" };
function StatusChip({ s }: { s: DayStatus }) { return <span className={"shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-bold " + STATUS_CLS[s]}>{STATUS_LABEL[s]}</span>; }
function KindChip({ d }: { d: V4Day }) { const k = dayKind(d); return <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">{KIND_LABEL[k]}{hasStrength(d) && k !== "rest" ? " + 力量" : ""}</span>; }

function StrengthOverride({ d }: { d: V4Day }) {
  const [o, setO] = useState<Override | null>(() => loadO()[d.date] ?? null);
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState<Override>(() => o ?? { parts: [], exercises: [], savedAt: "" });
  const [startError, setStartError] = useState("");
  const text = d.strength.join("");
  if (/^无|^可做|^仅活动度/.test(text) && !o) return null;
  const save = (n: Override | null) => { const all = loadO(); if (n) all[d.date] = n; else delete all[d.date]; localStorage.setItem(OKEY, JSON.stringify(all)); setO(n); setEdit(false); };
  const startStrength = async () => {
    const r = await ensurePlan400Entry(d.date);
    if (!r.id) { setStartError(r.reason ?? "这节力量没有可执行的动作，请先“把力量动作设为可执行”。"); return; }
    setStartError("");
    window.dispatchEvent(new CustomEvent("fk-open-scheduled", { detail: r.id }));
  };
  const live = strengthLive(d.date);
  return <div className="mt-2 rounded-xl bg-surface-2 p-3">
    {startError ? <p role="alert" className="text-sm text-risk">{startError}</p> : null}
    {o && !edit ? <><p className="text-xs font-bold text-muted">我的力量安排（修改后的执行安排，原课表不变）</p><ul className="mt-1 space-y-0.5 text-sm">{o.exercises.map((e, i) => <li key={i}>{e.name} {e.sets}×{e.reps}{UNIT_LABEL[e.unit ?? doseOf(e.name).unit]}{(e.perSide ?? doseOf(e.name).perSide) ? "/每侧" : ""}{e.weight ? ` @${e.weight}kg` : ""}{e.rpe ? ` RPE${e.rpe}` : ""}｜组间休息：{fmtRest(e.restSec)}</li>)}{o.betweenRestSec != null ? <li>动作之间休息：{fmtRest(o.betweenRestSec)}</li> : null}</ul></> : null}
    {edit ? <div className="space-y-2"><PartChips value={draft.parts} onChange={(parts) => setDraft({ ...draft, parts })} /><ExerciseEditor value={draft.exercises} onChange={(exercises) => setDraft({ ...draft, exercises })} parts={draft.parts} betweenRest={draft.betweenRestSec ?? null} onBetweenRest={(v) => setDraft({ ...draft, betweenRestSec: v })} />
      <div className="flex gap-2"><button type="button" className="min-h-11 flex-1 rounded-xl bg-accent font-bold text-accent-fg" onClick={() => save({ ...draft, savedAt: new Date().toISOString() })}>保存我的安排</button><button type="button" className="min-h-11 rounded-xl border border-line px-3" onClick={() => setEdit(false)}>取消</button></div></div>
      : <div className="mt-2 flex flex-wrap gap-2">{o ? <button type="button" className="min-h-11 flex-1 rounded-xl border border-accent font-bold text-accent" onClick={() => { void startStrength(); }}>{live ? "继续力量部分（逐组引导）" : "开始力量部分（逐组引导）"}</button> : null}<button type="button" className="min-h-11 flex-1 rounded-xl border border-line text-sm" onClick={() => { setDraft(o ?? { parts: [], exercises: parseStrength(text), savedAt: "" }); setEdit(true); }}>{o ? "修改力量安排" : "把力量动作设为可执行"}</button>{o ? <button type="button" className="min-h-11 rounded-xl border border-line px-3 text-sm" onClick={() => { if (window.confirm("恢复为原课表的力量文字？你的修改会删除，已完成的训练记录不受影响。")) save(null); }}>恢复原计划</button> : null}</div>}
  </div>;
}
export function parseStrength(text: string): Ex[] {
  return parseV4StrengthText(text).map((m) => ({ name: m.name, sets: m.sets, reps: m.reps, weight: "", rpe: "", unit: m.unit === "sec" ? "sec" : doseOf(m.name).unit, perSide: m.perSide || doseOf(m.name).perSide }));
}

const DURING: [keyof Log, string, string][] = [["reps", "正式主课实际分段", "如 150m: 21.3 / 21.0 / 21.6"], ["rest", "实际组间休息", "如 7分 / 8分"], ["aux", "辅助段（单独记录）", "如 60m渐进×3 完成"], ["strength", "力量实际 组×重量×次数", "如 分腿蹲 2×20kg×5/腿"]];
const AFTER: [keyof Log, string, string][] = [["rpe", "整课 RPE (1-10)", "7"], ["pain", "疼痛部位/程度 (0-10)", "无 / 跟腱 2"], ["note", "备注 / 天气 / 场地", ""]];
/* ui-r2：占位符不再写成像答案的样子（原来的“6.5h · 7 · 小腿酸”“恢复好 · 轻快”看起来像已填）。 */
const LATER: [keyof Log, string, string][] = [["r24", "24 小时后：恢复1-10·酸痛部位·腿沉（睡眠见上方，不用重复填）", "按实际填写，没感觉就留空"], ["r48", "48–72 小时后：恢复·热身轻快程度", "按实际填写，没感觉就留空"]];
function SharedSleep({ date }: { date: string }) {
  const [s, setS] = useState<ReturnType<typeof sharedSleepFor>>(null);
  useEffect(() => { try { setS(sharedSleepFor(date, loadVitals().records, currentAthleteId())); } catch { setS(null); } }, [date]);
  return <p className="keep rounded-xl bg-surface-2 p-2 text-xs text-muted" data-testid="shared-sleep">{s ? `训练当晚睡眠 ${s.hours} 小时（${s.day} · ${s.source}）。这是健康页的同一条记录，跑步和力量共用，不再重复填。` : "训练当晚的睡眠还没有记录。睡眠在健康页记一次就行，跑步和力量共用同一条。"}</p>;
}

function Fields({ list, value, onChange }: { list: [keyof Log, string, string][]; value: Log; onChange: (l: Log) => void }) {
  return <>{list.map(([k, label, ph]) => <label key={k} className="block"><span className="text-xs text-muted">{label}</span><input className="mt-0.5 min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-base" placeholder={ph} value={value[k] ?? ""} onChange={(e) => onChange({ ...value, [k]: e.target.value })} /></label>)}</>;
}
/** v83（P1-06）：已确认关联的手表跑步有圈段 → 识别值（待确认）；点“填入”才放进下面的输入框，再点保存才写入。 */
function LapSuggest({ d, onFill }: { d: V4Day; onFill: (reps: string, rest: string) => void }) {
  const { link } = useV4RunLink(d.date);
  if (!link) return null;
  const gid = link.run.garminId;
  const m = matchLaps(gid != null ? cachedLaps(gid) : null, plannedRepsFromText(d.main.slice(1).join("")));
  if (m.status !== "matched") return <p className="keep rounded-xl bg-surface-2 p-2 text-xs text-muted" data-testid="lap-unknown">圈段对照：{m.reason}{gid != null && !cachedLaps(gid) ? "（圈段还没下载：在日志里打开这条佳明跑步可加载）" : ""}</p>;
  return <div className="rounded-xl border border-accent/50 p-2.5 text-xs leading-5" data-testid="lap-match">
    <p className="font-bold">识别值（待确认）· 来源 {m.source}</p>
    <p className="keep">逐组：{m.repsText}</p><p className="keep">休息：{m.restText}</p>
    <p className="keep text-muted">原始圈段保留不改；确认无误再填入，然后点“保存跑步记录”。</p>
    <button type="button" className="mt-1 min-h-10 rounded-lg border border-accent px-3 font-bold text-accent" onClick={() => onFill(m.repsText, m.restText)}>填入下面（还没保存）</button>
  </div>;
}
/** R5：手填分段——「按目标填充」一键填满每组，只改偏离的那几组；结果仍写进下面的“实际分段”文字框（不自动保存）。 */
function SplitGrid({ d, value, logs, onChange }: { d: V4Day; value: string | undefined; logs: Record<string, Log>; onChange: (reps: string) => void }) {
  const text = d.main.slice(1).join("");
  const plan = plannedRepsFromText(text);
  if (!plan) return null;
  const vals = splitsFromText(value, plan);
  const target = targetSecFromText(text) ?? lastSplitTarget(logs as Record<string, { reps?: string }>, plan, d.date);
  const set = (i: number, v: string) => { const next = [...vals]; next[i] = v; onChange(splitsToText(next, plan)); };
  return <div className="rounded-xl border border-line p-2.5" data-testid="split-grid">
    <div className="flex items-center justify-between gap-2">
      <p className="text-xs font-bold">{plan.distanceM}m × {plan.reps}{plan.rounds ? ` × ${plan.rounds}轮` : ""} · 每组秒数</p>
      <button type="button" data-testid="split-fill-target" disabled={!target} onClick={() => target && onChange(splitsToText(fillFromTarget(vals, target.sec), plan))} className="min-h-10 shrink-0 rounded-lg border border-accent px-3 text-xs font-bold text-accent disabled:border-line disabled:text-muted">按目标填充</button>
    </div>
    <p className="keep mt-1 text-[11px] text-muted">{target ? `目标 ${target.sec} 秒（${target.source}）。只填空着的组，已填的不覆盖；填好后改掉跑偏的那几组。` : "课表没写目标秒数，也没有同距离旧记录：先手填。"}</p>
    <div className="mt-2 grid grid-cols-4 gap-1.5 sm:grid-cols-6">{vals.map((v, i) => <label key={i} className="block"><span className="text-[10px] text-muted">{plan.rounds ? `${Math.floor(i / plan.reps) + 1}-${i % plan.reps + 1}` : `第${i + 1}组`}</span><input data-testid={`split-rep-${i}`} inputMode="decimal" className={"mt-0.5 min-h-11 w-full rounded-lg border bg-surface px-2 text-center text-base " + (target && v && v !== "—" && Math.abs(Number(v) - target.sec) >= 0.05 ? "border-accent" : "border-line")} value={v === "—" ? "" : v} placeholder="—" onChange={(e) => set(i, e.target.value)} /></label>)}</div>
  </div>;
}
/** v83（P1-08/P1-09）：组合课的旧整课记录只读显示（不拆、不再编辑），没有旧记录就不显示。 */
function LegacyReadOnly({ log, kind }: { log: Log; kind: "after" | "later" }) {
  const t = (v: unknown) => String(v ?? "").trim();
  const DONE: Record<string, string> = { done: "完成", reduced: "减量完成", skipped: "没练/取消" };
  const items = kind === "after" ? [["结果", DONE[t(log.done)] ?? ""], ["整课 RPE（旧口径，不代表跑步或力量各自的强度）", t(log.rpe)], ["疼痛", t(log.pain)], ["备注", t(log.note)]] : [["24 小时（整课）", t(log.r24)], ["48–72 小时（整课）", t(log.r48)]];
  const has = items.filter(([, v]) => v);
  if (!has.length) return null;
  return <section className="home-card space-y-1 p-4 text-xs" aria-label="历史整课记录（只读）" data-testid={`legacy-readonly-${kind}`}>
    <p className="font-bold text-muted">历史整课记录（旧版本填的，只读，保留不拆）</p>
    {has.map(([k, v]) => <p key={k} className="keep">{k}：{v}</p>)}
    <p className="keep text-muted">现在按跑步、力量分开记：{kind === "after" ? "用上面两块评价" : "用下面的分项恢复"}。</p>
  </section>;
}
function DaySheet({ d, today, initialTab, onClose }: { d: V4Day; today: string; initialTab: Tab; onClose: () => void }) {
  const logs = useLogs(); const log = logs[d.date] ?? {};
  const [tab, setTab] = useState<Tab>(initialTab);
  const [edit, setEdit] = useState<Log>(log);
  const [msg, setMsg] = useState("");
  useEffect(() => { setEdit(load()[d.date] ?? {}); }, [d.date]);
  const combo = useCombo(d, log);
  const status = dayStatus(d, log, today, strengthLive(d.date), combo.dayParts);
  const week = plan.weeks.find(w => w.week === d.week);
  const commit = (keys: (keyof Log)[], extra: Log = {}) => { const patch: Log = { ...extra }; for (const k of keys) patch[k] = edit[k] ?? ""; const ok = saveLog(d.date, patch); setMsg(ok ? `已保存 ${new Date().toTimeString().slice(0, 5)}（本机）` : "没有保存成功，原记录未改变。请检查存储空间后重试。"); };
  const tabs: [Tab, string][] = [["plan", "课表"], ["during", "训练中"], ["after", "训练后"], ["later", "24–72h"]];
  const later = d.date >= today;
  return <div className="fixed inset-0 z-50 overflow-y-auto bg-bg" role="dialog" aria-label={`${md(d.date)} ${d.title} 训练详情`} data-testid="plan400-day-sheet">
    <div className="sticky top-0 z-10 border-b border-line bg-bg px-4 pb-2" style={{ paddingTop: "max(8px, env(safe-area-inset-top))" }}>
      <div className="mx-auto flex max-w-3xl items-start justify-between gap-2">
        <div className="min-w-0"><p className="text-xs text-muted">{d.week === "TEST" ? "最终测试" : `${d.week}${week ? `｜${week.title}` : ""}`}</p><h2 className="text-lg font-bold">{md(d.date)} {d.weekday} · {d.title}</h2><div className="mt-1 flex flex-wrap items-center gap-1.5" data-testid="sheet-status"><KindChip d={d} /><StatusChip s={status} />{combo.combo ? <><span className="text-[11px] text-muted">跑步</span><CompChip s={combo.running} />{combo.strength ? <><span className="text-[11px] text-muted">力量</span><CompChip s={combo.strength} /></> : null}</> : null}</div></div>
        <button type="button" className="grid size-11 shrink-0 place-items-center rounded-full bg-surface" aria-label="关闭训练详情" onClick={onClose}><X className="size-5" /></button>
      </div>
      <div className="mx-auto mt-2 grid max-w-3xl grid-cols-4 gap-1 rounded-xl bg-surface p-1" role="tablist" aria-label="训练详情分区">{tabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={"min-h-10 rounded-lg text-sm font-bold " + (tab === id ? "bg-accent text-accent-fg" : "text-muted")}>{label}</button>)}</div>
    </div>
    <div className="mx-auto max-w-3xl space-y-3 px-4 pt-3 text-sm" style={{ paddingBottom: "calc(24px + env(safe-area-inset-bottom))" }}>
      <ComboStatus v={combo} />
      <GuidedLiveActions date={d.date} onClose={onClose} />
      {tab === "plan" ? <>
        <section className="home-card p-4"><h3 className="text-xs font-bold text-muted">{dayKind(d) === "rest" ? "休息日安排" : "正式主课 / 恢复课"}</h3><p className="mt-1 whitespace-pre-line leading-6">{joinLines(d.week === "TEST" ? d.main : d.main.slice(1)) || "原课表未写"}</p></section>
        {d.aux.length ? <section className="home-card p-4"><h3 className="text-xs font-bold text-muted">辅助激活与技术</h3><p className="mt-1 leading-6">{joinLines(d.aux)}</p></section> : null}
        {d.strength.length ? <section className="home-card p-4"><h3 className="text-xs font-bold text-muted">力量与核心 · 原课表</h3><p className="mt-1 leading-6">{joinLines(d.strength)}</p><StrengthOverride d={d} /></section> : null}
        {week ? <details className="home-card p-4"><summary className="min-h-10 cursor-pointer font-bold">本周原则</summary><p className="mt-1 leading-6 text-muted">{shiftedText(plan, week.week, week.principle)}</p></details> : null}
        <details className="home-card p-4"><summary className="min-h-10 cursor-pointer font-bold">原文与原日期（只读）</summary><p className="mt-1 text-xs text-muted">原课表日期 {d.orig || "未记录"} → 当前日程 {d.date}{d.orig && d.orig !== d.date ? `（顺延 ${Math.round((Date.parse(d.date) - Date.parse(d.orig)) / 864e5)} 天）` : ""}</p><pre className="mt-2 whitespace-pre-wrap break-words text-xs leading-5">{[...d.main, ...d.aux, ...d.strength].join("\n")}</pre></details>
      </> : null}
      {tab === "during" && combo.combo ? <>
        <section className="home-card space-y-3 p-4" aria-label="跑步实际记录" data-testid="during-running">
          <h3 className="font-bold">跑步部分</h3>
          <p className="keep text-xs text-muted">目标：{joinLines(d.main.slice(1)).split("\n")[0] || d.title}。没做的项留空（不会记成 0）。</p>
          <RunLinkPanel date={d.date} fallback={<DeviceRunList runs={combo.runs} />} />
          <LapSuggest d={d} onFill={(reps, rest) => setEdit(e => ({ ...e, reps, rest }))} />
          <SplitGrid d={d} value={edit.reps} logs={logs} onChange={(reps) => setEdit(e => ({ ...e, reps }))} />
          <Fields list={DURING.slice(0, 3)} value={edit} onChange={setEdit} />
          <button type="button" className="min-h-12 w-full rounded-xl bg-accent font-bold text-accent-fg" onClick={() => commit(["reps", "rest", "aux"])}>保存跑步记录</button>
        </section>
        <section className="home-card space-y-3 p-4" aria-label="力量实际记录" data-testid="during-strength">
          <h3 className="font-bold">力量部分</h3>
          <p className="keep text-xs text-muted">手表跑步不会把力量算作完成。可以在「课表」把力量设为可执行后逐组引导；或在这里简单手填。</p>
          <Fields list={DURING.slice(3)} value={edit} onChange={setEdit} />
          <button type="button" className="min-h-12 w-full rounded-xl border border-accent font-bold text-accent" onClick={() => commit(["strength"])}>保存力量记录</button>
        </section>
      </> : null}
      {tab === "during" && !combo.combo ? <section className="home-card space-y-3 p-4" aria-label="训练中记录">
        <p className="text-xs text-muted">逐段记录实际完成情况；没做的项留空（不会记成 0）。目标：{joinLines(d.main.slice(1)).split("\n")[0] || d.title}</p>
        <SplitGrid d={d} value={edit.reps} logs={logs} onChange={(reps) => setEdit(e => ({ ...e, reps }))} />
        <Fields list={DURING} value={edit} onChange={setEdit} />
        <button type="button" className="min-h-12 w-full rounded-xl bg-accent font-bold text-accent-fg" onClick={() => commit(["reps", "rest", "aux", "strength"])}>保存本段记录</button>
        {hasStrength(d) ? <p className="text-xs text-muted">力量部分可在「课表」页设为可执行后逐组引导，记录会进入训练日志。</p> : null}
      </section> : null}
      {tab === "after" && combo.combo ? <><PartFeedbackForm date={d.date} part="running" name="跑步" />{hasStrength(d) ? <PartFeedbackForm date={d.date} part="strength" name="力量" /> : null}</> : null}
      {tab === "after" && combo.combo ? <LegacyReadOnly log={log} kind="after" /> : null}
      {tab === "after" && !combo.combo ? <section className="home-card space-y-3 p-4" aria-label="训练后反馈">
        <p className="text-xs font-bold text-muted">这节课的结果</p>
        <div className="grid grid-cols-3 gap-2">{([["done", "完成"], ["reduced", "减量完成"], ["skipped", "没练/取消"]] as const).map(([v, t]) => <button key={v} type="button" aria-pressed={edit.done === v} className={"min-h-11 rounded-xl border text-sm font-bold " + (edit.done === v ? "border-accent bg-accent/15 text-accent" : "border-line")} onClick={() => setEdit({ ...edit, done: edit.done === v ? undefined : v })}>{t}</button>)}</div>
        <Fields list={AFTER} value={edit} onChange={setEdit} />
        <button type="button" className="min-h-12 w-full rounded-xl bg-accent font-bold text-accent-fg" onClick={() => { if (edit.done === "skipped" && log.done !== "skipped" && !window.confirm("标记为没练/取消？原课表不会改动，之后可以改回。")) return; commit(["rpe", "pain", "note"], { done: edit.done ?? "" }); }}>保存训练后反馈</button>
        <p className="text-xs text-muted">24 小时、48–72 小时的恢复情况不用现在填，到时在「24–72h」补录。</p>
      </section> : null}
      {tab === "later" ? <section className="home-card space-y-3 p-4" aria-label="恢复补录">
        {later ? <p className="rounded-xl bg-surface-2 p-2 text-xs text-muted">这节课还没过 24 小时，可以以后再填。</p> : null}
        {!later && recoveryTiming(d.date, today) === "late" ? <p className="keep rounded-xl bg-surface-2 p-2 text-xs text-muted">已超过 72 小时，现在填的是事后回忆，请按记得的情况写。</p> : null}
        <SharedSleep date={d.date} />
        {/* v83（P1-09）：组合课只用下面“跑步/力量分开的恢复”这一套；整课的 24h/48h 旧字段只读显示，不再让你填第二遍 */}
        {!combo.combo ? <><Fields list={LATER} value={edit} onChange={setEdit} />
        <button type="button" className="min-h-12 w-full rounded-xl border border-accent font-bold text-accent" onClick={() => commit(["r24", "r48"])}>保存恢复补录</button></> : null}
      </section> : null}
      {tab === "later" && combo.combo ? <LegacyReadOnly log={log} kind="later" /> : null}
      {tab === "later" && combo.combo && !later ? <RecoveryParts date={d.date} late={recoveryTiming(d.date, today) === "late"} daysSince={Math.round((Date.parse(today) - Date.parse(d.date)) / 864e5)} /> : null}
      {msg ? <p role="status" className="text-sm">{msg}</p> : log.savedAt ? <p className="text-xs text-muted">上次保存 {stampCN(log.savedAt, "ymd")}</p> : null}
      <p className="text-xs text-muted">这一页的记录存在本机（整课：400米V4 记录；分项：V4 分项记录），会进入日志、复盘和方坤；关联的手表跑步只算一次。</p>
    </div>
  </div>;
}
/** 全局只挂一次：首页卡、计划页、日历都通过事件打开同一个详情（同一日期 = 同一记录）。 */
export function Plan400DayHost({ today }: { today: string }) {
  const [open, setOpen] = useState<{ date: string; tab: Tab } | null>(null);
  useEffect(() => { const h = (e: Event) => { const v = (e as CustomEvent<{ date: string; tab?: Tab }>).detail; if (v?.date && dayOf(plan, v.date)) setOpen({ date: v.date, tab: v.tab ?? "plan" }); }; window.addEventListener(OPEN_EVT, h); return () => window.removeEventListener(OPEN_EVT, h); }, []);
  const d = open ? dayOf(plan, open.date) : undefined;
  return d && open ? <DaySheet key={open.date + open.tab} d={d} today={today} initialTab={open.tab} onClose={() => setOpen(null)} /> : null;
}

function summaryLines(d: V4Day): string[] {
  const k = dayKind(d), main = joinLines(d.main.slice(1)).split("\n")[0];
  const out = [main ? `主课：${main.replace(/^正式主课：/, "")}` : ""];
  if (d.aux.length) out.push(joinLines(d.aux).replace(/^辅助：/, "辅助："));
  if (hasStrength(d)) out.push(`力量：${joinLines(d.strength)}`);
  return (k === "rest" ? [main || "休息"] : out).filter(Boolean).slice(0, 3);
}
/** ui-r2：首页主卡上的分项状态（组合课才显示；只有记录后才出现，避免训练前多一行噪音）。 */
function HomeComboLine({ d, log }: { d: V4Day; log: Log | undefined }) {
  const v = useCombo(d, log);
  if (!v.combo || (v.running.tone === "none" && (!v.strength || v.strength.tone === "none"))) return null;
  return <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs" data-testid="home-combo-line"><span className="text-muted">跑步</span><CompChip s={v.running} /><span className="ml-1 text-muted">力量</span>{v.strength ? <CompChip s={v.strength} /> : null}</p>;
}
/** 首页：今天 V4 课摘要 + 唯一主操作。 */
export function Plan400TodayCard({ today, onReview }: { today: string; onReview?: () => void }) {
  const logs = useLogs(); const partsAll = usePartsAll();
  const [live, setLive] = useState(false);
  useEffect(() => { setLive(strengthLive(today)); }, [today, logs]);
  if (!today) return null;
  const d = dayOf(plan, today);
  if (!d) { const next = days.find((x) => x.date > today); return next ? <section className="home-card mb-3 p-4 text-sm" aria-label="400米计划"><p className="text-xs text-muted">400米 V4</p><p className="mt-1">今天不在计划日程内。下一节：{md(next.date)} {next.weekday}「{next.title}」</p><button type="button" className="mt-2 min-h-11 text-accent" onClick={() => openPlan400Day(next.date)}>查看 ›</button></section> : null; }
  const s = dayStatus(d, logs[d.date], today, live, partsAll[d.date]), cta = primaryCta(s);
  const week = plan.weeks.find(w => w.week === d.week);
  const go = () => { if ((cta.action === "start" || cta.action === "continue") && d.date === today) { const detail = { date: d.date, handled: false }; window.dispatchEvent(new CustomEvent(PLAN400_GUIDED_EVT, { detail })); if (!detail.handled) openPlan400Day(d.date, "during"); } else if (cta.action === "start" || cta.action === "continue") openPlan400Day(d.date, "during"); else if (cta.action === "review" || cta.action === "reason" || cta.action === "backfill") openPlan400Day(d.date, "after"); else openPlan400Day(d.date, "plan"); };
  return <section className="home-card mb-3 p-4" aria-label="今日训练主卡" data-testid="today-main-card" data-status={s}>
    <div className="flex items-center justify-between gap-2"><p className="min-w-0 truncate text-xs text-muted">今日 · 400米 V4 · {d.week}{week ? `｜${week.title}` : ""}</p><StatusChip s={s} /></div>
    <h2 className="mt-1 text-xl font-bold">{d.title}</h2>
    <p className="text-xs text-muted">{md(d.date)} {d.weekday} · <KindChip d={d} /></p>
    <ul className="mt-2 space-y-1 text-sm leading-6">{summaryLines(d).map((t, i) => <li key={i} className="line-clamp-2">{t}</li>)}</ul>
    <HomeComboLine d={d} log={logs[d.date]} />
    <button type="button" className="mt-3 min-h-12 w-full rounded-xl bg-accent text-base font-bold text-accent-fg" data-testid="today-primary-cta" onClick={go}>{cta.label}</button>
    <div className="mt-1 flex flex-wrap gap-x-4 text-sm"><button type="button" className="min-h-11 text-accent" onClick={() => openPlan400Day(d.date, "plan")}>完整课表 ›</button>{s === "done" || s === "reduced" ? <button type="button" className="min-h-11 text-muted" onClick={() => openPlan400Day(d.date, "later")}>补充恢复信息</button> : null}{(s === "done" || s === "reduced") && onReview ? <button type="button" className="min-h-11 text-muted" onClick={onReview}>去日志看复盘</button> : null}</div>
    <PendingFeedbackList today={today} compact />
  </section>;
}

function DayRow({ d, today, logs, parts }: { d: V4Day; today: string; logs: Record<string, Log>; parts?: DayParts }) {
  const s = dayStatus(d, logs[d.date], today, false, parts);
  return <button type="button" onClick={() => openPlan400Day(d.date)} className={"flex min-h-14 w-full items-center gap-2 border-t border-line py-2 text-left " + (d.date === today ? "rounded-lg bg-accent/10 px-2" : "")} aria-label={`${md(d.date)} ${d.weekday} ${d.title} ${STATUS_LABEL[s]}`}>
    <span className="w-[4.6rem] shrink-0 text-sm"><b>{md(d.date)}</b> <span className="text-muted">{d.weekday}</span></span>
    <span className="min-w-0 flex-1"><span className="block truncate font-bold">{d.title}</span><span className="block text-[11px] text-muted">{KIND_LABEL[dayKind(d)]}{hasStrength(d) && dayKind(d) !== "rest" ? " + 力量" : ""}{d.date === today ? " · 今天" : ""}</span></span>
    <StatusChip s={s} /><ChevronRight className="size-4 shrink-0 text-muted" />
  </button>;
}
/** 计划页：正式导入周期（V4）。当前周默认展开，其余周折叠，W1–W10 与最终测试全部可进入详情。 */
export function Plan400Cycle({ today, sourceSlot, lens = "run" }: { today: string; sourceSlot?: React.ReactNode; lens?: "run" | "lift" }) {
  const logs = useLogs(); const partsAll = usePartsAll();
  const [showSource, setShowSource] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [confirm, setConfirm] = useState(() => { migrateUserConfirmedDates(plan); return loadDateConfirm(plan); });
  const cw = currentWeek(plan, today);
  const [openWeeks, setOpenWeeks] = useState<string[]>([]);
  useEffect(() => { setOpenWeeks([cw]); }, [cw]);
  const counts = useMemo(() => progressCounts(plan, logs, partsAll), [logs, partsAll]);
  const conflicts = useMemo(() => dateConflicts(plan), []);
  const shift = shiftSummary(plan);
  const cur = plan.weeks.find(w => w.week === cw);
  const finals = days.filter(d => d.week === "TEST");
  const filt = (ds: V4Day[]) => lens === "lift" ? ds.filter(hasStrength) : ds;
  return <section className="home-card mb-3 p-4" aria-label="正在执行的周期计划" data-testid="plan400-cycle">
    <p className="text-xs text-muted">正在执行的周期计划</p>
    <div className="mt-1 flex items-start justify-between gap-2"><h2 className="min-w-0 text-lg font-bold leading-snug">{plan.name}</h2><button type="button" className="min-h-11 shrink-0 rounded-full border border-line px-3 text-sm" aria-expanded={showSource} onClick={() => setShowSource(!showSource)}>来源 / 切换</button></div>
    <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]"><span className="rounded-full border border-accent px-2 py-0.5 font-bold text-accent">使用中</span><span className="rounded-full bg-surface-2 px-2 py-0.5 text-muted">已导入 · V4</span><span className="rounded-full bg-surface-2 px-2 py-0.5 text-muted">当前 {cw}{cur ? `｜${shiftedText(plan, cur.week, cur.title)}` : ""}</span></div>
    <p className="mt-2 text-xs text-muted" data-testid="plan400-progress">已记录 {counts.recordedDays}/{counts.calendarEntries} 个日程（含休息/恢复日与测试）· 训练与测试课完成 {counts.completedTrainingDays}/{counts.trainingDays + counts.testDays}</p>
    {showSource && sourceSlot ? <div className="mt-3">{sourceSlot}</div> : null}
    {(conflicts.length || shift.shifted) && confirm ? <details className="mt-2 text-xs text-muted" data-testid="plan400-date-confirmed"><summary className="flex min-h-9 cursor-pointer list-none items-center gap-1">✓ 日期已确认 · 整体顺延 {shift.shiftDays} 天<ChevronRight className="size-3.5" /></summary>
      <ul className="mt-1 space-y-1 leading-5">{conflicts.map(c => <li key={c.week + c.mentioned}>{c.week}：原课表 {c.originalRange} → 现 {c.shownRange}；「{c.text}」{c.matchedDay ? `的${c.matchedDay.title}现在是 ${md(c.matchedDay.date)} ${c.matchedDay.weekday}` : "在日程中没有对应的课"}</li>)}<li>全部 {shift.total} 个日程按原日期 +{shift.shiftDays} 天；最终测试 {plan.final?.date ?? "—"}（原 {plan.final?.orig ?? "—"}）。导入的原课表没有改。</li><li>{confirm.by} · {stampCN(confirm.at, "ymd").slice(0, 10)}</li></ul>
      <button type="button" className="min-h-10 text-accent" onClick={() => { clearDateConfirm(); try { localStorage.setItem(DATE_CONFIRM_KEY + ":revoked", "1") } catch { /* ignore */ } setConfirm(null); }}>撤销确认</button>
    </details> : null}
    {(conflicts.length || shift.shifted) && !confirm ? <div className="mt-3 rounded-xl border border-warn/50 p-3 text-xs" role="status" data-testid="plan400-date-warning">
      <p className="flex gap-1.5 font-bold text-warn"><TriangleAlert className="mt-0.5 size-4 shrink-0" />日期待核对</p>
      <p className="mt-1 leading-5">导入日程整体顺延 {shift.shiftDays} 天{conflicts.length ? `；${conflicts.map(c => `${c.week} 标题写「${c.text}」，当前周显示 ${c.shownRange}`).join("；")}` : ""}。请核对原始安排后再执行相关测试课。这里保留原课表，未自动改期。</p>
      <button type="button" className="mt-1 mr-3 min-h-10 font-bold text-accent" onClick={() => { try { localStorage.removeItem(DATE_CONFIRM_KEY + ":revoked") } catch { /* ignore */ } setConfirm(saveDateConfirm(plan, "用户确认")); }}>日期没问题，按顺延后执行</button>
      <button type="button" className="mt-1 min-h-10 font-bold text-accent" aria-expanded={showDiff} onClick={() => setShowDiff(!showDiff)}>{showDiff ? "收起差异" : "查看差异"}</button>
      {showDiff ? <ul className="mt-1 space-y-1 leading-5">{conflicts.map(c => <li key={c.week + c.mentioned}>{c.week}：原课表周期 {c.originalRange}，当前日程 {c.shownRange}；标题/原则中的「{c.text}」{c.matchedDay ? ` 对应原日期 ${c.matchedDay.orig} 的「${c.matchedDay.title}」，现排在 ${md(c.matchedDay.date)} ${c.matchedDay.weekday}` : " 在日程中没有对应的课"}。</li>)}<li>全部 {shift.total} 个日程都按原日期 +{shift.shiftDays} 天排入；最终测试原为 {plan.final?.orig ?? "—"}，现为 {plan.final?.date ?? "—"}。</li><li>是否改测试日期需要你确认，App 不会自动修改。</li></ul> : null}
    </div> : null}
    <div className="mt-3">{plan.weeks.map(w => { const ds = weekDays(plan, w.week); const shown = filt(ds); const isOpen = openWeeks.includes(w.week); if (lens === "lift" && !shown.length) return null;
      return <div key={w.week} className="border-t border-line first:border-t-0">
        <button type="button" aria-expanded={isOpen} onClick={() => setOpenWeeks(isOpen ? openWeeks.filter(x => x !== w.week) : [...openWeeks, w.week])} className="flex min-h-12 w-full items-center gap-2 py-2 text-left">
          <span className={"w-9 shrink-0 text-sm font-bold " + (w.week === cw ? "text-accent" : "")}>{w.week}</span>
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">{shiftedText(plan, w.week, w.title)}</span><span className="block text-[11px] text-muted">{md(ds[0].date)}—{md(ds[ds.length - 1].date)}{w.week === cw ? " · 本周" : ""}{!confirm && conflicts.some(c => c.week === w.week) ? " · ⚠ 日期待核对" : ""}</span></span>
          <ChevronDown className={"size-4 shrink-0 text-muted transition-transform " + (isOpen ? "rotate-180" : "")} />
        </button>
        {isOpen ? <div className="pb-2">{shown.map(d => <DayRow key={d.date} d={d} today={today} logs={logs} parts={partsAll[d.date]} />)}</div> : null}
      </div>; })}
      {lens === "run" ? finals.map(d => <div key={d.date} className="border-t border-line"><DayRow d={d} today={today} logs={logs} parts={partsAll[d.date]} /></div>) : null}
    </div>
  </section>;
}

type TempEntry = { id: string; date: string; title: string; minutes: number; source: string; status: string; unplanned?: boolean; modality: string; exercises?: unknown[] };
/** 临时 / 自建训练：与正式周期分开展示，只按真实 id 判断是否挂靠 V4。 */
export function TempTrainingList<E extends TempEntry>({ entries, modality, title, onOpen, onAdd, addLabel, empty, footer }: { entries: E[]; modality: "run" | "strength"; title: string; onOpen: (e: E) => void; onAdd: () => void; addLabel: string; empty: string; footer?: React.ReactNode }) {
  // v83（P2-03）：正式周期（V4 当天课程 plan400:*）只在上方周期计划里出现；计划外记录（记一笔等 unplanned）在日志里，不算“排了的训练”
  const list = entries.filter(e => e.modality === modality && ["planned", "done"].includes(e.status) && !String(e.id).startsWith("plan400:") && !(e as { unplanned?: boolean }).unplanned).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
  return <section className="home-card mb-3 p-4" aria-label={title}>
    <div className="flex items-center justify-between gap-2"><h2 className="font-bold">{title}</h2><button type="button" className="min-h-11 rounded-full border border-accent px-3 text-sm font-bold text-accent" onClick={onAdd}>{addLabel}</button></div>
    {list.map(e => { const l = entryLinkFor(e); return <button type="button" key={e.id} className="flex min-h-16 w-full items-center justify-between gap-3 border-t border-line py-3 text-left" onClick={() => onOpen(e)}>
      <span className="min-w-0"><b className="block truncate">{e.title}</b><span className="block text-xs text-muted">{e.date} · {modality === "strength" ? `${e.exercises?.length ?? "—"}个动作` : `${e.minutes}分钟`} · {e.status === "done" ? "已完成" : "待执行"}</span>
        <span className="mt-0.5 flex flex-wrap gap-1 text-[11px]"><span className="rounded-full bg-surface-2 px-2 text-muted">{l.sourceLabel}</span>{l.linkedToV4 ? <span className="rounded-full bg-surface-2 px-2 text-muted">挂靠 V4 当天课程</span> : <span className="rounded-full bg-surface-2 px-2 text-muted">未挂靠周期</span>}{l.sameDayV4 ? <span className="rounded-full border border-warn/50 px-2 text-warn">同日有 V4「{l.sameDayV4.title}」</span> : null}</span></span>
      <ChevronRight className="size-4 shrink-0 text-muted" /></button>; })}
    {!list.length ? <p className="border-t border-line py-3 text-sm text-muted">{empty}</p> : null}
    {footer}
  </section>;
}
function entryLinkFor(e: TempEntry) { return entryLink(plan, e); }
