import { effectiveNutritionProfile } from '@/lib/coach/loop/effective-host';
import { stampCN } from "@/lib/ui/activity-format";
/* R1「个人与数据」：一级三组入口 + 二级页（同步状态、备份恢复、隐私、健康）。只做展示与入口整理，存储键与业务写入沿用原实现。 */
import { CorosStatusRows } from "@/components/coros-account";
import { useEffect, useRef, useState } from "react";
import { Bot, ChevronDown, ChevronRight, Cpu, Database, HeartPulse, Palette, ShieldCheck, Target, TriangleAlert, UserRound, Watch } from "lucide-react";
import { ATHLETE_SCOPE_CHANGED, currentAthleteId } from "@/lib/core/events";
import { loadVitals } from "@/lib/nutrition/vitals";
import { loadExtras } from "@/lib/health/device-store";
import { subscribeGarminSyncStatus } from "@/lib/health/garmin-sync-status";
import { STATUS_TEXT, fmtTime, latestGarminReceipt, readDeviceImportDisplay, readGarminSyncDisplay, syncSummary, type ObservationLike, type SyncDisplay } from "@/lib/health/sync-status";
import { prepareAnyBackup, stagePreparedBackup, type PreparedBackup } from "@/lib/ui/backup-center";
import { BACKUP_ARCHIVE_MAX_JSON_BYTES } from "@/lib/core/backup-archive";
import { appStorage } from "@/lib/core/bulk-store";
import { exportVault, listSnapshots, prepareSnapshot, downloadRestoreCandidate, vaultStatus, type Snapshot } from "@/lib/vault";
import { loadInjury, saveInjury, type InjuryStore } from "@/lib/ui/injury";
import { loadSettings } from "@/lib/ui/app-settings";
import { athleteLines, athleteSummary } from "@/lib/ui/profile-labels";
import type { Profile } from "@/lib/strength/profile";
import { InjuryCard } from "@/components/today-board";
import "./device-settings-detail.css";
import { useGarminSyncLive } from "@/lib/ui/garmin-sync-live";

export type SettingsPane = "menu" | "athlete" | "goals" | "health" | "sync" | "import" | "backup" | "coach" | "theme" | "ai" | "privacy";
export type GarminConnState = { loggedIn: boolean; unreachable?: boolean } | null;

function observations(): ObservationLike[] {
  try {
    const day = (k?: string) => k?.match(/(\d{4}-\d\d-\d\d)$/)?.[1];
    return [...loadVitals().records.map(r => ({ sourceId: r.observation?.sourceId, syncedAt: r.observation?.syncedAt, day: day(r.observation?.key) })), ...loadExtras().map(r => ({ sourceId: r.observation?.sourceId, syncedAt: r.observation?.syncedAt, day: day(r.observation?.key) }))];
  } catch { return []; }
}
export function useGarminDisplay(conn: GarminConnState): SyncDisplay {
  const read = () => readGarminSyncDisplay(localStorage, currentAthleteId(), conn ? (conn.unreachable ? null : conn.loggedIn) : null);
  const [g, setG] = useState<SyncDisplay>(() => typeof localStorage === "undefined" ? readGarminSyncDisplay({ getItem: () => null }, "local", null) : read());
  useEffect(() => { const f = () => setG(read()); f(); const stop = subscribeGarminSyncStatus(f); window.addEventListener(ATHLETE_SCOPE_CHANGED, f); return () => { stop(); window.removeEventListener(ATHLETE_SCOPE_CHANGED, f); }; }, [conn?.loggedIn, conn?.unreachable]);
  return g;
}
/** 菜单页只读一次真实连接状态（不触发同步）。 */
function useGarminConn(): GarminConnState {
  const [c, setC] = useState<GarminConnState>(null);
  useEffect(() => { const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 8000); fetch("/api/garmin/status", { credentials: "same-origin", signal: ac.signal }).then(async r => setC(r.status === 200 ? { loggedIn: Boolean((await r.json().catch(() => ({})))?.loggedIn) } : { loggedIn: false, unreachable: true })).catch(() => setC({ loggedIn: false, unreachable: true })).finally(() => clearTimeout(t)); return () => ac.abort(); }, []);
  return c;
}
export function injuryText(inj: InjuryStore): string {
  return inj.items.length ? `已记录 ${inj.items.length} 处需要留意` : inj.asked ? "未记录不适（无法区分“都没有”和“以后再说”）" : "尚未填写";
}

