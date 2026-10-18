import { garminViewKey, garminScopeKey, garminViewScope } from '@/lib/health/garmin-view-scope';
import { garminAccount } from '@/lib/health/garmin-sync-runner';
import { shortHash } from '@/lib/health/observation';
import { currentStore } from '@/lib/core/storage';
import { currentAthleteId } from '@/lib/core/events';
import { useEffect, useMemo, useState } from "react";
import { Dumbbell, Footprints, Activity } from "lucide-react";

export const GACTS_KEY = "fk-garmin-acts-v1";
export const GLAPS_KEY = "fk-garmin-laps-v1";
type G = { sourceIdentity?: string; id: number; name: string; type: string; start: string; dist: number | null; dur: number | null; avgHr: number | null; maxHr: number | null; cad: number | null; elev: number | null; cal: number | null; sets: number | null; reps: number | null; tl: number | null; te: number | null };
type Lap = { i: number; dist: number | null; dur: number | null; avgHr: number | null; maxHr: number | null; cad: number | null; elev: number | null; speed: number | null };
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const load = <T,>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(k) || "") as T; } catch { return d; } };

export function saveGarminActivities(list: unknown[], accountScope?: string): void {
  const key = accountScope ? `${GACTS_KEY}:${encodeURIComponent(currentAthleteId())}:${accountScope}` : garminViewKey(GACTS_KEY);
  const have = load<Record<string, G>>(key, {});
  for (const o of list as Record<string, any>[]) {
    if (!o?.activityId) continue;
    have[o.activityId] = { id: o.activityId, sourceIdentity: o.fkSourceIdentity, name: o.activityName ?? "", type: o.activityType?.typeKey ?? "", start: o.fkStartIso ?? o.startTimeLocal ?? o.startTimeGMT ?? "", dist: num(o.distance), dur: num(o.duration), avgHr: num(o.averageHR), maxHr: num(o.maxHR), cad: num(o.averageRunningCadenceInStepsPerMinute), elev: num(o.elevationGain), cal: num(o.calories), sets: num(o.totalSets) ?? num(o.activeSets), reps: num(o.totalReps), tl: num(o.activityTrainingLoad), te: num(o.aerobicTrainingEffect) };
  }
  const raw = JSON.stringify(have);
  localStorage.setItem(key, raw);
  if(localStorage.getItem(key) !== raw) throw Error('ACTIVITY_VIEW_SAVE_FAILED');
  if(accountScope) currentStore()?.setItem(garminScopeKey(), accountScope);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('fk-training-activities-changed'));
}
export const kindOf = (t: string) => /run|track|treadmill/.test(t) ? "run" : /strength|fitness|weight|hiit|training/.test(t) ? "strength" : "other";
const fmtDur = (s: number | null) => s == null ? "—" : `${Math.floor(s / 3600) ? Math.floor(s / 3600) + ":" : ""}${String(Math.floor((s % 3600) / 60)).padStart(Math.floor(s / 3600) ? 2 : 1, "0")}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const pace = (dist: number | null, dur: number | null) => !dist || !dur ? null : (() => { const p = dur / (dist / 1000); return `${Math.floor(p / 60)}'${String(Math.round(p % 60)).padStart(2, "0")}"/km`; })();
const km = (m: number | null) => m == null ? null : m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
function weekKey(iso: string) { const d = new Date(iso.slice(0, 10) + "T00:00:00Z"); const wd = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - wd); return d.toISOString().slice(0, 10); }

