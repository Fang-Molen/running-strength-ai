import { useRef, useState } from "react";
import { ocr } from "@/components/device-import";
import { fromJson, parseScaleText, type ScaleResult } from "@/lib/body/scale-parse";

/** Re-encode through a canvas: drops EXIF/GPS metadata and downsizes to ≤1600px. */
async function cleanImage(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file); const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return await new Promise<Blob>((ok, bad) => c.toBlob(b => b ? ok(b) : bad(new Error("图片处理失败")), "image/jpeg", 0.9));
}
const toDataUrl = (b: Blob) => new Promise<string>((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => bad(r.error); r.readAsDataURL(b); });

export function ScaleScan({ onResult }: { onResult: (r: ScaleResult, how: string) => void }) {
  const [consent, setConsent] = useState(false), [online, setOnline] = useState(true), [busy, setBusy] = useState(false), [msg, setMsg] = useState("");
  const inp = useRef<HTMLInputElement>(null);
  const run = async (file: File) => {
    setBusy(true); setMsg("处理图片…");
    try {
      const img = await cleanImage(file); let res: ScaleResult | null = null, how = "", why = "";
      if (online) {
        setMsg("在线识别中…");
        try { const r = await fetch("/api/scale-ocr", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: await toDataUrl(img) }) });
          const j = await r.json().catch(() => ({})); if (r.ok && j.result) { res = fromJson(j.result); how = "在线识别"; } else why = j.error || `在线识别失败（${r.status}）`;
        } catch { why = "网络不可用"; }
      }
      if (!res || !Object.keys(res.values).length) { setMsg(`${why ? why + "，" : ""}改用本机识别…`); const t = await ocr(img, setMsg); res = parseScaleText(t); how = "本机识别"; }
      if (!Object.keys(res.values).length) { setMsg("没有识别到体脂秤数值，请换一张更清晰的图或手动填写"); return; }
      onResult(res, how); setMsg(`${how}：已填入 ${Object.keys(res.values).length} 项，请核对后点保存${res.suspicious.length ? "；标红的数值超出常见范围，请检查" : ""}`);
    } catch (e) { setMsg(`识别失败：${(e as Error)?.message || "未知错误"}；表单内容已保留`); } finally { setBusy(false); if (inp.current) inp.current.value = ""; }
  };
  return <div className="col-span-2 rounded-xl border border-line p-2 text-xs" aria-label="拍照识别">
    <p className="keep text-xs text-muted">拍照/上传体脂秤App截图或秤的显示屏照片，自动填入下方表单；不会自动保存。图片会去掉拍摄信息（EXIF）并压缩。</p>
    <label className="mt-1 flex items-start gap-1.5"><input type="checkbox" checked={online} onChange={e => setOnline(e.target.checked)} className="mt-0.5" /><span>使用在线识别（图片发送到识别服务，只用于读取数值，不保存）。不勾选则只在本机识别。</span></label>
    <label className="mt-1 flex items-start gap-1.5"><input type="checkbox" aria-label="同意识别说明" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-0.5" /><span>我已了解以上说明，图片中没有其他人的隐私信息。</span></label>
    <input ref={inp} type="file" accept="image/*" aria-label="选择体脂秤图片" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) run(f); }} />
    <button type="button" disabled={!consent || busy} onClick={() => inp.current?.click()} className="mt-2 min-h-11 w-full rounded-xl border border-accent font-bold text-accent disabled:opacity-40">{busy ? "识别中…" : "拍照/上传识别"}</button>
    {msg ? <p className="keep mt-1 text-xs" aria-live="polite">{msg}</p> : null}
  </div>;
}
