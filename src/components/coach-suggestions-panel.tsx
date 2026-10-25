import { useEffect, useState, type ReactNode } from "react";
import { Bell, Check, Clock, Pencil, Undo2, X } from "lucide-react";
import { currentAthleteId } from "@/lib/core/events";
import { subscribeGlobalCoach } from "@/lib/coach/global-coach-host-v89";
import {
  decideSuggestion, disableSystemNotify, enableSystemNotify, readSuggestionDocument, refreshSuggestions,
  systemNotifyEnabled, undoSuggestion, SUGGESTIONS_CHANGED,
} from "@/lib/coach/loop/suggestion-host";
import { visibleSuggestions, type CoachSuggestion, type ProposedChange, type SuggestionDocument } from "@/lib/coach/loop/suggestions";
import type { Intensity } from "@/lib/ui/day-schedule-rules";

const KIND_LABEL: Record<CoachSuggestion["kind"], string> = { MOVE: "移动", SWAP: "对调", REPLACE: "替换", CANCEL: "取消", REDUCE: "减量", COMPANION: "提醒" };
const OUTCOME_LABEL = { AWAITING: "等待实际记录", SUPPORTED: "后续记录支持", WEAKENED: "后续记录削弱", WITHDRAWN: "已撤回判断" } as const;
const STATUS_LABEL: Record<CoachSuggestion["status"], string> = { PENDING: "待确认", DEFERRED: "已暂缓", ACCEPTED: "已接受", EDITED_ACCEPTED: "编辑后接受", REJECTED: "已拒绝", EXPIRED: "已过期", UNDONE: "已撤销" };

/** Reads the suggestion state and keeps it current with every data change. */
export function useCoachSuggestions() {
  const [doc, setDoc] = useState<SuggestionDocument>(() => readSuggestionDocument());
  useEffect(() => {
    let alive = true;
    const reread = () => { if (alive) setDoc(readSuggestionDocument(currentAthleteId())); };
    // Data changes (records, corrections, sync, profile) re-run the rules and the feedback loop.
    const off = subscribeGlobalCoach(() => { void refreshSuggestions().then(reread).catch(reread); });
    void refreshSuggestions().then(reread).catch(reread);
    window.addEventListener(SUGGESTIONS_CHANGED, reread);
    return () => { alive = false; off(); window.removeEventListener(SUGGESTIONS_CHANGED, reread); };
  }, []);
  return doc;
}

/** Number of suggestions waiting for the athlete, for the navigation badge. */
export function useSuggestionCount() {
  const doc = useCoachSuggestions();
  return visibleSuggestions(doc, new Date().toISOString()).length;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2 text-sm"><dt className="text-muted">{label}</dt><dd className="min-w-0">{children}</dd></div>;
}

