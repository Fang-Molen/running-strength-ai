import { mainTrainingLines } from '@/lib/plan/plan-main';
import { sleepHoursText } from "@/lib/health/observation";
import { stampCN } from "@/lib/ui/activity-format";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, TriangleAlert } from "lucide-react";
import { Sheet } from "./sheet";
import { ExerciseEditor, PartChips, doseOf, UNIT_LABEL, type Ex } from "@/components/exercise-editor";
import { fmtRest } from "@/lib/strength/rest";
import { plan400TodayEntry, parseV4StrengthText } from "@/lib/ui/plan400-start";
import { loadSchedule, saveScheduledEntry } from "@/lib/ui/day-schedule";
import { v4MovedOut } from "@/lib/ui/v4-effective-move";
import { listTrainingOccurrences } from "@/lib/core/occurrence";
import { scheduleExecutionId } from "@/lib/ui/scheduled-execution";
import { discardGuided, guidedLive, latestOccurrence } from "@/lib/ui/guided-discard";
import { KIND_LABEL, STATUS_LABEL, currentWeek, dateConflicts, dayKind, dayOf, entryLink, dayStatus, hasStrength, joinLines, primaryCta, componentCta, comboShort, progressCounts, shiftSummary, loadDateConfirm, saveDateConfirm, clearDateConfirm, migrateUserConfirmedDates, shiftedText, DATE_CONFIRM_KEY, strengthEntryId, weekDays, type DayStatus, type V4Day, type V4Log, type V4Plan } from "@/lib/ui/plan400-view";
import { comboView, deviceRunFacts, deviceRunsOn, recoveryTiming, sharedSleepFor, type ComboView, type ComponentState, type DeviceRun } from "@/lib/ui/plan400-components";
import { loadTrainingActivities } from "@/lib/ui/training-read-model";
import { matchLaps, plannedRepsFromText } from "@/lib/ui/lap-structure";
import { fillFromTarget, lastSplitTarget, splitsFromText, splitsToText, targetSecFromText } from "@/lib/ui/split-fill";
import { cachedLaps } from "@/lib/coach/online-coach";
import { RunLinkPanel, PartFeedbackForm, RecoveryParts, useParts, useV4RunLink, usePartsAll, PendingFeedbackList } from "@/components/plan400-parts";
import type { DayParts } from "@/lib/ui/plan400-view";
import { loadVitals } from "@/lib/nutrition/vitals";
import { currentAthleteId } from "@/lib/core/events";
import { activePlan, planLabel } from "@/lib/plan/active-plan";
import { NoPlanCard, usePlanRevision } from "@/components/plan-import";