function MenuRow({ icon: Icon, title, sub, warn, onClick, testId }: { icon: typeof Bot; title: string; sub: string; warn?: string; onClick: () => void; testId?: string }) {
  return <button type="button" data-testid={testId} onClick={onClick} className="flex min-h-[60px] w-full items-center gap-3 py-3 text-left">
    <Icon className="fk-row-icon size-5 shrink-0" aria-hidden="true" />
    <span className="min-w-0 flex-1"><span className="block font-bold">{title}</span><span className="block text-xs text-muted">{sub}</span>{warn ? <span className="mt-0.5 flex items-center gap-1 text-xs font-bold text-warn"><TriangleAlert className="size-3.5" aria-hidden="true" />{warn}</span> : null}</span>
    <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden="true" />
  </button>;
}
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="mt-4" aria-label={title}><h3 className="px-1 text-xs font-bold tracking-wide text-muted">{title}</h3><div className="home-card mt-1.5 divide-y divide-line px-4">{children}</div></section>;
}
export function SettingsMenu({ profile, sportGoal, displayText, onPane, onProfile }: { profile: Profile; sportGoal: string; displayText: string; onPane: (p: SettingsPane) => void; onProfile: () => void }) {
  const conn = useGarminConn();
  const g = useGarminDisplay(conn);
  const live = useGarminSyncLive();
  const [extra, setExtra] = useState({ injury: "尚未填写", lastImport: "暂无记录", lastExport: "暂无记录", snaps: 0, coach: "", vision: "" });
  useEffect(() => {
    const s = loadSettings(); const imp = readDeviceImportDisplay(observations());
    const le = localStorage.getItem("fk-last-export");
    setExtra({ injury: injuryText(loadInjury()), lastImport: fmtTime(imp.lastCompleteSuccessAt), lastExport: le ? fmtTime(le) : "暂无记录", snaps: 0, coach: `${s.coachStyle === "brief" ? "简短" : "详细"} · 提醒${s.reminders.master ? "开" : "关"}`, vision: "" });
    void listSnapshots().then(x => setExtra(e => ({ ...e, snaps: x.length }))).catch(() => {});
  }, []);
  const syncWarn = g.status === "partial" ? "最近一次部分成功 · 查看报告" : g.status === "failed" ? "最近一次同步失败 · 查看报告" : g.status === "auth" ? "需要重新登录佳明" : g.status === "unknown" ? "同步报告无法读取" : undefined;
  return <div data-testid="settings-menu">
    <Group title="个人与训练">
      <MenuRow icon={UserRound} title="运动员档案" sub={athleteSummary(profile)} onClick={() => onPane("athlete")} testId="menu-athlete" />
      <MenuRow icon={Target} title="训练目标与赛季计划" sub={sportGoal} onClick={() => onPane("goals")} />
      <MenuRow icon={HeartPulse} title="健康与训练限制" sub={`伤病：${extra.injury}`} onClick={() => onPane("health")} />
    </Group>
    <Group title="设备与数据">
      <MenuRow icon={Watch} title="设备与数据同步" sub={live.running ? "佳明账号 · 正在同步" : "手表与运动软件 · 账号连接 / 文件导入"} warn={live.running ? undefined : syncWarn} onClick={() => onPane("sync")} testId="menu-sync" />
      <MenuRow icon={Database} title="备份与恢复" sub={`最近触发导出 ${extra.lastExport} · 自动快照 ${extra.snaps} 份`} onClick={() => onPane("backup")} testId="menu-backup" />
    </Group>
    <Group title="应用与隐私">
      <MenuRow icon={Bot} title="教练与提醒" sub={extra.coach} onClick={() => onPane("coach")} />
      <MenuRow icon={Palette} title="外观与显示" sub={displayText} onClick={() => onPane("theme")} />
      <MenuRow icon={Cpu} title="AI 服务与联网功能" sub="全部联网功能（默认开启，可逐项关）" onClick={() => onPane("ai")} />
      <MenuRow icon={ShieldCheck} title="隐私与数据流向" sub="哪些存在本机、哪些会经服务端" onClick={() => onPane("privacy")} testId="menu-privacy" />
    </Group>
    <button type="button" className="mt-3 min-h-11 w-full text-sm text-muted" onClick={onProfile}>直接编辑基本信息 ›</button>
  </div>;
}

