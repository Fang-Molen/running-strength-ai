import { runGarminSyncJob, garminStorageKey } from "@/lib/health/garmin-sync-runner";
import { currentAthleteId } from "@/lib/core/events";
import { bindGarminAccount } from "@/lib/health/garmin-account-owner";
import { localDay, shiftDay, healthChanged } from "@/lib/health/observation";
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
let running = false;
let accountGeneration = 0;
export async function runGarminSync(setMsg: (s: string) => void, _whoIn?: string): Promise<"ok" | "partial" | "auth" | "fail" | "busy"> {
  if (running) return "busy";
  running = true;
  try {
    const result = await runGarminSyncJob({ api, subject: currentAthleteId, generation: () => accountGeneration,
      day: localDay(), now: new Date().toISOString(), progress: setMsg,
      save: saveDeviceRows, saveView: saveGarminActivities, bindAccount: bindGarminAccount,
      report: report => {
        const key = (name: string) => garminStorageKey(name, report.subjectId);
        const raw = JSON.stringify(report);
        localStorage.setItem(key("fk-garmin-last-attempt"), report.at);
        localStorage.setItem(key("fk-garmin-sync-report"), raw);
        if (localStorage.getItem(key("fk-garmin-sync-report")) !== raw) throw Error('REPORT_SAVE_FAILED');
        if (report.status === 'ok') localStorage.setItem(key("fk-garmin-last-sync"), report.at);
        healthChanged(); window.dispatchEvent(new Event("fk-garmin-synced"));
      },
    });
    const label = { ok: '同步完成', partial: '部分同步', empty: '本次未取得可用记录', auth: '登录失效或身份不完整', fail: '同步失败', stale: '账号或运动员变化，已丢弃本次结果' }[result.status];
    setMsg(`${label}：保存/更新 ${result.saved} 条，未变化 ${result.skipped} 条。${result.errors.slice(0, 2).join('；')}`);
    return result.status === 'empty' || result.status === 'stale' ? 'fail' : result.status;
  } finally { running = false; }
}
const syncKey = (key: string) => garminStorageKey(key, currentAthleteId());
const AUTO_MS = 5 * 60e3;
let lastTry = 0;
/** 每次打开/回到前台（距上次 >5 分钟）+ 开着时每 2 小时：已登录、在线才静默同步；失败后 30 分钟内不重试。 */
export async function maybeAutoGarminSync(): Promise<void> {
  if (!navigator.onLine || running) return;
  const last = Date.parse(localStorage.getItem(syncKey("fk-garmin-last-sync")) || "") || 0;
  const failAt = Date.parse(localStorage.getItem(syncKey("fk-garmin-auto-fail")) || "") || 0;
  if (Date.now() - last < AUTO_MS || Date.now() - failAt < 30 * 60e3 || Date.now() - lastTry < 60e3) return;
  lastTry = Date.now();
  const st = await api("status", undefined, 10000);
  if (!st.body?.loggedIn) return;
  const r = await runGarminSync(() => {}, st.body?.profile?.displayName);
  if (r === "ok") localStorage.removeItem(syncKey("fk-garmin-auto-fail")); else if (r !== "busy") localStorage.setItem(syncKey("fk-garmin-auto-fail"), new Date().toISOString());
  window.dispatchEvent(new Event("fk-garmin-synced"));
}