/* 原课表只读：存储里的计划文档（fk-plan-doc-v1）永不被训练记录改写。执行记录沿用原 key 与字段（fk-plan400-v4-log / fk-plan400-v4-overrides），无 schema 变化。 */
const EMPTY_PLAN: V4Plan = { name: "", shiftDays: 0, weeks: [], days: [] };
/** v89.6：计划来自本机存储（导入的计划文件或本地生成），不再内置。没有就是空计划。 */
const P = (): V4Plan => activePlan() ?? EMPTY_PLAN;

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
  const d = dayOf(P(), date); if (!d || dayKind(d) === "rest") return { id: null };
  const want = plan400TodayEntry(d, loadO()[date] ?? null, doseOf); if (!want) return { id: null };
  const old = loadSchedule().entries.find((e) => e.id === want.id);
  // V4 原始日期只作历史：已移动的稳定 ID 绝不能在旧日期重新生成。
  if (old && old.date !== date) return { id: null, reason: `该节训练已调整至 ${old.date}；原日期仅保留历史。` };
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
    <p className="text-sm text-muted">{v.overall}</p>
    <div className="mt-2 grid gap-1.5"><div className="flex items-center justify-between gap-2"><span className="font-bold">跑步</span><CompChip s={v.running} /></div>{v.running.detail ? <p className="keep text-[11px] text-muted">{v.running.detail}</p> : null}
      {v.strength ? <div className="flex items-center justify-between gap-2"><span className="font-bold">力量</span><CompChip s={v.strength} /></div> : null}</div>
    {v.legacy.done ? <p className="keep mt-2 text-xs text-muted">历史整课结果：{v.legacy.done === "done" ? "完成" : v.legacy.done === "reduced" ? "减量完成" : v.legacy.done === "skipped" ? "没练/取消" : v.legacy.done}（未区分跑步与力量）</p> : null}
  </section>;
}
function DeviceRunList({ runs }: { runs: DeviceRun[] }) {
  if (!runs.length) return <p className="text-sm text-muted">这天没有手表跑步记录。</p>;
  return <details className="space-y-2" data-testid="device-run-candidates"><summary className="min-h-11 cursor-pointer py-2 text-sm">其他同日手表记录 · {runs.length}条</summary>
    {runs.map((r) => <div key={r.id} className="rounded-xl bg-surface-2 p-2.5 text-sm leading-6"><p className="font-bold">{r.title || "跑步"} <span className="font-normal text-muted">· {r.sourceLabel}</span></p><p>{deviceRunFacts(r).join(" · ") || "设备没有给出距离/用时"}</p></div>)}
    <p className="text-sm text-muted">已排除或已关联其他课程，不参与本课分段对照。</p>
  </details>;
}
export function openPlan400Day(date: string, tab: Tab = "plan") { window.dispatchEvent(new CustomEvent(OPEN_EVT, { detail: { date, tab } })); }
export function plan400DayFor(date: string): { title: string; kind: ReturnType<typeof dayKind>; week: string } | null { const d = dayOf(P(), date); return d ? { title: d.title, kind: dayKind(d), week: d.week } : null; }
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
    if (!r.id) { setStartError(r.reason ?? "请先设置这节训练的力量动作。"); return; }
    setStartError("");
    window.dispatchEvent(new CustomEvent("fk-open-scheduled", { detail: r.id }));
  };
  const live = strengthLive(d.date);
  return <div className="mt-2 rounded-xl bg-surface-2 p-3">
    {startError ? <p role="alert" className="text-sm text-risk">{startError}</p> : null}
    {o && !edit ? <><p className="text-sm font-bold">我的力量安排</p><ul className="mt-1 space-y-0.5 text-sm">{o.exercises.map((e, i) => <li key={i}>{e.name} {e.sets}×{e.reps}{UNIT_LABEL[e.unit ?? doseOf(e.name).unit]}{(e.perSide ?? doseOf(e.name).perSide) ? "/每侧" : ""}{e.weight ? ` @${e.weight}kg` : ""}{e.rpe ? ` RPE${e.rpe}` : ""}｜组间休息：{fmtRest(e.restSec)}</li>)}{o.betweenRestSec != null ? <li>动作之间休息：{fmtRest(o.betweenRestSec)}</li> : null}</ul></> : null}
    {edit ? <div className="space-y-2"><PartChips value={draft.parts} onChange={(parts) => setDraft({ ...draft, parts })} /><ExerciseEditor value={draft.exercises} onChange={(exercises) => setDraft({ ...draft, exercises })} parts={draft.parts} betweenRest={draft.betweenRestSec ?? null} onBetweenRest={(v) => setDraft({ ...draft, betweenRestSec: v })} />
      <div className="flex gap-2"><button type="button" className="min-h-11 flex-1 rounded-xl bg-accent font-bold text-accent-fg" onClick={() => save({ ...draft, savedAt: new Date().toISOString() })}>保存我的安排</button><button type="button" className="min-h-11 rounded-xl border border-line px-3" onClick={() => setEdit(false)}>取消</button></div></div>
      : <div className="mt-2 flex flex-wrap gap-2">{o ? <button type="button" className="min-h-11 flex-1 rounded-xl border border-accent font-bold text-accent" onClick={() => { void startStrength(); }}>{live ? "继续力量训练" : "开始力量训练"}</button> : null}<button type="button" className="min-h-11 flex-1 rounded-xl border border-line text-sm" onClick={() => { setDraft(o ?? { parts: [], exercises: parseStrength(text), savedAt: "" }); setEdit(true); }}>{o ? "修改力量安排" : "设置力量动作"}</button>{o ? <button type="button" className="min-h-11 rounded-xl border border-line px-3 text-sm" onClick={() => { if (window.confirm("恢复为原课表的力量文字？你的修改会删除，已完成的训练记录不受影响。")) save(null); }}>恢复原计划</button> : null}</div>}
  </div>;
}
export function parseStrength(text: string): Ex[] {
  return parseV4StrengthText(text).map((m) => ({ name: m.name, sets: m.sets, reps: m.reps, weight: "", rpe: "", unit: m.unit === "sec" ? "sec" : doseOf(m.name).unit, perSide: m.perSide || doseOf(m.name).perSide }));
}

