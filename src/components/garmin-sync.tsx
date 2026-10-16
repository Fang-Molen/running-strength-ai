import { useEffect, useRef, useState } from "react";
import { saveDeviceRows } from "@/lib/ui/device-store";
import { activityKey, type DeviceActivity, type DeviceHealthRow } from "@/lib/ui/device-parse";
import { exportVault, importVault, listSnapshots, restoreSnapshot, needsBackupReminder, type Snapshot } from "@/lib/vault";
import { exportFeedback } from "@/components/coach-feedback";
import { saveGarminActivities } from "@/components/garmin-log";

const api = async (p: string, init?: RequestInit, ms = 20000) => {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(`/api/garmin/${p}`, { credentials: "same-origin", signal: ac.signal, ...init }); return { status: r.status, body: await r.json().catch(() => ({})) }; }
  catch { return { status: 0, body: { ok: false, message: "请求超时或网络中断" } }; } finally { clearTimeout(t); }
};
const day = (d: number) => new Date(Date.now() + 8 * 3600e3 - d * 86400e3).toISOString().slice(0, 10);
function sport(k: string): [DeviceActivity["sport"], string] { k = k.toLowerCase(); if (/run|track|treadmill/.test(k)) return ["RUNNING", "跑步"]; if (/strength|fitness|training|weight|hiit|indoor_cardio/.test(k)) return ["STRENGTH", "力量"]; return ["UNKNOWN", k || "其他"]; }