export function GarminSync() {
  const [st, setSt] = useState<{ loggedIn: boolean; profile?: { displayName?: string; fullName?: string } | null } | null>(null);
  const [form, setForm] = useState({ region: "cn", username: "", password: "" });
  const [mfa, setMfa] = useState<string | null>(null); const [code, setCode] = useState("");
  const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [lastSync, setLastSync] = useState("");
  const [lastPartial,setLastPartial]=useState(false);
  useEffect(() => { const f = () => { const t = localStorage.getItem(syncKey("fk-garmin-last-sync")); try{setLastPartial(JSON.parse(localStorage.getItem(syncKey("fk-garmin-sync-report"))??"null")?.status!=="ok")}catch{setLastPartial(true)} setLastSync(t ? new Date(t).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""); }; f(); window.addEventListener("fk-garmin-synced", f); return () => window.removeEventListener("fk-garmin-synced", f); }, [msg]);
  const [remind, setRemind] = useState(false);
  useEffect(() => { void listSnapshots().then(setSnaps).catch(() => {}); const last = localStorage.getItem("fk-last-export"); setRemind(needsBackupReminder() || !last || Date.now() - Date.parse(last) > 14 * 86400e3); }, []);
  const refresh = () => api("status").then((r) => setSt(r.body)).catch(() => setSt({ loggedIn: false }));
  useEffect(() => { void refresh(); }, []);
  async function login() {
    accountGeneration++; setBusy(true); setMsg("");
    const r = await api("login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
    setForm((f) => ({ ...f, password: "" }));
    if (r.body.mfa) { setMfa(r.body.state); setMsg("佳明发了验证码，请输入"); }
    else if (r.body.ok) { setMsg("已登录"); await refresh(); } else setMsg(r.body.message || "登录失败");
    setBusy(false);
  }
  async function sendMfa() {
    accountGeneration++; setBusy(true); const r = await api("mfa", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ state: mfa, code }) });
    if (r.body.ok) { setMfa(null); setMsg("已登录"); await refresh(); } else setMsg(r.body.message || "验证失败"); setBusy(false);
  }
  async function sync() {
    setBusy(true); setMsg("同步中…");
    const r = await runGarminSync(setMsg, st?.profile?.displayName);
    if (r === "auth") await refresh(); if (r === "busy") setMsg("正在后台同步…");
    setBusy(false);
  }
  const input = "min-h-11 w-full rounded-card border border-line bg-surface px-3";
  return <section className="home-card mx-3 my-3 space-y-2 p-4 text-sm" id="garmin-sync">
    <h2 className="font-bold">佳明账号同步</h2>
    <p className="keep text-xs text-muted">在线且页面运行时同步；关闭或挂起后不保证后台同步{lastSync && !st?.loggedIn ? ` · 上次同步 ${lastSync}` : ""}</p>
    {st?.loggedIn ? <>
      <p className="text-muted">已登录 {st.profile?.fullName || st.profile?.displayName || ""} · 上次同步 {lastSync || "无"}</p>
      {lastPartial ? <p role="status" className="text-sm text-muted">最近一次未完整成功，请查看同步结果并核对缺失指标。</p> : null}
      <div className="flex gap-2"><button type="button" disabled={busy} className="min-h-11 flex-1 rounded-card bg-accent font-bold text-accent-fg" onClick={sync}>同步最近活动和健康数据</button><button type="button" className="min-h-11 rounded-card border border-line px-3" onClick={async () => { accountGeneration++; await api("logout"); await refresh(); }}>退出</button></div>
    </> : mfa ? <div className="flex gap-2"><input className={input} inputMode="numeric" placeholder="验证码" value={code} onChange={(e) => setCode(e.target.value)} /><button type="button" disabled={busy} className="rounded-card bg-accent px-4 font-bold text-accent-fg" onClick={sendMfa}>确认</button></div> : <>
      <select className={input} value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })}><option value="cn">佳明中国（garmin.cn）</option><option value="com">佳明国际（garmin.com）</option></select>
      <input className={input} autoComplete="username" placeholder="佳明账号（邮箱/手机）" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
      <input className={input} type="password" autoComplete="current-password" placeholder="密码" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
      <button type="button" disabled={busy || !form.username || !form.password} className="min-h-11 w-full rounded-card bg-accent font-bold text-accent-fg" onClick={login}>登录佳明</button>
    </>}
    {msg ? <p className="text-accent">{msg}</p> : null}
    <p className="text-xs text-muted">活动仅请求最近最多200条，活动条数不是训练课次数，也不代表全部历史。健康数据按页面所在时区请求最近14个日历日；与手表日期不一致时先核对两端时区。身体电量为当日最高值，HRV为昨夜平均；均非实时值。同步报告会列出未完成项。</p>
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