const DURING: [keyof Log, string, string][] = [["reps", "正式主课实际分段", "如 150m: 21.3 / 21.0 / 21.6"], ["rest", "实际组间休息", "如 7分 / 8分"], ["aux", "辅助段（单独记录）", "如 60m渐进×3 完成"], ["strength", "力量实际 组×重量×次数", "如 分腿蹲 2×20kg×5/腿"]];
const AFTER: [keyof Log, string, string][] = [["rpe", "整课 RPE (1-10)", "7"], ["pain", "疼痛部位/程度 (0-10)", "无 / 跟腱 2"], ["note", "备注 / 天气 / 场地", ""]];
/* ui-r2：占位符不再写成像答案的样子（原来的“6.5h · 7 · 小腿酸”“恢复好 · 轻快”看起来像已填）。 */
const LATER: [keyof Log, string, string][] = [["r24", "24小时后：恢复1–10／酸痛／腿沉", "按实际填写"], ["r48", "48–72小时后：恢复／热身轻快程度", "按实际填写"]];
function SharedSleep({ date }: { date: string }) {
  const [s, setS] = useState<ReturnType<typeof sharedSleepFor>>(null);
  useEffect(() => { try { setS(sharedSleepFor(date, loadVitals().records, currentAthleteId())); } catch { setS(null); } }, [date]);
  return <p className="keep rounded-xl bg-surface-2 p-3 text-sm text-muted" data-testid="shared-sleep">{s ? `当晚睡眠 ${sleepHoursText(s.hours)} · ${s.day} · ${s.source}` : "当晚睡眠未记录，可在健康页补充。"}</p>;
}

