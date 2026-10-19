import { garminViewKey, garminScopeKey, garminViewScope } from '@/lib/health/garmin-view-scope';
import { garminAccount } from '@/lib/health/garmin-sync-runner';
import { shortHash } from '@/lib/health/observation';
import { currentStore } from '@/lib/core/storage';
import { currentAthleteId } from '@/lib/core/events';
import { useEffect, useMemo, useState } from "react";
import { fmtDistance, fmtDuration, fmtPace, parseActivityTime } from "@/lib/ui/activity-format";
import { Dumbbell, Footprints, Activity } from "lucide-react";

export const GACTS_KEY = "fk-garmin-acts-v1";
export const GLAPS_KEY = "fk-garmin-laps-v1";
type G = { sourceIdentity?: string; id: number; name: string; type: string; start: string; dist: number | null; dur: number | null; avgHr: number | null; maxHr: number | null; cad: number | null; elev: number | null; cal: number | null; sets: number | null; reps: number | null; tl: number | null; te: number | null; ate?: number | null; rpe?: number | null; vo2?: number | null; vr?: number | null };
type Lap = { i: number; dist: number | null; dur: number | null; avgHr: number | null; maxHr: number | null; cad: number | null; elev: number | null; speed: number | null };
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const load = <T,>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(k) || "") as T; } catch { return d; } };

export function saveGarminActivities(list: unknown[], accountScope?: string): void {
  const key = accountScope ? `${GACTS_KEY}:${encodeURIComponent(currentAthleteId())}:${accountScope}` : garminViewKey(GACTS_KEY);
  const have = load<Record<string, G>>(key, {});
  for (const o of list as Record<string, any>[]) {
    if (!o?.activityId) continue;
    have[o.activityId] = { id: o.activityId, sourceIdentity: o.fkSourceIdentity, name: o.activityName ?? "", type: o.activityType?.typeKey ?? "", start: o.fkStartIso ?? o.startTimeLocal ?? o.startTimeGMT ?? "", dist: num(o.distance), dur: num(o.duration), avgHr: num(o.averageHR), maxHr: num(o.maxHR), cad: num(o.averageRunningCadenceInStepsPerMinute), elev: num(o.elevationGain), cal: num(o.calories), sets: num(o.totalSets) ?? num(o.activeSets), reps: num(o.totalReps), tl: num(o.activityTrainingLoad), te: num(o.aerobicTrainingEffect), ate: num(o.anaerobicTrainingEffect), rpe: num(o.directWorkoutRpe), vo2: num(o.vO2MaxValue), vr: num(o.avgVerticalRatio) };
  }
  const raw = JSON.stringify(have);
  localStorage.setItem(key, raw);
  if(localStorage.getItem(key) !== raw) throw Error('ACTIVITY_VIEW_SAVE_FAILED');
  if(accountScope) currentStore()?.setItem(garminScopeKey(), accountScope);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('fk-training-activities-changed'));
}
export const kindOf = (t: string) => /run|track|treadmill/.test(t) ? "run" : /strength|fitness|weight|hiit|training/.test(t) ? "strength" : "other";
const fmtDur = (s: number | null) => fmtDuration(s);
const pace = (dist: number | null, dur: number | null) => fmtPace(dist, dur);
const km = (m: number | null) => fmtDistance(m);
function weekKey(iso: string) { const d = new Date(iso.slice(0, 10) + "T00:00:00Z"); const wd = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - wd); return d.toISOString().slice(0, 10); }

