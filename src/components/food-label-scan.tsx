import { useRef, useState, type ReactNode } from "react";
import { ocr } from "@/lib/vision/local-ocr";
import { mergeLabel, parseNutritionLabel, type LabelKey, type LabelResult } from "@/lib/nutrition/label-parse";
import { isOnlineOn } from "@/lib/ui/online-features";
/** 拍营养成分表/小票：本机识字 → 联网整理（设置里可关，只发文字）→ 预填待核对。照片不上传、不保存。 */
export function FoodLabelScan({ onResult, children }: { onResult: (r: LabelResult, filled: LabelKey[]) => void; children?: ReactNode }) {
  const inp = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState(""), [raw, setRaw] = useState("");
  const online = isOnlineOn("ocrText");
  async function run(file: File) {
    setBusy(true); setMsg("本机识字中…"); setRaw("");
    try {
      const text = await ocr(file, setMsg); setRaw(text);
      let res = parseNutritionLabel(text);
      if (online && text.trim()) {
        setMsg("联网整理文字中（不发送图片）…");
        try { const r = await fetch("/api/food-ocr", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) }); const j = await r.json().catch(() => ({})); if (r.ok && j.result) res = mergeLabel(res, j.result); else setMsg(`联网整理不可用（${j.error || r.status}），已用本机解析。`); }
        catch { setMsg("联网整理不可用，已用本机解析。"); }
      }
      const filled = (Object.keys(res.values) as LabelKey[]).filter(k => res.values[k] != null);
      if (!filled.length && !res.name) { setMsg(text.trim() ? "没有读到营养数值。可自己填写；空白项保持未知。" : "没有读到文字，请对准营养成分表再拍，或自己填写。"); return; }
      onResult(res, filled);
      setMsg(`已预填 ${filled.length} 项（橙色框），读不到的留空，核对后保存。`);
    } catch (e) { setMsg(e instanceof Error ? e.message : "识别失败，请自己填写。"); }
    finally { setBusy(false); if (inp.current) inp.current.value = ""; }
  }
  return <section aria-label="拍照识别" className="rounded-xl border border-line p-3 text-sm">
    <input ref={inp} type="file" accept="image/*" capture="environment" aria-label="选择营养标签图片" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void run(f); }} />
    <button type="button" disabled={busy} onClick={() => inp.current?.click()} className="min-h-11 w-full rounded-xl border border-accent font-bold text-accent disabled:opacity-40">{busy ? "识别中…" : "拍照 / 选图识别（营养标签·小票）"}</button>
    <p className="keep mt-1 text-[11px] text-muted">照片只在本机识字、不上传；{online ? "识出的文字会联网整理" : "联网整理已关闭"}（设置里可改）。</p>
    {msg ? <p className="keep mt-1 text-xs" aria-live="polite" role="status">{msg}</p> : null}
    {raw ? <details className="mt-1 text-xs"><summary className="min-h-10 cursor-pointer text-muted">查看识别出的原文</summary><pre className="whitespace-pre-wrap text-muted">{raw}</pre></details> : null}
    {children}
  </section>;
}