function Fields({ list, value, onChange }: { list: [keyof Log, string, string][]; value: Log; onChange: (l: Log) => void }) {
  return <>{list.map(([k, label, ph]) => <label key={k} className="block"><span className="text-sm">{label}</span><input className="mt-1 min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-base" placeholder={ph} value={value[k] ?? ""} onChange={(e) => onChange({ ...value, [k]: e.target.value })} /></label>)}</>;
}
/** v83（P1-06）：已确认关联的手表跑步有圈段 → 识别值（待确认）；点“填入”才放进下面的输入框，再点保存才写入。 */
function LapSuggest({ d, onFill }: { d: V4Day; onFill: (reps: string, rest: string) => void }) {
  const { link } = useV4RunLink(d.date);
  if (!link) return null;
  const gid = link.run.garminId;
  const m = matchLaps(gid != null ? cachedLaps(gid) : null, plannedRepsFromText(mainTrainingLines(d).join("")));
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
  const text = mainTrainingLines(d).join("");
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
  const moved = v4MovedOut(d.date, loadSchedule().entries);
  const week = P().weeks.find(w => w.week === d.week);
  const commit = (keys: (keyof Log)[], extra: Log = {}) => { const patch: Log = { ...extra }; for (const k of keys) patch[k] = edit[k] ?? ""; const ok = saveLog(d.date, patch); setMsg(ok ? `已保存 ${new Date().toTimeString().slice(0, 5)}（本机）` : "没有保存成功，原记录未改变。请检查存储空间后重试。"); };
  const tabs: [Tab, string][] = [["plan", "课表"], ["during", "训练中"], ["after", "训练后"], ["later", "24–72h"]];
  const later = d.date >= today;
  return <Sheet full title={d.title} sub={`${md(d.date)} ${d.weekday} · ${d.week === "TEST" ? "最终测试" : d.week}`} label={`${md(d.date)} ${d.title} 训练详情`} onClose={onClose} footer={null}>
    <div data-testid="plan400-day-sheet">
      <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="sheet-status"><KindChip d={d} /><StatusChip s={status} /></div>
      <div className="sticky top-0 z-10 grid grid-cols-4 gap-1 rounded-xl bg-surface p-1" role="tablist" aria-label="训练详情分区">{tabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={"min-h-11 rounded-lg text-sm font-bold " + (tab === id ? "bg-accent text-accent-fg" : "text-muted")}>{label}</button>)}</div>
    <div className="space-y-3 pb-3 pt-3 text-sm">
      {moved ? <p className="rounded-xl border border-line bg-surface-2 p-3 text-sm" data-testid="v4-moved-history">{moved.label} · 此处保留原始课表及历史记录，不再从旧日期开始这项训练。</p> : null}
      <ComboStatus v={combo} />
      {!moved ? <GuidedLiveActions date={d.date} onClose={onClose} /> : null}
      {tab === "plan" ? <>
        <section className="home-card p-4"><h3 className="text-xs font-bold text-muted">{dayKind(d) === "rest" ? "休息日安排" : "正式主课 / 恢复课"}</h3><p className="mt-1 whitespace-pre-line leading-6">{joinLines(mainTrainingLines(d)) || "原课表未写"}</p></section>
        {d.aux.length ? <section className="home-card p-4"><h3 className="text-xs font-bold text-muted">辅助激活与技术</h3><p className="mt-1 leading-6">{joinLines(d.aux)}</p></section> : null}
        {d.strength.length ? <section className="home-card p-4"><h3 className="text-xs font-bold text-muted">力量与核心 · 原课表</h3><p className="mt-1 leading-6">{joinLines(d.strength)}</p>{moved ? <p className="text-xs text-muted">已调整到其他日期，原日期不可执行。</p> : <StrengthOverride d={d} />}</section> : null}
        {week ? <details className="home-card p-4"><summary className="min-h-10 cursor-pointer font-bold">本周原则</summary><p className="mt-1 leading-6 text-muted">{shiftedText(P(), week.week, week.principle)}</p></details> : null}
        <details className="home-card p-4"><summary className="min-h-10 cursor-pointer font-bold">原文与原日期（只读）</summary><p className="mt-1 text-xs text-muted">原课表日期 {d.orig || "未记录"} → 当前日程 {d.date}{d.orig && d.orig !== d.date ? `（顺延 ${Math.round((Date.parse(d.date) - Date.parse(d.orig)) / 864e5)} 天）` : ""}</p><pre className="mt-2 whitespace-pre-wrap break-words text-xs leading-5">{[...d.main, ...d.aux, ...d.strength].join("\n")}</pre></details>
      </> : null}
      {tab === "during" && moved ? <p className="home-card p-4 text-sm" data-testid="v4-moved-no-old-execution">{moved.label}，请到新日期执行；旧记录可在日志查看。</p> : null}
      {tab === "during" && !moved && combo.combo ? <>
        <section className="home-card space-y-3 p-4" aria-label="跑步实际记录" data-testid="during-running">
          <h3 className="font-bold">跑步部分</h3>
          <p className="keep text-sm text-muted">目标：{joinLines(mainTrainingLines(d)).split("\n")[0] || d.title}</p>
          <RunLinkPanel date={d.date} fallback={<DeviceRunList runs={combo.runs} />} />
          <LapSuggest d={d} onFill={(reps, rest) => setEdit(e => ({ ...e, reps, rest }))} />
          <SplitGrid d={d} value={edit.reps} logs={logs} onChange={(reps) => setEdit(e => ({ ...e, reps }))} />
          <Fields list={DURING.slice(0, 3)} value={edit} onChange={setEdit} />
          <button type="button" className="min-h-12 w-full rounded-xl bg-accent font-bold text-accent-fg" onClick={() => commit(["reps", "rest", "aux"])}>保存跑步记录</button>
        </section>
        <section className="home-card space-y-3 p-4" aria-label="力量实际记录" data-testid="during-strength">
          <h3 className="font-bold">力量部分</h3>
          <Fields list={DURING.slice(3)} value={edit} onChange={setEdit} />
          <button type="button" className="min-h-12 w-full rounded-xl border border-accent font-bold text-accent" onClick={() => commit(["strength"])}>保存力量记录</button>
        </section>
      </> : null}
      {tab === "during" && !moved && !combo.combo ? <section className="home-card space-y-3 p-4" aria-label="训练中记录">
        <p className="text-sm text-muted">目标：{joinLines(mainTrainingLines(d)).split("\n")[0] || d.title}</p>
        {/* 非组合的纯跑步课同样必须提供“关联手表记录”入口；原来仅组合课渲染 RunLinkPanel，导致首页待确认无法在详情完成。 */}
        {dayKind(d) !== "rest" && !/^力量/.test(d.title) ? <RunLinkPanel date={d.date} fallback={<DeviceRunList runs={combo.runs} />} /> : null}
        <SplitGrid d={d} value={edit.reps} logs={logs} onChange={(reps) => setEdit(e => ({ ...e, reps }))} />
        <Fields list={DURING} value={edit} onChange={setEdit} />
        <button type="button" className="min-h-12 w-full rounded-xl bg-accent font-bold text-accent-fg" onClick={() => commit(["reps", "rest", "aux", "strength"])}>保存本段记录</button>
      </section> : null}
      {tab === "after" && moved ? <p className="home-card p-4 text-sm">已改期，原日期只可查看旧评价；请到实际训练日期评分。</p> : null}
      {tab === "after" && !moved && combo.combo ? <><PartFeedbackForm date={d.date} part="running" name="跑步" />{hasStrength(d) ? <PartFeedbackForm date={d.date} part="strength" name="力量" /> : null}</> : null}
      {tab === "after" && combo.combo ? <LegacyReadOnly log={log} kind="after" /> : null}
      {tab === "after" && !moved && !combo.combo ? <section className="home-card space-y-3 p-4" aria-label="训练后反馈">
        <p className="text-xs font-bold text-muted">这节课的结果</p>
        <div className="grid grid-cols-3 gap-2">{([["done", "完成"], ["reduced", "减量完成"], ["skipped", "没练/取消"]] as const).map(([v, t]) => <button key={v} type="button" aria-pressed={edit.done === v} className={"min-h-11 rounded-xl border text-sm font-bold " + (edit.done === v ? "border-accent bg-accent/15 text-accent" : "border-line")} onClick={() => setEdit({ ...edit, done: edit.done === v ? undefined : v })}>{t}</button>)}</div>
        <Fields list={AFTER} value={edit} onChange={setEdit} />
        <button type="button" className="min-h-12 w-full rounded-xl bg-accent font-bold text-accent-fg" onClick={() => { if (edit.done === "skipped" && log.done !== "skipped" && !window.confirm("标记为没练/取消？原课表不会改动，之后可以改回。")) return; commit(["rpe", "pain", "note"], { done: edit.done ?? "" }); }}>保存训练后反馈</button>
      </section> : null}
      {tab === "later" && moved ? <p className="home-card p-4 text-sm">已改期；恢复反馈应关联真实执行日期，不在原日期新建。</p> : null}
      {tab === "later" && !moved ? <section className="home-card space-y-3 p-4" aria-label="恢复补录">
        {later ? <p className="rounded-xl bg-surface-2 p-2 text-xs text-muted">这节课还没过 24 小时，可以以后再填。</p> : null}
        {!later && recoveryTiming(d.date, today) === "late" ? <p className="keep rounded-xl bg-surface-2 p-2 text-xs text-muted">已超过 72 小时，现在填的是事后回忆，请按记得的情况写。</p> : null}
        <SharedSleep date={d.date} />
        {/* v83（P1-09）：组合课只用下面“跑步/力量分开的恢复”这一套；整课的 24h/48h 旧字段只读显示，不再让你填第二遍 */}
        {!combo.combo ? <><Fields list={LATER} value={edit} onChange={setEdit} />
        <button type="button" className="min-h-12 w-full rounded-xl border border-accent font-bold text-accent" onClick={() => commit(["r24", "r48"])}>保存恢复补录</button></> : null}
      </section> : null}
      {tab === "later" && combo.combo ? <LegacyReadOnly log={log} kind="later" /> : null}
      {tab === "later" && !moved && combo.combo && !later ? <RecoveryParts date={d.date} late={recoveryTiming(d.date, today) === "late"} daysSince={Math.round((Date.parse(today) - Date.parse(d.date)) / 864e5)} /> : null}
      {msg ? <p role="status" className="text-sm">{msg}</p> : log.savedAt ? <p className="text-xs text-muted">上次保存 {stampCN(log.savedAt, "ymd")}</p> : null}
    </div>
    </div>
  </Sheet>;
}
/** 全局只挂一次：首页卡、计划页、日历都通过事件打开同一个详情（同一日期 = 同一记录）。 */
export function Plan400DayHost({ today }: { today: string }) {
  const [open, setOpen] = useState<{ date: string; tab: Tab } | null>(null);
  useEffect(() => { const h = (e: Event) => { const v = (e as CustomEvent<{ date: string; tab?: Tab }>).detail; if (v?.date && dayOf(P(), v.date)) setOpen({ date: v.date, tab: v.tab ?? "plan" }); }; window.addEventListener(OPEN_EVT, h); return () => window.removeEventListener(OPEN_EVT, h); }, []);
  const d = open ? dayOf(P(), open.date) : undefined;
  return d && open ? <DaySheet key={open.date + open.tab} d={d} today={today} initialTab={open.tab} onClose={() => setOpen(null)} /> : null;
}

