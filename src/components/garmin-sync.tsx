import { stampCN } from "@/lib/ui/activity-format";
import { runGarminSyncJob, garminStorageKey } from "@/lib/health/garmin-sync-runner";
import { ATHLETE_SCOPE_CHANGED, currentAthleteId } from "@/lib/core/events";
import { bindGarminAccount } from "@/lib/health/garmin-account-owner";
import { localDay, shiftDay, healthChanged } from "@/lib/health/observation";
import { AUTO_SYNC_RULE, readGarminSyncStatus, subscribeGarminSyncStatus } from "@/lib/health/garmin-sync-status";
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { saveGarminRowsWithRetry } from "@/lib/health/garmin-pending-imports";
import { readGarminDailyProgress, writeGarminDailyProgress } from "@/lib/health/garmin-progress-store";
import { readGarminActivityConflicts } from "@/lib/health/garmin-activity-conflicts";
import { activityKey, type DeviceActivity, type DeviceHealthRow } from "@/lib/ui/device-parse";
import { exportVault, importVault, listSnapshots, restoreSnapshot, needsBackupReminder, type Snapshot } from "@/lib/vault";
import { exportFeedback } from "@/components/coach-feedback";
import { saveGarminActivities, garminViewHas } from "@/components/garmin-log";
import { shortHash } from "@/lib/health/observation";
import { saveIntraday, intradayComplete } from "@/lib/health/intraday-store";
import "./device-settings-detail.css";
import { beginGarminSyncLive, clearGarminSyncLive, finishGarminSyncLive, readGarminSyncLive, updateGarminSyncLive, useGarminSyncLive } from "@/lib/ui/garmin-sync-live";