function KV({ k, v, tone }: { k: string; v: string; tone?: "warn" | "ok" }) { return <div className="flex items-start justify-between gap-3 border-t border-line py-2 first:border-t-0"><span className="shrink-0 text-muted">{k}</span><span className={"text-right " + (tone === "warn" ? "font-bold text-warn" : tone === "ok" ? "text-[#47C29A]" : "")}>{v}</span></div>; }
/** 设备连接与同步：状态总览 + 报告。连接状态由 GarminSync 实际查询后回传。 */
export function SyncStatusPanel({ conn }: { conn: GarminConnState }) {
  const g = useGarminDisplay(conn);
  const live = useGarminSyncLive();
  const [obs, setObs] = useState<ObservationLike[]>([]);
  useEffect(() => { const f = () => setObs(observations()); f(); window.addEventListener("fk-garmin-synced", f); window.addEventListener(ATHLETE_SCOPE_CHANGED, f); return () => { window.removeEventListener("fk-garmin-synced", f); window.removeEventListener(ATHLETE_SCOPE_CHANGED, f); }; }, []);
  const imp = readDeviceImportDisplay(obs), recv = latestGarminReceipt(obs);
  const connText = conn === null ? "正在确认…" : conn.unreachable ? "同步服务暂时不可达" : conn.loggedIn ? "已连接" : "未登录";
  const bad = ["partial", "failed", "auth", "unknown"].includes(g.status);
  return <section className="home-card device-sync-panel mt-3 p-4 text-sm" aria-label="同步状态总览" data-testid="sync-status" data-status={live.running ? "running" : g.status}>
    <div className="device-account-heading">
      <div><h3 className="font-bold">同步记录</h3><p className="mt-1 text-muted">佳明 · {live.running ? `开始于 ${fmtTime(live.startedAt)}` : g.status === "never" ? "尚未同步" : `最近尝试 ${fmtTime(g.lastAttemptAt)}`}</p></div>
      <span className="device-account-status" data-tone={live.running ? undefined : bad ? "warn" : g.status === "ok" ? "ok" : undefined}>{live.running ? "正在同步" : g.status === "ok" ? "完整成功" : g.status === "never" ? "暂无记录" : STATUS_TEXT[g.status]}</span>
    </div>
    {!live.running && bad ? <p role="status" className="device-sync-notice" data-tone="warn">{g.status === "partial" ? `部分同步未完成${g.errors.length ? `（${g.errors.length} 项）` : ""}，已有数据不受影响。` : g.status === "auth" ? "请重新登录佳明后再同步。" : g.status === "unknown" ? "同步结果暂时无法确认，请展开详情查看。" : "最近一次同步未完成，可稍后重试。"}</p> : null}
    <details id="sync-report" className="device-sync-disclosure" data-testid="sync-report">
      <summary><span>{live.running ? "上一次同步详情" : "同步详情"}</span><ChevronDown aria-hidden="true" /></summary>
      <div className="device-sync-detail-body">
        <h4 className="font-bold">佳明账号</h4>
        <div className="device-sync-rows">
          <KV k="连接状态" v={connText} tone={conn?.unreachable ? "warn" : undefined} />
          <KV k="最近尝试" v={g.status === "never" ? "暂无记录" : `${fmtTime(g.lastAttemptAt)}（${STATUS_TEXT[g.status]}）`} tone={bad ? "warn" : g.status === "ok" ? "ok" : undefined} />
          <KV k="上次完整成功" v={fmtTime(g.lastCompleteSuccessAt)} />
          {g.lastUsefulSyncAt && g.lastUsefulSyncAt !== g.lastCompleteSuccessAt ? <KV k="最近取得数据（含部分成功）" v={fmtTime(g.lastUsefulSyncAt)} /> : null}
          <KV k="最近收到佳明健康数据" v={fmtTime(recv)} />
          {g.status !== "never" ? <KV k="最近一次范围" v={`活动 ${g.activityRows ?? "—"} 条（最多取最近 ${g.activityLimit ?? 200} 条，不是全部历史）· 健康 ${g.coveredFrom ? `${g.coveredFrom.slice(5)} 至 ${g.coveredTo?.slice(5)}` : "无有效日期"}（请求 ${g.healthDaysRequested ?? "—"} 天）`} /> : null}
          {g.status !== "never" ? <KV k="写入结果" v={`保存/更新 ${g.saved ?? "—"} 条 · 未变化 ${g.skipped ?? "—"} 条`} /> : null}
        </div>
        {g.errors.length ? <div className="device-sync-errors"><h4 className="font-bold">未完成项（{g.errors.length}）</h4><ul className="mt-2 list-disc space-y-2 pl-5">{g.errors.map((e, i) => <li key={i}>{e.message}</li>)}</ul></div> : <p className="text-muted">{g.status === "never" ? "还没有同步记录。" : "最近一次没有报告缺失项。"}</p>}
        {bad ? <p className="text-muted">处理：{g.status === "auth" ? "在上方重新登录佳明后再同步。" : "已保存的数据不受影响；缺失项可稍后重试同步，或用「数据导入」补文件。未收到的数据不会记成 0 或“无训练”。"}</p> : null}
        <h4 className="device-sync-subheading font-bold">高驰账号</h4>
        <div className="device-sync-rows" data-testid="coros-status"><CorosStatusRows KV={(p) => <KV key={p.k} {...p} />} /></div>
        <h4 className="device-sync-subheading font-bold">本机设备文件导入</h4>
        <div className="device-sync-rows"><KV k="最近导入" v={fmtTime(imp.lastCompleteSuccessAt)} />{imp.healthRows ? <KV k="导入的健康记录" v={`${imp.healthRows} 条${imp.coveredFrom ? ` · ${imp.coveredFrom.slice(5)} 至 ${imp.coveredTo?.slice(5)}` : ""}`} /> : null}</div>
      </div>
    </details>
  </section>;
}