export function GarminSync() {
  const [st, setSt] = useState<{ loggedIn: boolean; profile?: { displayName?: string; fullName?: string } | null } | null>(null);
  const [form, setForm] = useState({ region: "cn", username: "", password: "" });
  const [mfa, setMfa] = useState<string | null>(null); const [code, setCode] = useState("");
  const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [remind, setRemind] = useState(false);
  useEffect(() => { void listSnapshots().then(setSnaps).catch(() => {}); const last = localStorage.getItem("fk-last-export"); setRemind(needsBackupReminder() || !last || Date.now() - Date.parse(last) > 14 * 86400e3); }, []);
  const refresh = () => api("status").then((r) => setSt(r.body)).catch(() => setSt({ loggedIn: false }));
  useEffect(() => { void refresh(); }, []);
  async function login() {
    setBusy(true); setMsg("");
    const r = await api("login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
    setForm((f) => ({ ...f, password: "" }));
    if (r.body.mfa) { setMfa(r.body.state); setMsg("佳明发了验证码，请输入"); }
    else if (r.body.ok) { setMsg("已登录"); await refresh(); } else setMsg(r.body.message || "登录失败");
    setBusy(false);
  }
  async function sendMfa() {
    setBusy(true); const r = await api("mfa", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ state: mfa, code }) });
    if (r.body.ok) { setMfa(null); setMsg("已登录"); await refresh(); } else setMsg(r.body.message || "验证失败"); setBusy(false);
  }
  async function sync() {
    setBusy(true); setMsg("同步中…");
    try {
      const acts: DeviceActivity[] = []; const health: DeviceHealthRow[] = [];
      const a = await api("g/activitylist-service/activities/search/activities?start=0&limit=200");
      if (a.status === 401) { setMsg("登录过期，请重新登录"); await refresh(); return; }
      if (!Array.isArray(a.body)) { setMsg(`活动列表获取失败：${a.body?.message || "HTTP " + a.status}`); return; }
      setMsg(`已取到 ${a.body.length} 条活动，正在取健康数据…`);
      saveGarminActivities(a.body);
      for (const o of Array.isArray(a.body) ? a.body : []) {
        const [sp, label] = sport(o.activityType?.typeKey ?? "");
        const startIso = o.startTimeGMT ? new Date(o.startTimeGMT.replace(" ", "T") + "Z").toISOString() : null;
        const dur = typeof o.duration === "number" ? Math.round(o.duration) : null; const dist = typeof o.distance === "number" && o.distance > 0 ? Math.round(o.distance) : null;
        acts.push({ key: activityKey(startIso, dist, dur), source: "佳明账号同步", sport: sp, sportLabel: label, startIso, durationSec: dur, distanceM: dist, avgHr: o.averageHR ? Math.round(o.averageHR) : null, maxHr: o.maxHR ? Math.round(o.maxHR) : null, calories: o.calories ? Math.round(o.calories) : null, avgCadence: o.averageRunningCadenceInStepsPerMinute ? Math.round(o.averageRunningCadenceInStepsPerMinute) : null, avgPower: o.avgPower ?? null, verticalOscMm: o.avgVerticalOscillation ? Math.round(o.avgVerticalOscillation * 10) : null, groundContactMs: o.avgGroundContactTime ? Math.round(o.avgGroundContactTime) : null, sets: [] });
      }
      const who = st?.profile?.displayName;
      let fails = 0;
      for (let i = 0; i < 14 && who; i++) {
        const d = day(i); const src = "佳明账号同步"; setMsg(`已取到 ${acts.length} 条活动 · 健康数据 ${i + 1}/14 天…`);
        const [s, h, sl] = await Promise.all([api(`g/usersummary-service/usersummary/daily/${encodeURIComponent(who)}?calendarDate=${d}`), api(`g/hrv-service/hrv/${d}`), api(`g/wellness-service/wellness/dailySleepData/${encodeURIComponent(who)}?date=${d}`)]);
        if (s.status !== 200) fails++;
        if (typeof s.body?.restingHeartRate === "number") health.push({ key: `RHR:${d}`, source: src, metric: "RHR", day: d, value: s.body.restingHeartRate });
        if (typeof s.body?.bodyBatteryHighestValue === "number") health.push({ key: `BODY_BATTERY:${d}`, source: src, metric: "BODY_BATTERY", day: d, value: s.body.bodyBatteryHighestValue });
        if (typeof s.body?.averageStressLevel === "number" && s.body.averageStressLevel >= 0) health.push({ key: `STRESS:${d}`, source: src, metric: "STRESS", day: d, value: s.body.averageStressLevel });
        if (typeof s.body?.totalSteps === "number" && s.body.totalSteps > 0) health.push({ key: `STEPS:${d}`, source: src, metric: "STEPS", day: d, value: s.body.totalSteps });
        if (typeof s.body?.averageSpo2 === "number" && s.body.averageSpo2 > 0) health.push({ key: `SPO2:${d}`, source: src, metric: "SPO2", day: d, value: s.body.averageSpo2 });
        if (typeof s.body?.avgWakingRespirationValue === "number" && s.body.avgWakingRespirationValue > 0) health.push({ key: `RESP:${d}`, source: src, metric: "RESP", day: d, value: s.body.avgWakingRespirationValue });
        const hv = h.body?.hrvSummary?.lastNightAvg;
        if (typeof hv === "number") health.push({ key: `HRV:${d}`, source: src, metric: "HRV", day: d, value: hv });
        const secs = sl.body?.dailySleepDTO?.sleepTimeSeconds;
        if (typeof secs === "number" && secs > 0) health.push({ key: `SLEEP:${d}`, source: src, metric: "SLEEP", day: d, value: Math.round(secs / 360) / 10 });
      }
      const r = saveDeviceRows(health, acts);
      localStorage.setItem("fk-garmin-last-sync", new Date().toISOString());
      setMsg(`同步完成 新增 ${r.saved} 条`);
    } catch (e) { setMsg("同步失败：" + String((e as Error)?.message || e)); } finally { setBusy(false); }
  }
  const input = "min-h-11 w-full rounded-card border border-line bg-surface px-3";
  return <section className="home-card mx-3 my-3 space-y-2 p-4 text-sm" id="garmin-sync">
    <h2 className="font-bold">佳明账号同步</h2>
    {st?.loggedIn ? <>
      <p className="text-muted">已登录 {st.profile?.fullName || st.profile?.displayName || ""} · 上次同步 {localStorage.getItem("fk-garmin-last-sync")?.slice(0, 16).replace("T", " ") ?? "无"}</p>
      <div className="flex gap-2"><button type="button" disabled={busy} className="min-h-11 flex-1 rounded-card bg-accent font-bold text-accent-fg" onClick={sync}>同步最近活动和健康数据</button><button type="button" className="min-h-11 rounded-card border border-line px-3" onClick={async () => { await api("logout"); await refresh(); }}>退出</button></div>
    </> : mfa ? <div className="flex gap-2"><input className={input} inputMode="numeric" placeholder="验证码" value={code} onChange={(e) => setCode(e.target.value)} /><button type="button" disabled={busy} className="rounded-card bg-accent px-4 font-bold text-accent-fg" onClick={sendMfa}>确认</button></div> : <>
      <select className={input} value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })}><option value="cn">佳明中国（garmin.cn）</option><option value="com">佳明国际（garmin.com）</option></select>
      <input className={input} autoComplete="username" placeholder="佳明账号（邮箱/手机）" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
      <input className={input} type="password" autoComplete="current-password" placeholder="密码" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
      <button type="button" disabled={busy || !form.username || !form.password} className="min-h-11 w-full rounded-card bg-accent font-bold text-accent-fg" onClick={login}>登录佳明</button>
    </>}
    {msg ? <p className="text-accent">{msg}</p> : null}
    <h2 className="pt-2 font-bold">全部数据备份</h2>
    
    {remind ? <p className="rounded-card bg-accent/10 p-2 text-accent">建议现在导出一份备份{needsBackupReminder() ? "（版本大更新）" : ""}</p> : null}
    <div className="grid grid-cols-3 gap-2">
      <button type="button" className="min-h-11 rounded-card border border-line" onClick={() => { void exportVault(); setRemind(false); }}>一键导出</button>
      <button type="button" className="min-h-11 rounded-card border border-line" onClick={() => file.current?.click()}>导入恢复</button>
      <button type="button" className="min-h-11 rounded-card border border-line" onClick={exportFeedback}>导出反馈</button>
    </div>
    {snaps.length ? <details><summary className="min-h-10 cursor-pointer">自动快照（{snaps.length}/7）</summary>{[...snaps].reverse().map((x) => <div key={x.at} className="flex items-center justify-between py-1"><span>{x.at.slice(0, 16).replace("T", " ")}</span><button type="button" className="underline" onClick={async () => { if (!confirm("用这份快照覆盖恢复？")) return; const n = await restoreSnapshot(x.at); setMsg(`已恢复 ${n} 项，正在刷新`); setTimeout(() => location.reload(), 800); }}>恢复</button></div>)}</details> : null}
    <input ref={file} type="file" accept="application/json,.json" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { const n = await importVault(f); setMsg(`已恢复 ${n} 项，正在刷新`); setTimeout(() => location.reload(), 800); } catch (err) { setMsg(String((err as Error).message)); } }} />
  </section>;
}