export async function fetchLaps(id: number): Promise<Lap[] | null> {
  const subject = currentAthleteId(), scope = garminViewScope();
  if(!scope) return null; // Unbound legacy records cannot query the current account.
  const same = async () => {
    const r = await fetch('/api/garmin/status', { credentials: 'same-origin' });
    const account = garminAccount({status:r.status, body:await r.json()});
    return subject===currentAthleteId() && scope===garminViewScope() && account && shortHash(account.scope)===scope;
  };
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 20000);
  try {
    if(!await same()) return null;
    const r = await fetch(`/api/garmin/g/activity-service/activity/${id}/splits`, { credentials: "same-origin", signal: ac.signal });
    if (!r.ok) return null; const b = await r.json(); if(!await same()) return null;
    return (Array.isArray(b?.lapDTOs) ? b.lapDTOs : []).map((l: Record<string, unknown>, i: number) => ({ i: i + 1, dist: num(l.distance), dur: num(l.duration), avgHr: num(l.averageHR), maxHr: num(l.maxHR), cad: num(l.averageRunCadence), elev: num(l.elevationGain), speed: num(l.averageSpeed) }));
  } catch { return null; } finally { clearTimeout(t); }
}

export const garminById = (id: number | string): G | null => load<Record<string, G>>(garminViewKey(GACTS_KEY), {})[String(id)] ?? null;
const localStamp = (iso: string) => { const d = parseActivityTime(iso) ?? new Date(NaN); return Number.isFinite(d.getTime()) ? `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : iso.slice(5, 16).replace('T', ' ') };
const localDate = (iso: string) => { const d = parseActivityTime(iso) ?? new Date(NaN); return Number.isFinite(d.getTime()) ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : iso.slice(0, 10) };
export function GarminActivityRow({ g, defaultOpen = false, detailOnly = false }: { g: G; defaultOpen?: boolean; detailOnly?: boolean }) { return <Row g={g} defaultOpen={defaultOpen} detailOnly={detailOnly} /> }
function Row({ g, defaultOpen = false, detailOnly = false }: { g: G; defaultOpen?: boolean; detailOnly?: boolean }) {
  const [open, setOpen] = useState(defaultOpen || detailOnly);
  const [laps, setLaps] = useState<Lap[] | null>(() => load<Record<string, Lap[]>>(garminViewKey(GLAPS_KEY), {})[g.id] ?? null);
  const [state, setState] = useState("");
  const k = kindOf(g.type); const Icon = k === "run" ? Footprints : k === "strength" ? Dumbbell : Activity;
  useEffect(() => { if (!open || laps || k === "strength") return; setState("加载分段…"); void fetchLaps(g.id).then((l) => { if (l) { const all = load<Record<string, Lap[]>>(garminViewKey(GLAPS_KEY), {}); all[g.id] = l; localStorage.setItem(garminViewKey(GLAPS_KEY), JSON.stringify(all)); setLaps(l); setState(""); } else setState("分段获取失败（需在健康页登录佳明）"); }); }, [open]);
  const metrics = k === "strength" ? [fmtDur(g.dur), g.sets != null ? `${g.sets} 组` : null, g.reps != null ? `${g.reps} 次` : null, g.avgHr ? `♥${Math.round(g.avgHr)}` : null] : [km(g.dist), fmtDur(g.dur), pace(g.dist, g.dur), g.avgHr ? `♥${Math.round(g.avgHr)}` : null];
  const Wrap = detailOnly ? "div" : "li";
  return <Wrap className={detailOnly ? "" : "border-b border-line last:border-b-0"}>
    {detailOnly ? null : <button type="button" aria-expanded={open} className="flex min-h-14 w-full items-center gap-3 py-2 text-left" onClick={() => setOpen(!open)}>
      <span className={"grid size-9 shrink-0 place-items-center rounded-full " + (k === "strength" ? "bg-amber-100 text-amber-700" : "bg-sky-100 text-sky-700")}><Icon className="size-5" /></span>
      <span className="min-w-0 flex-1"><span className="block truncate font-bold">{g.name || (k === "strength" ? "力量训练" : "跑步")}</span><span className="keep block truncate text-xs text-muted">{localStamp(g.start)} · 佳明</span><span className="keep block truncate text-xs">{k === "strength" ? [fmtDur(g.dur), g.sets != null ? `${g.sets} 组` : null].filter(Boolean).join(" · ") : `${km(g.dist) ?? "距离—"} · ${fmtDur(g.dur)}`}{g.avgHr || k !== "strength" ? <span className="text-muted">{k !== "strength" ? ` · 配速 ${pace(g.dist, g.dur) ?? "—"}` : ""}{g.avgHr ? ` · 心率 ${Math.round(g.avgHr)} 次/分` : ""}</span> : null}</span></span>
      <span className="text-muted" aria-hidden="true">{open ? "▾" : "›"}</span>
    </button>}
    {open ? <div className="mb-3 rounded-card bg-surface p-3 text-sm">
      <div className="grid grid-cols-3 gap-2">
        {([["距离", km(g.dist)], ["时长", fmtDur(g.dur)], ["配速", pace(g.dist, g.dur)], ["平均心率", g.avgHr && Math.round(g.avgHr)], ["最大心率", g.maxHr && Math.round(g.maxHr)], ["步频", g.cad && Math.round(g.cad)], ["爬升", g.elev != null ? `${Math.round(g.elev)} m` : null], ["热量", g.cal && Math.round(g.cal)], ["训练负荷", g.tl && Math.round(g.tl)], ["有氧效果", g.te], ["组数", g.sets], ["次数", g.reps]] as [string, unknown][]).filter(([, v]) => v != null && v !== "—" && v !== 0).map(([l, v]) => <div key={l}><div className="text-xs text-muted">{l}</div><div className="font-bold">{String(v)}</div></div>)}
      </div>
      {state ? <p className="keep mt-2 text-xs text-muted">{state}</p> : null}
      {laps && laps.length ? <table className="mt-3 w-full text-xs"><thead><tr className="text-muted"><th className="text-left">圈</th><th>距离</th><th>用时</th><th>配速</th><th>心率</th><th>步频</th></tr></thead><tbody>{laps.map((l) => <tr key={l.i} className="text-center"><td className="text-left">{l.i}</td><td>{km(l.dist)}</td><td>{fmtDur(l.dur)}</td><td>{pace(l.dist, l.dur) ?? "—"}</td><td>{l.avgHr ? Math.round(l.avgHr) : "—"}</td><td>{l.cad ? Math.round(l.cad) : "—"}</td></tr>)}</tbody></table> : null}
    </div> : null}
  </Wrap>;
}

export function GarminLog({ range }: { range?: { start: string; end: string } } = {}) {
  const [n, setN] = useState(10);
  const [revision, setRevision] = useState(0);
  useEffect(() => { const refresh = () => setRevision(n => n + 1); window.addEventListener('fk-training-activities-changed', refresh); window.addEventListener('storage', refresh); return () => { window.removeEventListener('fk-training-activities-changed', refresh); window.removeEventListener('storage', refresh); }; }, []);
  const acts = useMemo(() => Object.values(load<Record<string, G>>(garminViewKey(GACTS_KEY), {})).sort((a, b) => b.start.localeCompare(a.start)), [revision]);
  if (!acts.length) return null;
  const shown = acts.slice(0, n); const weeks = new Map<string, G[]>();
  for (const g of shown) { const w = localDate(g.start); weeks.set(w, [...(weeks.get(w) ?? []), g]); }
  const inRange = range ? acts.filter(g => { const d = localDate(g.start); return d >= range.start && d <= range.end }).length : null;
  return <section className="text-sm" aria-label="佳明活动">
    <p className="keep text-xs text-muted">共 {acts.length} 条{inRange != null && range ? ` · ${range.start.slice(5)}–${range.end.slice(5)} 有 ${inRange} 条` : ""} · 按开始时间的本地日期分组</p>
    {[...weeks].map(([w, list]) => <div key={w} className="mt-2"><h3 className="keep text-xs font-bold text-muted">{w.slice(5)} · {list.length} 条</h3><ul>{list.map((g) => <Row key={garminViewKey(GACTS_KEY)+g.id} g={g} />)}</ul></div>)}
    {n < acts.length ? <button type="button" className="mt-3 min-h-11 w-full rounded-card border border-line font-bold" onClick={() => setN(n + 20)}>展开更多（还有 {acts.length - n}）</button> : null}
  </section>;
}
