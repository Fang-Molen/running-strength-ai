import { useState } from "react";
const KEY = "fk-feedback-v1";
type Item = { at: string; answer: string; question?: string; note: string };
export function loadFeedback(): Item[] { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } }
export function exportFeedback() {
  const blob = new Blob([JSON.stringify({ app: "fangkun-beta", exportedAt: new Date().toISOString(), items: loadFeedback() }, null, 2)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `方坤反馈-${new Date().toISOString().slice(0, 10)}.json`; a.click();
}
export function CoachFeedback({ answer, question }: { answer: string; question?: string }) {
  const [open, setOpen] = useState(false); const [note, setNote] = useState(""); const [done, setDone] = useState(false);
  if (done) return <p className="ml-2 text-xs text-muted">已记下反馈（本机保存）</p>;
  if (!open) return <button type="button" className="ml-2 text-xs text-muted underline" onClick={() => setOpen(true)}>反馈/报错</button>;
  return <div className="ml-2 mt-1 flex gap-2"><input className="min-h-9 flex-1 rounded border border-line bg-surface px-2 text-sm" placeholder="哪里不对？" value={note} onChange={(e) => setNote(e.target.value)} />
    <button type="button" className="rounded border border-line px-2 text-sm" onClick={() => { const list = loadFeedback(); list.push({ at: new Date().toISOString(), answer, question, note }); localStorage.setItem(KEY, JSON.stringify(list)); setDone(true); }}>保存</button></div>;
}
export function FeedbackExportBar() {
  const [n, setN] = useState(() => typeof localStorage === "undefined" ? 0 : loadFeedback().length);
  return <div className="flex items-center justify-between rounded-card border border-line px-3 py-2 text-xs text-muted"><span>测试版 · 已存反馈 {n} 条</span><button type="button" className="underline" onClick={() => { exportFeedback(); setN(loadFeedback().length); }}>导出反馈</button></div>;
}
