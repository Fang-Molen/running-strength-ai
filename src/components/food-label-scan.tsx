import { useRef, useState } from "react";
import { ocr } from "@/lib/vision/local-ocr";
import { mergeLabel, parseNutritionLabel, type LabelKey, type LabelResult } from "@/lib/nutrition/label-parse";
/** 拍营养成分表/小票：本机识字 → （可选）只把文字发给服务端代理整理 → 预填待核对。照片不上传、不保存。 */
export function FoodLabelScan({ onResult }: { onResult: (r: LabelResult, filled: LabelKey[]) => void }) {
  const inp = useRef<HTMLInputElement>(null);
  const [online, setOnline] = useState(false), [consent, setConsent] = useState(false), [busy, setBusy] = useState(false), [msg, setMsg] = useState(""), [raw, setRaw] = useState("");
  async function run(file: File) {
    setBusy(true); setMsg("本机识字中…"); setRaw("");
    try {
      const text = await ocr(file, setMsg); setRaw(text);
      let res = parseNutritionLabel(text);
      if (online && text.trim()) {
        setMsg("在线整理文字中（不发送图片）…");
        try { const r = await fetch("/api/food-ocr", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) }); const j = await r.json().catch(() => ({})); if (r.ok && j.result) res = mergeLabel(res, j.result); else setMsg(`在线整理不可用（${j.error || r.status}），已用本机解析。`); }
        catch { setMsg("在线整理不可用，已用本机解析。"); }
      }
      const filled = (Object.keys(res.values) as LabelKey[]).filter(k => res.values[k] != null);
      if (!filled.length && !res.name) { setMsg(text.trim() ? "没有读到营养数值。可手动填写；空白项保持未知。" : "没有读到文字，请靠近、对准营养成分表再拍，或手动填写。"); return; }
      onResult(res, filled);
      setMsg(`已预填 ${filled.length} 项（橙色框），请逐项核对，读不到的已留空；勾选确认后再保存。`);
    } catch (e) { setMsg(e instanceof Error ? e.message : "识别失败，请手动填写。"); }
    finally { setBusy(false); if (inp.current) inp.current.value = ""; }
  }
  return <section aria-label="拍照识别营养标签" className="rounded-xl border border-line p-3 text-sm">
    <b>拍照识别营养标签 / 小票</b>
    <p className="keep mt-1 text-xs text-muted">照片只在本机识字，不上传、不保存。识别结果只预填下方字段，需你核对并确认后才保存。</p>
    <label className="mt-2 flex items-start gap-1.5 text-xs"><input type="checkbox" aria-label="使用在线整理" checked={online} onChange={e => setOnline(e.target.checked)} className="mt-0.5" /><span>使用在线整理（只把本机识别出的文字发送到 DeepSeek 对应数值，不发送图片）。不勾选则只在本机解析。</span></label>
    <label className="mt-1 flex items-start gap-1.5 text-xs"><input type="checkbox" aria-label="同意饮食识别说明" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-0.5" /><span>我已了解以上说明。</span></label>
    <input ref={inp} type="file" accept="image/*" capture="environment" aria-label="选择营养标签图片" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void run(f); }} />
    <button type="button" disabled={!consent || busy} onClick={() => inp.current?.click()} className="mt-2 min-h-11 w-full rounded-xl border border-accent font-bold text-accent disabled:opacity-40">{busy ? "识别中…" : "拍照 / 选图识别"}</button>
    {msg ? <p className="keep mt-1 text-xs" aria-live="polite" role="status">{msg}</p> : null}
    {raw ? <details className="mt-1 text-xs"><summary className="min-h-10 cursor-pointer text-muted">查看识别出的原文</summary><pre className="whitespace-pre-wrap text-muted">{raw}</pre></details> : null}
  </section>;
}