async function fetchLaps(id: number): Promise<Lap[] | null> {
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

function Row({ g }: { g: G }) {
  const [open, setOpen] = useState(false);
  const [laps, setLaps] = useState<Lap[] | null>(() => load<Record<string, Lap[]>>(garminViewKey(GLAPS_KEY), {})[g.id] ?? null);
  const [state, setState] = useState("");
  const k = kindOf(g.type); const Icon = k === "run" ? Footprints : k === "strength" ? Dumbbell : Activity;
  useEffect(() => { if (!open || laps || k === "strength") return; setState("加载分段…"); void fetchLaps(g.id).then((l) => { if (l) { const all = load<Record<string, Lap[]>>(garminViewKey(GLAPS_KEY), {}); all[g.id] = l; localStorage.setItem(garminViewKey(GLAPS_KEY), JSON.stringify(all)); setLaps(l); setState(""); } else setState("分段获取失败（需在健康页登录佳明）"); }); }, [open]);
  const metrics = k === "strength" ? [fmtDur(g.dur), g.sets != null ? `${g.sets} 组` : null, g.reps != null ? `${g.reps} 次` : null, g.avgHr ? `♥${Math.round(g.avgHr)}` : null] : [km(g.dist), fmtDur(g.dur), pace(g.dist, g.dur), g.avgHr ? `♥${Math.round(g.avgHr)}` : null];
  return <li className="border-b border-line">
    <button type="button" className="flex min-h-14 w-full items-center gap-3 py-2 text-left" onClick={() => setOpen(!open)}>
      <span className={"grid size-9 shrink-0 place-items-center rounded-full " + (k === "strength" ? "bg-amber-100 text-amber-700" : "bg-sky-100 text-sky-700")}><Icon className="size-5" /></span>
      <span className="min-w-0 flex-1"><span className="block truncate font-bold">{g.name || (k === "strength" ? "力量训练" : "跑步")}</span><span className="block truncate text-xs text-muted">{g.start.slice(5, 16).replace("T", " ")} · {metrics.filter(Boolean).join(" · ")}</span></span>
    </button>
    {open ? <div className="mb-3 rounded-card bg-surface p-3 text-sm">
      <div className="grid grid-cols-3 gap-2">
        {([["距离", km(g.dist)], ["时长", fmtDur(g.dur)], ["配速", pace(g.dist, g.dur)], ["平均心率", g.avgHr && Math.round(g.avgHr)], ["最大心率", g.maxHr && Math.round(g.maxHr)], ["步频", g.cad && Math.round(g.cad)], ["爬升", g.elev != null ? `${Math.round(g.elev)} m` : null], ["热量", g.cal && Math.round(g.cal)], ["训练负荷", g.tl && Math.round(g.tl)], ["有氧效果", g.te], ["组数", g.sets], ["次数", g.reps]] as [string, unknown][]).filter(([, v]) => v != null && v !== "—" && v !== 0).map(([l, v]) => <div key={l}><div className="text-xs text-muted">{l}</div><div className="font-bold">{String(v)}</div></div>)}
      </div>
      {state ? <p className="keep mt-2 text-xs text-muted">{state}</p> : null}
      {laps && laps.length ? <table className="mt-3 w-full text-xs"><thead><tr className="text-muted"><th className="text-left">圈</th><th>距离</th><th>用时</th><th>配速</th><th>心率</th><th>步频</th></tr></thead><tbody>{laps.map((l) => <tr key={l.i} className="text-center"><td className="text-left">{l.i}</td><td>{km(l.dist)}</td><td>{fmtDur(l.dur)}</td><td>{pace(l.dist, l.dur) ?? "—"}</td><td>{l.avgHr ? Math.round(l.avgHr) : "—"}</td><td>{l.cad ? Math.round(l.cad) : "—"}</td></tr>)}</tbody></table> : null}
    </div> : null}
  </li>;
}

export function GarminLog() {
  const [n, setN] = useState(10);
  const [revision, setRevision] = useState(0);
  useEffect(() => { const refresh = () => setRevision(n => n + 1); window.addEventListener('fk-training-activities-changed', refresh); window.addEventListener('storage', refresh); return () => { window.removeEventListener('fk-training-activities-changed', refresh); window.removeEventListener('storage', refresh); }; }, []);
  const acts = useMemo(() => Object.values(load<Record<string, G>>(garminViewKey(GACTS_KEY), {})).sort((a, b) => b.start.localeCompare(a.start)), [revision]);
  if (!acts.length) return null;
  const shown = acts.slice(0, n); const weeks = new Map<string, G[]>();
  for (const g of shown) { const w = weekKey(g.start); weeks.set(w, [...(weeks.get(w) ?? []), g]); }
  return <section className="home-card mx-3 mb-3 p-4" aria-label="佳明活动">
    <h2 className="font-bold">佳明活动 · {acts.length}</h2>
    {[...weeks].map(([w, list], i) => <details key={w} open={i < 2} className="mt-2"><summary className="min-h-10 cursor-pointer text-sm font-bold text-muted">{w.slice(5)} 这周 · {list.length} 条活动记录{(() => { const d = list.reduce((s, g) => s + (kindOf(g.type) === "run" ? g.dist ?? 0 : 0), 0); return d ? ` · 跑 ${km(d)}` : ""; })()}</summary><ul>{list.map((g) => <Row key={garminViewKey(GACTS_KEY)+g.id} g={g} />)}</ul></details>)}
    {n < acts.length ? <button type="button" className="mt-3 min-h-11 w-full rounded-card border border-line font-bold" onClick={() => setN(n + 20)}>展开更多（还有 {acts.length - n}）</button> : null}
  </section>;
}
