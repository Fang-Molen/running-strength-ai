import { useEffect, useState } from "react";
import { confirmDraft, createDraft } from "@/lib/core/control";
import { formatDuration, loadDay, onDayChange, parseDuration, parseKm, removeRun, saveBurn, type DayRecord } from "@/lib/nutrition/day";

export function DayCard({ part }: { part: "run" | "burn" | "all" }) {
  const [day, setDay] = useState<DayRecord>({ date: "", burn: null, runs: [] });
  const [burnText, setBurnText] = useState("");
  const [km, setKm] = useState("");
  const [time, setTime] = useState("");
  const [note, setNote] = useState("");
  const [sentence, setSentence] = useState("");
  const [rpe, setRpe] = useState("");
  const [draft, setDraft] = useState<{ id: string; km: number | null; rpe: number | null } | null>(null);
  const [error, setError] = useState("");
  const [logging, setLogging] = useState(false);

  useEffect(() => {
    const sync = () => {
      const recorded = loadDay();
      setDay(recorded);
      setBurnText(recorded.burn == null ? "" : String(recorded.burn));
    };
    sync();
    return onDayChange(sync);
  }, []);

  function commitBurn() {
    const text = burnText.trim();
    if (!text) {
      saveBurn(null);
      setError("");
      return;
    }
    const value = Number(text);
    if (!Number.isInteger(value) || value < 800 || value > 8000) {
      setError("填运动设备上的今日总消耗，一般是 1500 到 4500，不是那一次的活动热量。");
      return;
    }
    saveBurn(value);
    setError(value < 1400 ? "这个数更像活动热量。总消耗通常还要加上静息，两千上下比较常见。" : "");
  }

  function fillSentence() {
    const next = createDraft(sentence);
    if (next.distanceKm == null && next.durationSec == null && next.rpe == null) {
      setError("没写成事实。先改成例如：今天跑8公里，45分钟，RPE9。还没有记入。");
      return;
    }
    if (next.distanceKm != null) setKm(String(next.distanceKm));
    if (next.durationSec != null) setTime(`${Math.round(next.durationSec / 60)}分`);
    if (next.rpe != null) setRpe(String(next.rpe));
    setDraft({ id: next.id, km: next.distanceKm, rpe: next.rpe });
    setError("已填进下面。改完再点记下，这时才写入。");
  }

  function commitRun() {
    const distance = parseKm(km);
    if (distance == null) {
      setError("距离写成公里，比如 8 或 6.2。");
      return;
    }
    const seconds = parseDuration(time);
    if (seconds == null || seconds > 6 * 3600) {
      setError("用时写成 45分、26分10，或 1:02:00。可以空着。");
      return;
    }
    const effort = Number(rpe);
    const rpeValue = rpe.trim() && effort >= 1 && effort <= 10 ? effort : null;
    confirmDraft(draft ? { id: draft.id, source: "AI_PREFILL", text: sentence, distanceKm: draft.km, durationSec: null, rpe: draft.rpe, note, confirmed: false, createdAt: "" } : null, {
      km: distance,
      seconds,
      note: note.trim().slice(0, 40),
      rpe: rpeValue,
    });
    setKm("");
    setTime("");
    setNote("");
    setSentence("");
    setRpe("");
    setDraft(null);
    setError("");
  }

  return (
    <section className="rounded-card border border-line bg-surface p-4">
      {part !== "burn" ? (
        <>
          <h2 className="text-sm font-bold">今日跑步</h2>
          {day.runs.length ? (
            <ul className="mt-2">
              {day.runs.map((run) => (
                <li key={run.id} className="flex items-center gap-2 py-1 text-sm">
                  <span className="min-w-0 flex-1">
                    {run.km} 公里{run.seconds ? ` · ${formatDuration(run.seconds)}` : ""}{run.note ? ` · ${run.note}` : ""}
                  </span>
                  <button type="button" className="h-10 shrink-0 px-2 text-sm text-muted" onClick={() => removeRun(run.id)}>删</button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-muted">今天还没有跑步记录</p>
          )}
          {logging ? (
            <>
              <div className="mt-3 flex gap-2">
                <input value={sentence} onChange={(event) => setSentence(event.target.value)} placeholder="今天跑8公里，45分钟，RPE9" className="h-11 min-w-0 flex-1 rounded-2xl border border-line bg-bg px-3 text-sm outline-none" />
                <button type="button" onClick={fillSentence} className="h-11 shrink-0 rounded-2xl border border-line px-3 text-sm font-bold">填入</button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input value={km} inputMode="decimal" onChange={(event) => setKm(event.target.value)} placeholder="公里" className="h-11 rounded-2xl border border-line bg-bg px-3 text-sm outline-none" />
                <input value={time} onChange={(event) => setTime(event.target.value)} placeholder="用时" className="h-11 rounded-2xl border border-line bg-bg px-3 text-sm outline-none" />
              </div>
              <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="轻松跑，或 400米×8" className="mt-2 h-11 w-full rounded-2xl border border-line bg-bg px-3 text-sm outline-none" />
              <input value={rpe} inputMode="numeric" onChange={(event) => setRpe(event.target.value)} placeholder="RPE，可不填" className="mt-2 h-11 w-full rounded-2xl border border-line bg-bg px-3 text-sm outline-none" />
              <button type="button" onClick={commitRun} className="mt-2 h-11 rounded-2xl bg-accent px-4 text-sm font-bold text-accent-fg">记下这节跑</button>
            </>
          ) : (
            <button type="button" onClick={() => setLogging(true)} className="mt-2 h-11 text-sm font-bold text-accent">记录跑步</button>
          )}
        </>
      ) : null}
      {part !== "run" ? (
        <div className={part === "all" ? "mt-4 border-t border-line pt-3" : ""}>
          <h2 className="text-sm font-bold">设备总消耗（手表总消耗等）</h2>
          <p className="mt-1 text-xs text-muted">手表全天总消耗（静息＋活动），不是单次训练热量。记录后不会再把跑步或力量消耗加一次。</p>
          <div className="mt-2 flex gap-2">
            <input value={burnText} inputMode="numeric" onChange={(event) => setBurnText(event.target.value)} placeholder="比如 2410" className="h-11 min-w-0 flex-1 rounded-2xl border border-line bg-bg px-3 text-sm outline-none" />
            <button type="button" onClick={commitBurn} className="h-11 shrink-0 rounded-2xl border border-line px-3 text-sm font-bold">记下</button>
          </div>
          {day.burn != null ? (
            <button type="button" className="mt-1 h-10 text-sm text-muted" onClick={() => { saveBurn(null); setBurnText(""); setError(""); }}>
              已记 {day.burn} 千卡。改回估算
            </button>
          ) : <p className="mt-1 text-sm text-muted">尚未记录设备总消耗</p>}
        </div>
      ) : null}
      {error ? <p className="mt-2 text-sm text-warn">{error}</p> : null}
    </section>
  );
}
