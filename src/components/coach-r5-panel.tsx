import { useEffect, useState } from "react";
import { currentAthleteId, ATHLETE_SCOPE_CHANGED } from "@/lib/core/events";
import { readR5Commands, decideR5Command, R5_CHANGED } from "@/lib/coach/r5/host";
import type { R5Command } from "@/lib/coach/r5/commands";
const labels: Record<R5Command["status"], string> = {
  PENDING: "待你确认",
  ACCEPTED: "已生效",
  REJECTED: "已拒绝",
  UNDONE: "已撤销",
  STALE: "依据已变，请重新预览",
};
export function CoachR5Panel() {
  const [commands, setCommands] = useState<R5Command[]>([]),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const update = () => {
      setCommands(readR5Commands());
      setNotice("");
    };
    update();
    for (const e of [R5_CHANGED, ATHLETE_SCOPE_CHANGED, "storage"])
      window.addEventListener(e, update);
    return () => {
      for (const e of [R5_CHANGED, ATHLETE_SCOPE_CHANGED, "storage"])
        window.removeEventListener(e, update);
    };
  }, []);
  const act = async (id: string, action: "ACCEPT" | "REJECT" | "UNDO") => {
    const owner = currentAthleteId();
    setBusy(true);
    const r = await decideR5Command(id, action);
    if (owner === currentAthleteId()) {
      setCommands(readR5Commands());
      setNotice(r.message);
    }
    setBusy(false);
  };
  if (!commands.length) return null;
  return (
    <section
      className="home-card my-3 space-y-3 p-4"
      aria-label="对话修改确认"
      data-testid="r5-confirmations"
    >
      <h3 className="font-bold">资料与课表修改</h3>
      <p className="text-xs text-muted">预览后由你决定，正式记录保留历史和撤销。</p>
      {commands.slice(0, 5).map((c) => (
        <article
          key={c.id}
          className="rounded-xl border border-line p-3"
          data-testid="r5-confirm-card"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong className="text-sm">{labels[c.status]}</strong>
            <span className="text-xs text-muted">
              {new Date(c.createdAt).toLocaleString("zh-CN")}
            </span>
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {c.diff.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
          {c.warnings.map((w, i) => (
            <p key={i} className="mt-2 text-xs text-muted">
              {w}
            </p>
          ))}
          {c.status === "PENDING" ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                className="min-h-11 rounded-xl bg-accent px-4 font-bold text-accent-fg"
                onClick={() => void act(c.id, "ACCEPT")}
              >
                确认修改
              </button>
              <button
                type="button"
                disabled={busy}
                className="min-h-11 rounded-xl border border-line px-4"
                onClick={() => void act(c.id, "REJECT")}
              >
                拒绝
              </button>
            </div>
          ) : null}
          {c.status === "ACCEPTED" ? (
            <button
              type="button"
              disabled={busy}
              className="mt-2 min-h-11 rounded-xl border border-line px-4 text-sm"
              onClick={() => void act(c.id, "UNDO")}
            >
              撤销这次修改
            </button>
          ) : null}
          <details className="mt-2 text-xs text-muted">
            <summary className="min-h-8 cursor-pointer">版本与操作记录</summary>
            {c.history.map((h, i) => (
              <p key={i}>
                {h.at} · {h.action}
              </p>
            ))}
          </details>
        </article>
      ))}
      {notice ? (
        <p role="status" className="text-sm">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