type Pending = PreparedBackup;
export function BackupCenter({ onNotice, legacySlot }: { onNotice: (m: string) => void; legacySlot?: React.ReactNode }) {
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [msg, setMsg] = useState('');
  const [savedCurrent, setSavedCurrent] = useState(false);
  const [lastExport, setLastExport] = useState<string | null>(null);
  const [candidateId, setCandidateId] = useState('');
  const [busy, setBusy] = useState(false), running = useRef(false);
  const [mirror, setMirror] = useState(vaultStatus);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { void listSnapshots().then(setSnaps).catch(() => setMsg('自动快照暂不可读取；当前记录未修改。')); setLastExport(localStorage.getItem('fk-last-export')); const update = () => setMirror(vaultStatus()); window.addEventListener('fk-vault-status', update); return () => window.removeEventListener('fk-vault-status', update); }, []);
  const say = (message: string) => { setMsg(message); onNotice(message); };
  const download = async () => {
    try { const result = await exportVault(); setLastExport(localStorage.getItem('fk-last-export')); if (result !== 'cancelled') setSavedCurrent(true); say(result === 'shared' ? '已打开系统分享面板，请自行确认文件保存位置。' : result === 'download' ? '已触发记录备份下载；范围见清单，网页无法确认文件已存盘。' : '已取消导出。'); }
    catch { say('导出未完成：存储读回、容量或来源核对失败。请保留当前数据并重试；没有生成完整备份。'); }
  };
  const pick = async (selected: File) => {
    setPending(null); const subject = currentAthleteId();
    if (selected.size > BACKUP_ARCHIVE_MAX_JSON_BYTES) return say('文件超过 128 MiB 容器上限，未做任何修改。');
    try {
      const raw = await selected.text();
      if (subject !== currentAthleteId()) return say('当前档案已切换，请重新选择文件。');
      const prepared = prepareAnyBackup(raw, appStorage());
      if (!prepared.ok) return say(prepared.reason);
      setPending(prepared); setMsg('');
    } catch { say('文件或当前记录无法读取，尚未保存待核副本。'); }
  };
  const pickSnap = (snapshot: Snapshot) => {
    const prepared = prepareSnapshot(snapshot);
    if (!prepared.ok) return say(prepared.reason);
    setPending(prepared);
  };
  const confirm = async () => {
    if (!pending || running.current) return;
    running.current = true; setBusy(true);
    try {
      const result = await stagePreparedBackup(pending, appStorage());
      say(result.reason);
      if (result.candidateId) setCandidateId(result.candidateId);
      if (result.state === 'CANDIDATE_READY') setPending(null);
    } finally { running.current = false; setBusy(false); }
  };
  const downloadCandidate = async () => { try { await downloadRestoreCandidate(candidateId.trim()); say('已触发待核副本下载（包含预检时原值），当前记录未修改；此文件不代表已恢复。请确认已存盘。'); } catch (error) { say((error as Error).message); } };
  const p = pending?.preview;
  return <div className="space-y-3 text-sm" data-testid="backup-center">
    <section className="home-card mt-3 p-4">
      <h3 className="font-bold">记录备份（范围见清单）</h3>
      <p className="mt-1 text-xs text-muted">包含当前可读的本机文本记录与大块记录。排除登录凭据、原图与附件、设备证据、计划执行覆盖及导出回执、孤立镜像和待核副本；具体范围写入文件清单。支持最多 64 MiB 数据、128 MiB 文件，导出来源未经跨标签原子快照保证。</p>
      <button type="button" className="mt-3 min-h-12 w-full rounded-xl bg-accent font-bold text-accent-fg" onClick={() => void download()}>下载记录备份</button>
      <p className="mt-2 text-xs text-muted">最近一次触发导出：{lastExport ? fmtTime(lastExport) : "暂无记录"}（只代表点过导出，不代表已确认存盘）</p>
    </section>
    <section className="home-card p-4">
      <h3 className="font-bold">从备份恢复</h3>
      <p className="mt-1 text-xs text-muted">支持新分块备份、旧版记录备份和计划文件。先预检，再保存隔离的待核副本。当前网页不能证明旧标签页已停写，暂不覆盖当前记录；保存副本不等于恢复完成。</p>
      <button type="button" className="mt-3 min-h-12 w-full rounded-xl border border-line font-bold" onClick={() => file.current?.click()}>选择备份文件并预检</button>
      <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void pick(f); }} />
      {snaps.length ? <details className="mt-3"><summary className="min-h-10 cursor-pointer font-bold">自动快照（{snaps.length}/7，每天最多一份，存在本机）</summary>{[...snaps].reverse().map(x => <div key={x.at} className="flex min-h-11 items-center justify-between border-t border-line"><span>{stampCN(x.at, "ymd")} · {Object.keys(x.data).length} 项</span><button type="button" className="min-h-11 px-2 text-accent" onClick={() => pickSnap(x)}>预检</button></div>)}<p className="text-xs text-muted">快照和数据在同一个浏览器里，清除浏览器数据时会一起丢失，不能代替下载备份。</p></details> : null}
    </section>
    {p ? <section className="home-card border border-accent p-4" role="dialog" aria-label="恢复预检" data-testid="restore-preview">
      <h3 className="font-bold">恢复前检查</h3>
      <div className="mt-1"><KV k="类型" v={p.label} /><KV k="导出时间" v={p.exportedAt ? stampCN(p.exportedAt, "ymd") : "文件未记录"} />{p.version ? <KV k="版本" v={p.version} /> : null}<KV k="共" v={`${p.total} 项`} /><KV k="新增" v={`${p.added} 项`} /><KV k="与当前不同" v={`${p.overwritten} 项`} tone={p.overwritten ? "warn" : undefined} /><KV k="完全相同" v={`${p.unchanged} 项`} /><KV k="跳过（不写入）" v={`${p.skipped} 项`} /></div>
      {p.included ? <p className="mt-2 text-xs">文件包含：{p.included.join("；")}。排除：{p.excluded?.join("；") || "未列出"}。</p> : <p className="mt-2 text-xs text-muted">旧格式未提供完整范围或人物清单，仅作为待核副本保留。</p>}
      {p.skippedReasons.length ? <details className="mt-1 text-xs"><summary className="min-h-9 cursor-pointer">跳过原因</summary><ul className="list-disc pl-5">{p.skippedReasons.map((r, i) => <li key={i} className="break-all">{r}</li>)}</ul></details> : null}
      {p.overwritten ? <p className="mt-2 text-xs text-warn">这些项目与当前记录不同，候选不会覆盖它们。仍建议下载当前记录备份{savedCurrent ? "（本次已触发过下载）" : ""}。</p> : null}
      <div className="mt-3 grid grid-cols-2 gap-2"><button type="button" className="min-h-11 rounded-xl border border-line" onClick={() => void download()}>先下载当前备份</button><button type="button" className="min-h-11 rounded-xl bg-accent font-bold text-accent-fg" disabled={busy} onClick={() => void confirm()}>{busy ? "正在保存待核副本…" : "确认保存待核副本"}</button></div>
      <button type="button" className="mt-2 min-h-11 w-full text-muted" onClick={() => { setPending(null); say("已取消恢复，当前记录未修改。"); }}>取消</button>
    </section> : null}
    {legacySlot ? <details className="home-card p-4"><summary className="min-h-10 cursor-pointer font-bold">其他导出（旧格式，兼容保留）</summary>{legacySlot}</details> : null}
    {mirror.failed ? <p role="alert" className="text-warn">保险箱镜像未完成核对；请保留当前页面并检查存储。备份会报告读回失败。</p> : null}
    <section className="home-card p-4"><h3 className="font-bold">取回待核副本</h3><p className="mt-1 text-xs text-muted">副本只保存在此浏览器；清理网站数据会丢失。可凭编号重新下载，下载不会切换当前数据。</p><input aria-label="待核副本编号" className="mt-2 w-full rounded border border-line p-2" value={candidateId} onChange={event => setCandidateId(event.target.value)} /><button type="button" disabled={!candidateId.trim()} className="mt-2 min-h-11 w-full rounded border border-line" onClick={() => void downloadCandidate()}>下载待核副本</button></section>
    {msg ? <p role="status" className="text-sm">{msg}</p> : null}
  </div>;
}