function summaryLines(d: V4Day): string[] {
  const k = dayKind(d), main = joinLines(mainTrainingLines(d)).split("\n")[0];
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
  usePlanRevision();
  const logs = useLogs(); const partsAll = usePartsAll();
  const [live, setLive] = useState(false);
  useEffect(() => { setLive(strengthLive(today)); }, [today, logs]);
  if (!today) return null;
  const d = dayOf(P(), today);
  if (!d) { const next = P().days.find((x) => x.date > today); return next ? <section className="home-card mb-3 p-4 text-sm" aria-label="训练计划"><p className="text-xs text-muted">{planLabel()}</p><p className="mt-1">今天不在计划日程内。下一节：{md(next.date)} {next.weekday}「{next.title}」</p><button type="button" className="mt-2 min-h-11 text-accent" onClick={() => openPlan400Day(next.date)}>查看 ›</button></section> : null; }
  const s = dayStatus(d, logs[d.date], today, live, partsAll[d.date]), cta = componentCta(d, logs[d.date], partsAll[d.date], s, live);
  const moved = v4MovedOut(d.date, loadSchedule().entries);
  const go = () => { if ((cta.action === "start" || cta.action === "continue") && d.date === today) { const detail = { date: d.date, handled: false }; window.dispatchEvent(new CustomEvent(PLAN400_GUIDED_EVT, { detail })); if (!detail.handled) openPlan400Day(d.date, "during"); } else if (cta.action === "start" || cta.action === "continue") openPlan400Day(d.date, "during"); else if (cta.action === "review" || cta.action === "reason" || cta.action === "backfill") openPlan400Day(d.date, "after"); else openPlan400Day(d.date, "plan"); };
  return <section className="home-card mb-3 p-4" aria-label="今日训练主卡" data-testid="today-main-card" data-status={s}>
    <div className="flex items-center justify-between gap-2"><p className="text-sm text-muted">今日训练</p><StatusChip s={s} /></div>
    <h2 className="mt-1 text-xl font-bold">{d.title}</h2>
    <p className="text-xs text-muted">{md(d.date)} {d.weekday} · <KindChip d={d} /></p>
    <ul className="mt-2 space-y-1 text-sm leading-6">{summaryLines(d).map((t, i) => <li key={i} className="line-clamp-2">{t}</li>)}</ul>
    <HomeComboLine d={d} log={logs[d.date]} />
    {moved ? <div className="mt-3 rounded-xl border border-line bg-surface-2 p-3 text-sm" data-testid="today-moved-status"><p>{moved.label} · 原日期不再待练</p><button type="button" className="mt-2 min-h-10 text-accent" onClick={() => openPlan400Day(d.date, "plan")}>查看原课表与改期历史 ›</button></div>
      : <button type="button" className="mt-3 min-h-12 w-full rounded-xl bg-accent text-base font-bold text-accent-fg" data-testid="today-primary-cta" onClick={go}>{cta.label}</button>}
    <div className="mt-1 flex flex-wrap gap-x-4 text-sm"><button type="button" className="min-h-11 text-accent" onClick={() => openPlan400Day(d.date, "plan")}>查看课表</button>{s === "done" || s === "reduced" ? <button type="button" className="min-h-11 text-muted" onClick={() => openPlan400Day(d.date, "later")}>恢复反馈</button> : null}{(s === "done" || s === "reduced") && onReview ? <button type="button" className="min-h-11 text-muted" onClick={onReview}>查看复盘</button> : null}</div>
    <PendingFeedbackList today={today} compact />
  </section>;
}