function SuggestionCard({ s, onResult }: { s: CoachSuggestion; onResult: (message: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<ProposedChange>({ toDate: s.change.toDate, minutes: s.change.minutes, intensity: s.change.intensity });
  const run = async (work: () => Promise<{ ok: boolean; message: string }>) => {
    setBusy(true);
    try { onResult((await work()).message); } finally { setBusy(false); }
  };
  const tomorrow = new Date(Date.now() + 86400000).toISOString();
  const editable = s.kind === "MOVE" || s.kind === "REDUCE";
  return (
    <article className="home-card fk-suggestion-card p-4" data-testid="coach-suggestion" aria-label={`方坤建议：${KIND_LABEL[s.kind]}`}>
      <header className="flex items-center justify-between gap-2">
        <h3 className="text-base font-bold"><span className="mr-2 rounded-md bg-surface-2 px-2 py-0.5 text-xs">{KIND_LABEL[s.kind]}</span>{s.target.title}</h3>
        <span className="shrink-0 text-xs text-muted">{STATUS_LABEL[s.status]}</span>
      </header>
      <dl className="mt-3 space-y-1.5">
        <Row label="修改原因">{s.reason}</Row>
        <Row label="原安排">{s.original}</Row>
        <Row label="建议安排"><b>{s.proposed}</b></Row>
        <Row label="影响">{s.impact}</Row>
        <Row label="依据">{s.basis.items.join("；")}</Row>
        <Row label="不确定性">{s.uncertainty}</Row>
        {[s.companion.warmup, s.companion.recovery, s.companion.diet].some(Boolean) ? <Row label="配套">{[s.companion.warmup && `热身：${s.companion.warmup}`, s.companion.recovery && `恢复：${s.companion.recovery}`, s.companion.diet && `饮食：${s.companion.diet}`].filter(Boolean).join(" ")}</Row> : null}
      </dl>
      {editing ? (
        <div className="mt-3 grid gap-2 rounded-xl bg-surface-2 p-3 text-sm">
          {s.kind === "MOVE" ? <label className="grid gap-1">移到日期<input type="date" value={edit.toDate ?? ""} min={new Date().toISOString().slice(0, 10)} onChange={e => setEdit({ ...edit, toDate: e.target.value })} className="rounded-xl border border-line px-3" /></label> : null}
          {s.kind === "REDUCE" ? <>
            <label className="grid gap-1">时长（分钟，不超过原来的 {s.target.minutes}）<input type="number" inputMode="numeric" min={10} max={s.target.minutes} value={edit.minutes ?? ""} onChange={e => setEdit({ ...edit, minutes: Number(e.target.value) })} className="rounded-xl border border-line px-3" /></label>
            <label className="grid gap-1">强度<select value={edit.intensity ?? s.target.intensity} onChange={e => setEdit({ ...edit, intensity: e.target.value as Intensity })} className="rounded-xl border border-line px-3">
              <option value="EASY">轻松</option>{s.target.intensity !== "EASY" ? <option value="MODERATE">中等</option> : null}{s.target.intensity === "HARD" ? <option value="HARD">高强度（不变）</option> : null}
            </select></label>
          </> : null}
          <div className="flex gap-2">
            <button type="button" disabled={busy} className="fk-primary flex-1 px-3" onClick={() => run(() => decideSuggestion(s.id, { action: "EDIT_ACCEPT", change: edit }))}>确认修改后接受</button>
            <button type="button" disabled={busy} className="min-h-11 rounded-xl border border-line px-3" onClick={() => setEditing(false)}>取消</button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={busy} className="fk-primary flex items-center gap-1 px-4" onClick={() => run(() => decideSuggestion(s.id, { action: "ACCEPT" }))}><Check className="size-4" aria-hidden="true" />接受</button>
          {editable ? <button type="button" disabled={busy} className="flex min-h-11 items-center gap-1 rounded-xl border border-line px-3" onClick={() => setEditing(true)}><Pencil className="size-4" aria-hidden="true" />编辑后接受</button> : null}
          <button type="button" disabled={busy} className="flex min-h-11 items-center gap-1 rounded-xl border border-line px-3" onClick={() => run(() => decideSuggestion(s.id, { action: "DEFER", until: tomorrow }))}><Clock className="size-4" aria-hidden="true" />暂缓</button>
          <button type="button" disabled={busy} className="flex min-h-11 items-center gap-1 rounded-xl border border-line px-3" onClick={() => run(() => decideSuggestion(s.id, { action: "REJECT" }))}><X className="size-4" aria-hidden="true" />拒绝</button>
        </div>
      )}
      <p className="mt-2 text-xs text-muted">只有你确认后才会修改正式计划；不处理不会执行，也不会自动加量。</p>
    </article>
  );
}

export function CoachSuggestionsPanel({ compact = false }: { compact?: boolean }) {
  const doc = useCoachSuggestions();
  const [message, setMessage] = useState("");
  const [notify, setNotify] = useState(false);
  useEffect(() => { setNotify(systemNotifyEnabled()); }, []);
  const now = new Date().toISOString();
  const open = visibleSuggestions(doc, now);
  const decided = doc.suggestions.filter(s => s.status === "ACCEPTED" || s.status === "EDITED_ACCEPTED" || s.status === "REJECTED" || s.status === "UNDONE").slice(-5).reverse();
  const notes = doc.notes.filter(n => n.status !== "WITHDRAWN" || !compact).slice(-5).reverse();
  if (compact && !open.length && !message) return null;
  return (
    <section className="fk-suggestions space-y-3" aria-label="方坤建议" data-testid="coach-suggestions-panel">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-bold">方坤建议{open.length ? <span className="ml-2 rounded-full bg-[var(--color-accent)] px-2 text-sm text-[var(--color-accent-fg)]">{open.length}</span> : null}</h2>
        {!compact && typeof Notification !== "undefined" ? (
          <button type="button" className="flex min-h-11 items-center gap-1 text-sm text-muted" aria-pressed={notify}
            onClick={async () => { if (notify) { disableSystemNotify(); setNotify(false); } else setNotify(await enableSystemNotify()); }}>
            <Bell className="size-4" aria-hidden="true" />{notify ? "系统通知已开启" : "开启系统通知"}
          </button>
        ) : null}
      </div>
      {message ? <p role="status" className="rounded-xl bg-surface-2 p-3 text-sm">{message}</p> : null}
      {open.length ? open.map(s => <SuggestionCard key={s.id} s={s} onResult={setMessage} />) : <p className="text-sm text-muted">目前没有需要你确认的调整建议。数据更新后方坤会重新检查。</p>}
      {!compact && decided.length ? (
        <details className="home-card p-4">
          <summary className="cursor-pointer font-bold">已处理的建议与后续跟踪</summary>
          <ul className="mt-2 space-y-2 text-sm">
            {decided.map(s => (
              <li key={s.id} className="border-t border-line pt-2">
                <div className="flex items-start justify-between gap-2">
                  <span><b>{STATUS_LABEL[s.status]}</b> · {s.proposed}</span>
                  {(s.status === "ACCEPTED" || s.status === "EDITED_ACCEPTED") && s.receipt ? <button type="button" className="flex min-h-11 shrink-0 items-center gap-1 text-accent" onClick={async () => setMessage((await undoSuggestion(s.id)).message)}><Undo2 className="size-4" aria-hidden="true" />撤销</button> : null}
                </div>
                {s.outcome ? <p className="text-xs text-muted">{OUTCOME_LABEL[s.outcome.state]}：{s.outcome.reasons.join("；")}</p> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {!compact && notes.length ? (
        <details className="home-card p-4" open>
          <summary className="cursor-pointer font-bold">方坤备注（与你自己的备注分开保存）</summary>
          <ul className="mt-2 space-y-2 text-sm">
            {notes.map(n => <li key={n.id} className="border-t border-line pt-2"><span className="text-xs text-muted">{n.date} · {n.status === "CURRENT" ? "有效" : n.status === "NEEDS_REVIEW" ? "依据已变，待复核" : "已撤回"}</span><p>{n.text}</p>{n.status !== "CURRENT" ? <p className="text-xs text-muted">{n.history.at(-1)?.reason}</p> : null}</li>)}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