export function PrivacyPanel() {
  return <section className="home-card mt-3 space-y-3 p-4 text-sm leading-6" aria-label="隐私与数据流向" data-testid="privacy-panel">
    <div><h3 className="font-bold">保存在本机</h3><p className="text-muted">训练、计划、健康、饮食、教练对话和设置都保存在当前浏览器（本机存储 + IndexedDB 镜像），这些记录不会自动上传到方坤服务器。清除浏览器数据或删除主屏幕 App 可能导致丢失，请定期在「备份与恢复」下载备份。</p></div>
    <div><h3 className="font-bold">只有使用这些功能时，数据才会经过服务端</h3>
      <ul className="mt-1 list-disc space-y-1.5 pl-5 text-muted">
        <li><b className="text-fg">佳明账号同步</b>：账号密码经方坤服务端转发给佳明登录；同步时佳明返回的活动和健康数据经服务端中转后保存到本机。服务端代码不保存、不记录这些内容；会话令牌加密放在网页脚本读不到的 Cookie 里。</li>
        <li><b className="text-fg">联网功能默认全部开启</b>（你要求的，同意时间记录在本机；「AI 服务与联网功能」里可逐项关闭）。</li>
        <li><b className="text-fg">营养标签、小票、体脂秤拍照</b>：照片只在手机上识字，只把识别出的文字经方坤服务端发给 DeepSeek 整理；照片不上传。结果要你确认后才保存。</li>
        <li><b className="text-fg">没找到的食物联网估算</b>：只发送食物名称和份量给 DeepSeek，结果标“估算”，可改；不知道的项留空。</li>
        <li><b className="text-fg">菜品照片 / 截图图片识别</b>：点“联网识别”时，所选图片先在本机缩小，再经方坤服务端发给 DeepSeek（deepseek-flash）；不点不上传。照片热量是估算·待核，保存前可改。</li>
        <li><b className="text-fg">方坤联网对话（默认开启，可在方坤对话页关闭）</b>：会把你的问题、最近几轮对话、计划目标、近期活动数值与分段、恢复指标（睡眠/静息心率/HRV/身体电量/压力）经方坤服务端发给 DeepSeek；不发送账号、密码、位置和活动名称。断网或关闭时用本地规则回答。</li>
      </ul></div>
    <div><h3 className="font-bold">第三方与删除范围</h3><p className="text-muted">发给 DeepSeek 的内容按 DeepSeek 的政策处理；佳明账号里的数据要在佳明那边管理。App 只能删除本机记录，不能替你删除第三方或平台日志里的数据（Cloudflare 平台层访问日志的保存策略：待核）。</p></div>
  </section>;
}