function DayRow({ d, today, logs, parts }: { d: V4Day; today: string; logs: Record<string, Log>; parts?: DayParts }) {
  const s = dayStatus(d, logs[d.date], today, false, parts), part = comboShort(d, logs[d.date], parts);
  const moved = v4MovedOut(d.date, loadSchedule().entries);
  return <button type="button" onClick={() => openPlan400Day(d.date)} className={"flex min-h-14 w-full items-center gap-2 border-t border-line py-2 text-left " + (d.date === today ? "rounded-lg bg-accent/10 px-2" : "")} aria-label={`${md(d.date)} ${d.weekday} ${d.title} ${STATUS_LABEL[s]}`}>
    <span className="w-[4.6rem] shrink-0 text-sm"><b>{md(d.date)}</b> <span className="text-muted">{d.weekday}</span></span>
    <span className="min-w-0 flex-1"><span className="block font-bold">{d.title}</span><span className="block text-xs text-muted">{KIND_LABEL[dayKind(d)]}{hasStrength(d) && dayKind(d) !== "rest" ? " + 力量" : ""}{d.date === today ? " · 今天" : ""}</span>{!moved && part ? <span className="mt-1 block text-xs text-muted" data-testid="v4-combo-parts">{part}</span> : null}</span>
    {moved ? <span className="text-xs text-muted" data-testid="v4-moved-row">{moved.label}</span> : <StatusChip s={s} />}<ChevronRight className="size-4 shrink-0 text-muted" />
  </button>;
}
/** 计划页：正式导入周期（V4）。当前周默认展开，其余周折叠，W1–W10 与最终测试全部可进入详情。 */
export function Plan400Cycle(props: { today: string; sourceSlot?: React.ReactNode; lens?: "run" | "lift" }) {
  usePlanRevision();
  return P().days.length ? <Plan400CycleView key={planLabel()} {...props} /> : props.lens === "lift" ? null : <NoPlanCard sourceSlot={props.sourceSlot} />;
}
function Plan400CycleView({ today, sourceSlot, lens = "run" }: { today: string; sourceSlot?: React.ReactNode; lens?: "run" | "lift" }) {
  const logs = useLogs(); const partsAll = usePartsAll();
  const [cycleExpanded, setCycleExpanded] = useState(() => { try { return localStorage.getItem("fk-v91-cycle-expanded") === "1" } catch { return false } });
  const toggleCycle = () => setCycleExpanded(v => { try { localStorage.setItem("fk-v91-cycle-expanded", v ? "0" : "1") } catch { /* UI remains usable */ } return !v; });
  const [showSource, setShowSource] = useState(false), [showDiff, setShowDiff] = useState(false);
  const [confirm, setConfirm] = useState(() => { migrateUserConfirmedDates(P()); return loadDateConfirm(P()); });
  const cw = currentWeek(P(), today);
  const [openWeeks, setOpenWeeks] = useState<string[]>([]);
  useEffect(() => { setOpenWeeks([cw]); }, [cw]);
  const counts = useMemo(() => progressCounts(P(), logs, partsAll), [logs, partsAll]);
  const conflicts = useMemo(() => dateConflicts(P()), []);
  const shift = shiftSummary(P());
  const finals = P().days.filter(d => d.week === "TEST");
  const filt = (ds: V4Day[]) => lens === "lift" ? ds.filter(hasStrength) : ds;
  return <section className="home-card fk-cycle-plan mb-3 p-4" aria-label="正在执行的周期计划" data-testid="plan400-cycle">
    <div className="flex items-center justify-between gap-3"><h2 className="font-bold">{cycleExpanded ? "周期安排" : "本周安排"}</h2><button type="button" className="flex min-h-11 shrink-0 items-center gap-1 text-sm text-accent" aria-expanded={cycleExpanded} data-testid="v91-cycle-toggle" onClick={toggleCycle}><span>{cycleExpanded ? "只看本周" : "全部周次"}</span><ChevronDown className={"size-4 transition-transform " + (cycleExpanded ? "rotate-180" : "")} /></button></div>
    {(conflicts.length || shift.shifted) && !confirm ? <div className="my-3 rounded-xl border border-warn/50 p-3 text-sm" role="status" data-testid="plan400-date-warning">
      <p className="flex gap-1.5 font-bold text-warn"><TriangleAlert className="mt-0.5 size-4 shrink-0" />日期待核对</p>
      <p className="mt-1 leading-6">{shift.shifted ? `日程整体顺延 ${shift.shiftDays} 天。` : "日程与原课表文字存在日期差异。"}请核对后再执行相关测试课。</p>
      <div className="flex flex-wrap gap-x-4"><button type="button" className="min-h-11 font-bold text-accent" onClick={() => { try { localStorage.removeItem(DATE_CONFIRM_KEY + ":revoked") } catch { /* ignore */ } setConfirm(saveDateConfirm(P(), "用户确认")); }}>按当前日期执行</button><button type="button" className="min-h-11 text-accent" aria-expanded={showDiff} onClick={() => setShowDiff(!showDiff)}>{showDiff ? "收起差异" : "查看差异"}</button></div>
      {showDiff ? <ul className="mt-1 space-y-1 leading-6">{conflicts.map(c => <li key={c.week + c.mentioned}>{c.week}：原课表周期 {c.originalRange}，当前日程 {c.shownRange}；标题/原则中的「{c.text}」{c.matchedDay ? ` 对应原日期 ${c.matchedDay.orig} 的「${c.matchedDay.title}」，现排在 ${md(c.matchedDay.date)} ${c.matchedDay.weekday}` : " 在日程中没有对应的课"}。</li>)}<li>全部 {shift.total} 个日程按原日期 +{shift.shiftDays} 天排入；最终测试原为 {P().final?.orig ?? "—"}，现为 {P().final?.date ?? "—"}。</li></ul> : null}
    </div> : null}
    <div>{P().weeks.filter(w => cycleExpanded || w.week === cw).map(w => { const ds = weekDays(P(), w.week); const shown = filt(ds); const isOpen = openWeeks.includes(w.week); if (lens === "lift" && !shown.length) return null;
      return <div key={w.week} className="border-t border-line first:border-t-0">
        <button type="button" aria-expanded={isOpen} onClick={() => setOpenWeeks(isOpen ? openWeeks.filter(x => x !== w.week) : [...openWeeks, w.week])} className="flex min-h-12 w-full items-center gap-2 py-2 text-left">
          <span className={"w-9 shrink-0 text-sm font-bold " + (w.week === cw ? "text-accent" : "")}>{w.week}</span>
          <span className="min-w-0 flex-1"><span className="block text-sm font-bold">{shiftedText(P(), w.week, w.title)}</span><span className="block text-xs text-muted">{ds.length ? `${md(ds[0].date)}—${md(ds[ds.length - 1].date)}` : "暂无日程"}{w.week === cw ? " · 本周" : ""}{!confirm && conflicts.some(c => c.week === w.week) ? " · 日期待核对" : ""}</span></span>
          <ChevronDown className={"size-4 shrink-0 text-muted transition-transform " + (isOpen ? "rotate-180" : "")} />
        </button>
        {isOpen ? <div className="pb-2">{shown.map(d => <DayRow key={d.date} d={d} today={today} logs={logs} parts={partsAll[d.date]} />)}</div> : null}
      </div>; })}
      {lens === "run" && (cycleExpanded || cw === "TEST") ? finals.map(d => <div key={d.date} className="border-t border-line"><DayRow d={d} today={today} logs={logs} parts={partsAll[d.date]} /></div>) : null}
    </div>
    <details className="mt-2 border-t border-line text-sm" onToggle={e => setShowSource(e.currentTarget.open)}>
      <summary className="flex min-h-11 cursor-pointer items-center justify-between text-muted">计划详情<ChevronRight className="size-4" /></summary>
      <h3 className="font-bold">{P().name}</h3>
      <p className="mt-2 text-sm text-muted" data-testid="plan400-progress">日程已记录 {counts.recordedDays}/{counts.calendarEntries} · 训练与测试已完成 {counts.completedTrainingDays}/{counts.trainingDays + counts.testDays}</p>
      {(conflicts.length || shift.shifted) && confirm ? <details className="mt-2 text-sm text-muted" data-testid="plan400-date-confirmed"><summary className="flex min-h-11 cursor-pointer list-none items-center gap-1">日期调整记录<ChevronRight className="size-3.5" /></summary>
        <p>已确认顺延 {shift.shiftDays} 天 · {confirm.by} · {stampCN(confirm.at, "ymd").slice(0, 10)}</p>
        <ul className="mt-1 space-y-1 leading-6">{conflicts.map(c => <li key={c.week + c.mentioned}>{c.week}：{c.originalRange} → {c.shownRange}；「{c.text}」{c.matchedDay ? `对应 ${md(c.matchedDay.date)} ${c.matchedDay.weekday}「${c.matchedDay.title}」` : "在日程中没有对应的课"}</li>)}<li>最终测试 {P().final?.date ?? "—"}（原 {P().final?.orig ?? "—"}）。</li></ul>
        <button type="button" className="min-h-11 text-accent" onClick={() => { clearDateConfirm(); try { localStorage.setItem(DATE_CONFIRM_KEY + ":revoked", "1") } catch { /* ignore */ } setConfirm(null); }}>撤销确认</button>
      </details> : null}
      {showSource && sourceSlot ? <div className="mt-3">{sourceSlot}</div> : null}
    </details>
  </section>;
}