const api = async (p: string, init?: RequestInit, ms = 20000) => {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(`/api/garmin/${p}`, { credentials: "same-origin", signal: ac.signal, ...init }); return { status: r.status, body: await r.json().catch(() => ({})) }; }
  catch { return { status: 0, body: { ok: false, message: "请求超时或网络中断" } }; } finally { clearTimeout(t); }
};
/** v89.10.11：沿用 v89.10.10 已记下的“上次同步日 + 未取到日期”（fk-garmin-health-days），避免升级后重读或丢掉待重试日期。 */
function legacyHealthDays(scope: string, subjectId: string) {
  try {
    const v = JSON.parse(localStorage.getItem(garminStorageKey(`fk-garmin-health-days:${shortHash(scope)}`, subjectId)) ?? "null");
    if (typeof v?.through !== "string" || !/^\d{4}-\d\d-\d\d$/.test(v.through)) return null;
    const at = new Date(`${v.through}T12:00:00`);
    return { checkedDays: [], pendingDays: Array.isArray(v.retry) ? v.retry.filter((d: unknown) => typeof d === "string" && /^\d{4}-\d\d-\d\d$/.test(d)) : [], lastSyncAt: Number.isFinite(at.getTime()) ? at.toISOString() : null };
  } catch { return null; }
}
let running = false;
let accountGeneration = 0;
// A → B → A during an awaited request is still a scope change, even if the final id matches.
if (typeof window !== "undefined") window.addEventListener(ATHLETE_SCOPE_CHANGED, () => { accountGeneration++; });
export async function runGarminSync(setMsg: (s: string) => void, _whoIn?: string, reason: "AUTO" | "MANUAL" = "AUTO"): Promise<"ok" | "partial" | "auth" | "fail" | "busy"> {
  if (running) return "busy";
  running = true;
  const subjectId = currentAthleteId(), syncGeneration = accountGeneration;
  const liveToken = beginGarminSyncLive(subjectId, new Date().toISOString());
  let finalResult: "ok" | "partial" | "auth" | "fail" = "fail";
  const sameOwner = () => currentAthleteId() === subjectId && accountGeneration === syncGeneration;
  const progress = (message: string) => { if (sameOwner()) { updateGarminSyncLive(liveToken, message); setMsg(message); } };
  let boundScope: string | null = null;
  try {
    const result = await runGarminSyncJob({ api, subject: currentAthleteId, generation: () => accountGeneration,
      day: localDay(), now: new Date().toISOString(), progress,
      save: (health, activities) => {
        if (!sameOwner() || !boundScope) throw Error('活动同步归属已变化');
        return saveGarminRowsWithRetry(boundScope, subjectId, health, activities, reason === 'MANUAL');
      }, saveView: saveGarminActivities, bindAccount: (scope, owner) => {
        const bound = sameOwner() && bindGarminAccount(scope, owner);
        if (bound) boundScope = scope;
        return bound;
      },
      intraday: { complete: d => intradayComplete(d), save: days => saveIntraday(days) },
      // 日常按钮按既有规则选择增量；完整复核通过说明区显式触发，仍按账号分别记录。
      reason, activitySeen: garminViewHas,
      fullReview: { get: scope => { try { return localStorage.getItem(garminStorageKey(`fk-garmin-full-review:${shortHash(scope)}`, subjectId)) } catch { return null } }, set: (scope, at) => { localStorage.setItem(garminStorageKey(`fk-garmin-full-review:${shortHash(scope)}`, subjectId), at) } },
      dailyProgress: { get: scope => readGarminDailyProgress(scope, subjectId) ?? legacyHealthDays(scope, subjectId), set: (scope, value) => { if (!sameOwner()) throw Error('同步归属已变化'); writeGarminDailyProgress(scope, subjectId, value); } },
      backfill: { get: scope => { try { return Number(localStorage.getItem(garminStorageKey(`fk-garmin-health-backfill:${shortHash(scope)}`, subjectId)) ?? localStorage.getItem(`fk-garmin-health-backfill:${scope}`)) || 14 } catch { return 14 } }, set: (scope, n) => { localStorage.setItem(garminStorageKey(`fk-garmin-health-backfill:${shortHash(scope)}`, subjectId), String(n)); } },
      report: report => {
        // A short recent page cannot resolve older source conflicts. Recheck the
        // persisted source view against formal records without fetching history.
        if (report.accountScope && ['ok', 'partial', 'empty'].includes(report.status)) {
          try {
            const pending = readGarminActivityConflicts(report.accountScope, report.subjectId);
            if (pending.length) {
              if (!report.errors.some(error => /同一来源活动|来源活动.*待核对/.test(error))) report.errors.push(`仍有 ${pending.length} 条来源活动与原记录不同，待核对；未重复计入或覆盖手填更正。`);
              report.status = 'partial';
            }
          } catch { report.errors.push('本机活动核对记录无法读取，未确认全部成功'); report.status = 'partial'; }
        }
        const key = (name: string) => garminStorageKey(name, report.subjectId);
        const raw = JSON.stringify(report);
        localStorage.setItem(key("fk-garmin-sync-report"), raw);
        if (localStorage.getItem(key("fk-garmin-sync-report")) !== raw) throw Error('REPORT_SAVE_FAILED');
        // Derived time caches are optional. Readers fall back to the verified
        // report, so a cache failure must not turn saved data into a failed sync.
        const cacheTime = (name: string) => { try { localStorage.setItem(key(name), report.at); } catch { /* The durable report supplies this time. */ } };
        cacheTime("fk-garmin-last-attempt");
        if (report.status === 'ok' || (report.status === 'partial' && report.saved + report.skipped > 0)) cacheTime("fk-garmin-last-sync");
        if (report.status === 'ok') cacheTime("fk-garmin-last-full-ok");
        healthChanged(); window.dispatchEvent(new Event("fk-garmin-synced"));
      },
    });
    const label = { ok: '已完成', partial: '部分完成', empty: '本次未取得可用记录', auth: '登录失效或身份不完整', fail: '同步失败', stale: '账号或运动员变化，已丢弃本次结果' }[result.status];
    if (result.status === 'ok' || result.status === 'partial') void prefetchRecentLaps();
    const modeLabel = result.mode === 'INITIAL' ? '首次同步' : result.mode === 'BACKFILL' ? '补齐历史' : result.mode === 'RECENT' ? '增量同步' : '完整复核';
    progress(`${modeLabel}：${label}（请求 ${result.requests ?? '—'} 次）：保存/更新 ${result.saved} 条，未变化 ${result.skipped} 条。${result.errors.slice(0, 2).join('；')}`);
    finalResult = result.status === 'empty' || result.status === 'stale' ? 'fail' : result.status;
    return finalResult;
  } finally { running = false; if (sameOwner()) finishGarminSyncLive(liveToken, finalResult); else clearGarminSyncLive(liveToken); }
}
/** 同步后预取最近 10 天跑步的分段（最多 8 条未缓存的），复盘时可直接用真实分段。失败不影响同步结果。 */
async function prefetchRecentLaps() {
  try {
    const { garminActivities, cachedLaps, saveLaps } = await import("@/lib/coach/online-coach");
    const { fetchLaps } = await import("@/components/garmin-log");
    const { activityTs } = await import("@/lib/ui/activity-format");
    const cutoff = Date.now() - 10 * 864e5;
    const todo = garminActivities().filter(a => /run|track|treadmill/.test(a.type) && activityTs(a.start) >= cutoff && !cachedLaps(a.id)).sort((a, b) => activityTs(b.start) - activityTs(a.start)).slice(0, 8);
    for (const a of todo) { const l = await fetchLaps(Number(a.id)).catch(() => null); if (l) saveLaps(a.id, l); }
  } catch { /* optional */ }
}
const AUTO_MS = 5 * 60e3;
let lastTry = 0;
/** 每次打开/回到前台（距上次 >5 分钟）+ 开着时每 2 小时：已登录、在线才静默同步；失败后 30 分钟内不重试。 */
export async function maybeAutoGarminSync(): Promise<void> {
  if (!navigator.onLine || running) return;
  const subjectId = currentAthleteId(), syncGeneration = accountGeneration;
  const sameOwner = () => currentAthleteId() === subjectId && accountGeneration === syncGeneration;
  const key = (name: string) => garminStorageKey(name, subjectId);
  const last = Date.parse(readGarminSyncStatus(subjectId).lastUsefulSyncAt || "") || 0;
  const failAt = Date.parse(localStorage.getItem(key("fk-garmin-auto-fail")) || "") || 0;
  if (Date.now() - last < AUTO_MS || Date.now() - failAt < 30 * 60e3 || Date.now() - lastTry < 60e3) return;
  lastTry = Date.now();
  const st = await api("status", undefined, 10000);
  if (!sameOwner() || !st.body?.loggedIn) return;
  const r = await runGarminSync(() => {}, st.body?.profile?.displayName);
  if (!sameOwner()) return;
  if (r === "ok" || r === "partial") localStorage.removeItem(key("fk-garmin-auto-fail")); else if (r !== "busy") localStorage.setItem(key("fk-garmin-auto-fail"), new Date().toISOString());
  window.dispatchEvent(new Event("fk-garmin-synced"));
}

