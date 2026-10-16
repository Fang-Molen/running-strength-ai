import { useEffect, useRef, useState } from "react";
import { fmtRest } from "@/lib/strength/rest";

type Item = { name: string; planned: number | null };
type Log = { name: string; planned: number | null; actual: number; at: string };
/** 组间休息计时：计划休息倒计时（未设置则正计时），可暂停/继续；结束时记录实际休息，计划值不改。 */
export function RestTimer({ items, log, onLog }: { items: Item[]; log: Log[]; onLog: (r: Log) => void }) {
  const [sel, setSel] = useState(0);
  const [run, setRun] = useState<{ startedAt: number; acc: number; paused: boolean } | null>(null);
  const [, tick] = useState(0);
  const iv = useRef<number | null>(null);
  useEffect(() => { if (run && !run.paused) { iv.current = window.setInterval(() => tick((n) => n + 1), 250); return () => { if (iv.current) clearInterval(iv.current); }; } }, [run]);
  if (!items.length) return null;
  const it = items[Math.min(sel, items.length - 1)];
  const elapsed = run ? run.acc + (run.paused ? 0 : (Date.now() - run.startedAt) / 1000) : 0;
  const left = it.planned != null ? Math.max(0, it.planned - elapsed) : null;
  const done = left === 0;
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const finish = () => { if (!run) return; onLog({ name: it.name, planned: it.planned, actual: Math.round(elapsed), at: new Date().toISOString() }); setRun(null); };
  const mine = log.filter((l) => l.name === it.name);
  return <div className="mb-2 rounded-xl border border-line p-2 text-sm" aria-label="组间休息计时">
    <div className="fk-chips flex-wrap">{items.map((x, i) => <button key={i} type="button" aria-pressed={i === sel} disabled={!!run} className="fk-chip" onClick={() => setSel(i)}>{x.name}</button>)}</div>
    <div className="mt-2 flex items-center gap-2">
      <div className="min-w-0 flex-1"><p className="text-xs text-muted">计划组间休息：{fmtRest(it.planned)}{it.planned == null ? "（正计时）" : ""}</p>
        <p role="timer" aria-label="休息计时" className={"text-3xl font-black tabular-nums " + (done ? "text-emerald-400" : "text-accent")}>{run ? (left != null ? mmss(left) : mmss(elapsed)) : it.planned != null ? mmss(it.planned) : "0:00"}</p>
        {done ? <p className="text-xs text-emerald-400">休息到点，可以开始下一组</p> : null}</div>
      {!run ? <button type="button" className="fk-orange-btn min-h-11 rounded-xl px-4 font-bold" onClick={() => setRun({ startedAt: Date.now(), acc: 0, paused: false })}>开始休息</button>
        : <div className="flex flex-col gap-1">
          <button type="button" className="min-h-10 rounded-xl border border-line px-3" onClick={() => setRun(run.paused ? { ...run, startedAt: Date.now(), paused: false } : { ...run, acc: elapsed, paused: true })}>{run.paused ? "继续" : "暂停"}</button>
          <button type="button" className="fk-orange-btn min-h-10 rounded-xl px-3 font-bold" onClick={finish}>结束并记录</button></div>}
    </div>
    {mine.length ? <p className="mt-1 text-xs text-muted">实际休息记录：{mine.slice(-6).map((l) => fmtRest(l.actual)).join("、")}</p> : null}
  </div>;
}