export function HealthPanel() {
  const [inj, setInj] = useState<InjuryStore>({ asked: false, items: [] });
  const [edit, setEdit] = useState(false);
  useEffect(() => { setInj(loadInjury()); }, []);
  return <section className="home-card mt-3 p-4 text-sm" aria-label="健康与训练限制">
    <h3 className="font-bold">伤病与当前不适</h3>
    <p className="mt-1" data-testid="injury-state">{injuryText(inj)}</p>
    {inj.items.length ? <ul className="mt-1 list-disc pl-5">{inj.items.map(x => <li key={x.part}>{x.part} · {x.kind === "current" ? `当前疼痛${x.score ? ` ${x.score}/10` : ""}${x.since ? ` · 自 ${x.since}` : ""}` : "旧伤"}</li>)}</ul> : null}
    <p className="mt-1 text-xs text-muted">“尚未填写”不等于没有风险。这里只记录情况、用于挑选动作，不做诊断；疼痛加重或持续请找专业人员。</p>
    {edit ? <div className="mt-3"><InjuryCard onSave={(v) => { saveInjury(v); setInj(v); setEdit(false); }} /></div> : <button type="button" className="mt-3 min-h-11 w-full rounded-xl border border-line font-bold" onClick={() => setEdit(true)}>{inj.asked || inj.items.length ? "更新伤病情况" : "填写伤病情况"}</button>}
  </section>;
}
export function AthletePanel({ profile, onEdit }: { profile: Profile; onEdit: () => void }) {
  return <section className="home-card mt-3 p-4 text-sm" aria-label="运动员档案" data-testid="athlete-panel">
    <h3 className="font-bold">运动员档案</h3>
    <ul className="mt-2 space-y-1.5">{athleteLines(effectiveNutritionProfile(profile)).map((t, i) => <li key={i}>{t}</li>)}</ul>
    <button type="button" className="mt-3 min-h-11 w-full rounded-xl bg-accent font-bold text-accent-fg" onClick={onEdit}>编辑基本信息</button>
  </section>;
}