/** 状态契约视图：连接状态 / 最近尝试 / 最后完整成功 / 部分失败 / 导入范围 + 详情（数据见 lib/health/garmin-sync-status.ts）。 */
export function GarminSyncStatusView() {
  const [s, setS] = useState(() => readGarminSyncStatus(currentAthleteId()));
  useEffect(() => { const f = () => setS(readGarminSyncStatus(currentAthleteId())); const stop = subscribeGarminSyncStatus(f); window.addEventListener(ATHLETE_SCOPE_CHANGED, f); return () => { stop(); window.removeEventListener(ATHLETE_SCOPE_CHANGED, f); }; }, []);
  const t = (iso: string | null) => iso ? new Date(iso).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
  return <div className="keep text-sm" aria-label="佳明同步状态">
    <p className={s.lastAttemptResult && s.lastAttemptResult !== "ok" ? "text-warn" : "text-muted"}>最近尝试：{s.lastAttemptLabel}</p>
    <details className="device-sync-disclosure">
      <summary><span>同步详情</span><ChevronDown aria-hidden="true" /></summary>
      <div className="device-sync-detail-body">
        <dl className="device-sync-definition">
          <dt className="text-muted">连接状态</dt><dd>{s.connectionLabel}</dd>
          <dt className="text-muted">最近尝试</dt><dd>{s.lastAttemptLabel}</dd>
          <dt className="text-muted">最后完整成功</dt><dd>{t(s.lastFullSuccessAt)}</dd>
          {s.partialFailure ? <><dt className="text-muted">部分失败</dt><dd className="text-warn">{s.partialFailure.errors.length ? s.partialFailure.errors.join("；") : "部分日期没取到"}</dd></> : null}
          <dt className="text-muted">导入范围</dt><dd>{s.importRange?.label ?? "还没同步过"}</dd>
        </dl>
        <ul className="space-y-2 text-muted">{s.details.map((d) => <li key={d}>{d}</li>)}</ul>
      </div>
    </details>
  </div>;
}
export type GarminConn = { loggedIn: boolean; unreachable?: boolean; profile?: { displayName?: string; fullName?: string } | null } | null;
/** hideBackup：R1 起备份统一在「备份与恢复」页，这里不再重复。onState：把真实连接状态交给同步状态面板。 */
export function GarminSync({ hideBackup = false, onState }: { hideBackup?: boolean; onState?: (s: GarminConn) => void } = {}) {
  const [st, setStRaw] = useState<GarminConn>(null);
  const setSt = (v: GarminConn) => { setStRaw(v); onState?.(v); };
  const [form, setForm] = useState({ region: "cn", username: "", password: "" });
  const [mfa, setMfa] = useState<string | null>(null); const [code, setCode] = useState("");
  const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const live = useGarminSyncLive();
  useEffect(() => { if (live.startedAt) setMsg(""); }, [live.startedAt]);
  const feedback = live.running ? live.message : msg || live.message;
  const file = useRef<HTMLInputElement>(null);
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [lastSync, setLastSync] = useState("");
  const [lastPartial,setLastPartial]=useState(false);
  useEffect(() => { const f = () => { const s = readGarminSyncStatus(currentAthleteId()); setLastPartial(s.lastAttemptResult !== "ok"); setLastSync(s.lastUsefulSyncAt ? new Date(s.lastUsefulSyncAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""); }; f(); window.addEventListener("fk-garmin-synced", f); window.addEventListener(ATHLETE_SCOPE_CHANGED, f); return () => { window.removeEventListener("fk-garmin-synced", f); window.removeEventListener(ATHLETE_SCOPE_CHANGED, f); }; }, []);
  const [remind, setRemind] = useState(false);
  useEffect(() => { void listSnapshots().then(setSnaps).catch(() => {}); const last = localStorage.getItem("fk-last-export"); setRemind(needsBackupReminder() || !last || Date.now() - Date.parse(last) > 14 * 86400e3); }, []);
  const refresh = () => {
    const subjectId = currentAthleteId(), refreshGeneration = accountGeneration;
    return api("status", undefined, 10000).then((r) => {
      if (subjectId === currentAthleteId() && refreshGeneration === accountGeneration) {
        const current = readGarminSyncLive();
        // status 只确认会话 Cookie；数据接口已拒绝登录时，保留重新登录入口。
        setSt(!current.running && current.result === "auth" ? { loggedIn: false } : r.status === 200 ? { loggedIn: Boolean(r.body?.loggedIn), profile: r.body?.profile ?? null } : { loggedIn: false, unreachable: true });
      }
    });
  };
  useEffect(() => { void refresh(); const scopeChanged = () => { setMsg(""); setBusy(false); setSt(null); void refresh(); }; window.addEventListener(ATHLETE_SCOPE_CHANGED, scopeChanged); return () => window.removeEventListener(ATHLETE_SCOPE_CHANGED, scopeChanged); }, []);
  // 后台任务结束或页面重新打开时，也要让已失效的连接显示登录入口。
  useEffect(() => { if (!live.running && live.result === "auth") setSt({ loggedIn: false }); }, [live.running, live.startedAt, live.result]);
  async function login() {
    accountGeneration++; clearGarminSyncLive(); setBusy(true); setMsg("");
    const r = await api("login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
    setForm((f) => ({ ...f, password: "" }));
    if (r.body.mfa) { setMfa(r.body.state); setMsg("佳明发了验证码，请输入"); }
    else if (r.body.ok) { setMsg("已登录"); await refresh(); } else setMsg(r.body.message || "登录失败");
    setBusy(false);
  }
  async function sendMfa() {
    accountGeneration++; clearGarminSyncLive(); setBusy(true); const r = await api("mfa", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ state: mfa, code }) });
    if (r.body.ok) { setMfa(null); setMsg("已登录"); await refresh(); } else setMsg(r.body.message || "验证失败"); setBusy(false);
  }
  async function sync(fullReview = false) {
    setBusy(true); setMsg("");
    try {
      const r = await runGarminSync(() => {}, st?.profile?.displayName, fullReview ? "MANUAL" : "AUTO");
      if (r === "busy" && !readGarminSyncLive().running) setMsg("同步任务正在结束，请稍后再试");
    } finally { setBusy(false); }
  }
  const input = "min-h-11 w-full rounded-card border border-line bg-surface px-3";
  return <section className="home-card device-account-card mx-3 my-3 space-y-2 p-4 text-sm" id="garmin-sync">
    <div className="device-account-heading"><h2 className="font-bold">佳明账号</h2><span role="status" className="device-account-status" data-tone={st?.unreachable ? "warn" : st?.loggedIn ? "ok" : undefined}>{st === null ? "确认中…" : st.unreachable ? "暂不可达" : st.loggedIn ? "已连接" : "未登录"}</span></div>
    {st?.unreachable ? <p role="status" className="text-warn">暂时连不上佳明同步服务。已导入的记录不受影响，请稍后再试。</p> : null}
    {st?.loggedIn ? <>
      <p className="text-muted">已登录 {st.profile?.fullName || st.profile?.displayName || ""}</p>
      <div className="device-account-actions"><button type="button" disabled={busy || live.running || confirmLogout} aria-busy={live.running} className="min-h-11 flex-1 rounded-card bg-accent font-bold text-accent-fg" onClick={() => void sync()}>{busy || live.running ? "同步中…" : "立即同步"}</button><button type="button" disabled={busy} className="min-h-11 rounded-card border border-line px-3" onClick={() => setConfirmLogout(true)}>退出</button></div>
      {confirmLogout ? <div className="rounded-xl border border-line p-3"><p>退出佳明连接？已保存的训练和健康记录保留。</p><div className="mt-2 flex gap-2"><button type="button" disabled={busy} className="min-h-11 rounded-xl border border-line px-3" onClick={() => setConfirmLogout(false)}>取消</button><button type="button" disabled={busy} className="min-h-11 rounded-xl bg-accent px-3 font-semibold text-accent-fg" onClick={async () => { const owner = currentAthleteId(); accountGeneration++; const generation = accountGeneration; clearGarminSyncLive(); setBusy(true); setMsg(""); try { const result = await api("logout"); if (owner !== currentAthleteId() || generation !== accountGeneration) return; if (result.status !== 200) setMsg("退出连接失败，请重试。"); else setConfirmLogout(false); await refresh(); } finally { if (owner === currentAthleteId() && generation === accountGeneration) setBusy(false); } }}>确认退出</button></div></div> : null}
      {hideBackup ? null : <GarminSyncStatusView />}
    </> : mfa ? <div className="flex gap-2"><input className={input} aria-label="佳明验证码" inputMode="numeric" placeholder="验证码" value={code} onChange={(e) => setCode(e.target.value)} /><button type="button" disabled={busy} className="min-h-11 rounded-card bg-accent px-4 font-bold text-accent-fg" onClick={sendMfa}>确认</button></div> : <>
      <select className={input} aria-label="佳明账号地区" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })}><option value="cn">佳明中国（garmin.cn）</option><option value="com">佳明国际（garmin.com）</option></select>
      <input className={input} aria-label="佳明账号" autoComplete="username" placeholder="佳明账号（邮箱/手机）" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
      <input className={input} aria-label="佳明密码" type="password" autoComplete="current-password" placeholder="密码" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
      <button type="button" disabled={busy || !form.username || !form.password || Boolean(st?.unreachable)} className="min-h-11 w-full rounded-card bg-accent font-bold text-accent-fg" onClick={login}>登录佳明</button>
    </>}
    {feedback ? feedback.includes("（请求 ") ? <details className="device-sync-disclosure device-sync-feedback" data-tone={/部分完成|部分同步|失败|未取得|失效|已丢弃/.test(feedback) ? "warn" : undefined}><summary><span role="status">{feedback.slice(0, feedback.indexOf("（请求 "))}</span><ChevronDown aria-hidden="true" /></summary><p className="device-sync-detail-body">{feedback}</p></details> : <p role="status" className="device-sync-message">{feedback}</p> : null}
    <details className="device-sync-disclosure">
      <summary><span>同步说明</span><ChevronDown aria-hidden="true" /></summary>
      <div className="device-sync-detail-body text-muted">
        <p>{AUTO_SYNC_RULE}关闭或挂起后不保证后台同步。</p>
        <p>日常同步更新近3天、新活动和未完成的日期。首次读取近90天健康汇总；中断后按缺口继续，每次最多补14个较早日期，已完成的历史不再整批重读。</p>
        <p>新活动每页读取20条，遇到已同步活动后停止，最多200条。完整复核会重查近14天和最近200条活动，不代表全部历史。健康日期按页面所在时区计算。</p>
        {st?.loggedIn ? <button type="button" disabled={busy || live.running} className="min-h-11 w-full rounded-card border border-line px-3 text-fg" onClick={() => void sync(true)}>完整复核最近数据</button> : null}
        <p>身体电量取同步时佳明给出的最近值（没有时才用当日最高并注明），HRV 为昨夜平均；同步后才更新，不是实时值。同步详情会列出未完成项。</p>
        {!st?.loggedIn ? <p>账号密码只用于这次登录，经方坤服务端转发给佳明；App 不把密码存到本机，服务端代码也不保存、不记录。登录后的会话令牌加密存放在网页脚本读不到的 Cookie 中。</p> : null}
      </div>
    </details>
    {hideBackup ? null : <>
    <h2 className="pt-2 font-bold">全部数据备份</h2>
    
    {remind ? <p className="rounded-card bg-accent/10 p-2 text-accent">建议现在导出一份备份{needsBackupReminder() ? "（版本大更新）" : ""}</p> : null}
    <div className="grid grid-cols-3 gap-2">
      <button type="button" className="min-h-11 rounded-card border border-line" onClick={() => { void exportVault(); setRemind(false); }}>一键导出</button>
      <button type="button" className="min-h-11 rounded-card border border-line" onClick={() => file.current?.click()}>导入恢复</button>
      <button type="button" className="min-h-11 rounded-card border border-line" onClick={exportFeedback}>导出反馈</button>
    </div>
    {snaps.length ? <details><summary className="min-h-10 cursor-pointer">自动快照（{snaps.length}/7）</summary>{[...snaps].reverse().map((x) => <div key={x.at} className="flex items-center justify-between py-1"><span>{stampCN(x.at, "ymd")}</span><button type="button" className="underline" onClick={async () => { if (!confirm("用这份快照覆盖恢复？")) return; const n = await restoreSnapshot(x.at); setMsg(`已恢复 ${n} 项，正在刷新`); setTimeout(() => location.reload(), 800); }}>恢复</button></div>)}</details> : null}
    <input ref={file} type="file" accept="application/json,.json" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { const n = await importVault(f); setMsg(`已恢复 ${n} 项，正在刷新`); setTimeout(() => location.reload(), 800); } catch (err) { setMsg(String((err as Error).message)); } }} />
    </>}
  </section>;
}