type TempEntry = { id: string; date: string; title: string; minutes: number; source: string; status: string; unplanned?: boolean; modality: string; exercises?: unknown[] };
/** 临时 / 自建训练：与正式周期分开展示，只按真实 id 判断是否挂靠 V4。 */
export function TempTrainingList<E extends TempEntry>({ entries, modality, title, onOpen, onAdd, addLabel, empty, footer, today }: { entries: E[]; modality: "run" | "strength"; title: string; onOpen: (e: E) => void; onAdd: () => void; addLabel: string; empty: string; footer?: React.ReactNode; today?: string }) {
  // v83（P2-03）：正式周期（V4 当天课程 plan400:*）只在上方周期计划里出现；计划外记录（记一笔等 unplanned）在日志里，不算“排了的训练”
  const now = new Date(), day = today ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const list = entries.filter(e => e.modality === modality && ["planned", "done"].includes(e.status) && !String(e.id).startsWith("plan400:") && !(e as { unplanned?: boolean }).unplanned);
  const upcoming = list.filter(e => e.status === "planned" && e.date >= day).sort((a, b) => a.date.localeCompare(b.date));
  const past = list.filter(e => e.status === "planned" && e.date < day).sort((a, b) => b.date.localeCompare(a.date));
  const completed = list.filter(e => e.status === "done").sort((a, b) => b.date.localeCompare(a.date));
  const row = (e: E) => { const l = entryLinkFor(e); return <button type="button" key={e.id} className="flex min-h-16 w-full items-center justify-between gap-3 border-t border-line py-3 text-left" onClick={() => onOpen(e)}>
    <span className="min-w-0 flex-1"><b className="block">{e.title}</b><span className="mt-1 block text-sm text-muted">{e.date === day ? '今天' : md(e.date)} · {modality === "strength" ? `${e.exercises?.length ?? "—"}个动作` : `${e.minutes}分钟`} · {e.status === "done" ? "已完成" : "待执行"}</span>{l.sameDayV4 && e.status === "planned" ? <span className="mt-1 block text-xs text-warn">同日已有「{l.sameDayV4.title}」</span> : null}</span><ChevronRight className="size-4 shrink-0 text-muted" /></button>; };
  return <section className="home-card fk-scheduled-list mb-3 p-4" aria-label={title}>
    <div className="flex items-center justify-between gap-2"><h2 className="font-bold">{title}</h2><button type="button" className="min-h-11 shrink-0 px-1 text-sm font-bold text-accent" onClick={onAdd}>{addLabel}</button></div>
    {upcoming.map(row)}
    {!upcoming.length ? <p className="border-t border-line py-3 text-sm text-muted">{list.length ? "暂无即将进行的训练" : empty}</p> : null}
    {past.length ? <details className="border-t border-line"><summary className="flex min-h-12 cursor-pointer items-center justify-between text-sm"><span>往期安排 <span className="text-muted">{past.length}</span></span><ChevronDown className="size-4 text-muted" /></summary>{past.map(row)}</details> : null}
    {completed.length ? <details className="border-t border-line"><summary className="flex min-h-12 cursor-pointer items-center justify-between text-sm"><span>已完成 <span className="text-muted">{completed.length}</span></span><ChevronDown className="size-4 text-muted" /></summary>{completed.map(row)}</details> : null}
    {footer}
  </section>;
}
function entryLinkFor(e: TempEntry) { return entryLink(P(), e); }
