import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";

/** 统一底部弹窗：固定头部 + 可滚动中部 + 固定底部按钮；高度跟随屏幕和键盘（visualViewport）；关闭后恢复页面滚动位置。 */
export function Sheet({ title, sub, onClose, footer, children, label }: { title: ReactNode; sub?: ReactNode; onClose: () => void; footer: ReactNode; children: ReactNode; label: string }) {
  const [vv, setVv] = useState<{ h: number; kb: number } | null>(null);
  const scrollY = useRef(0);
  useEffect(() => {
    scrollY.current = window.scrollY;
    const body = document.body.style; const prev = { o: body.overflow };
    body.overflow = "hidden";
    const v = window.visualViewport;
    const on = () => { if (v) setVv({ h: v.height, kb: Math.max(0, window.innerHeight - v.height - v.offsetTop) }); };
    v?.addEventListener("resize", on); v?.addEventListener("scroll", on); on();
    return () => { body.overflow = prev.o; v?.removeEventListener("resize", on); v?.removeEventListener("scroll", on); const y = scrollY.current; window.scrollTo(0, y); requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, y))); setTimeout(() => window.scrollTo(0, y), 120); };
  }, []);
  const maxH = vv ? `${Math.round(vv.h - 8)}px` : "calc(100dvh - 8px)";
  return <div className="fixed inset-0 z-[70] bg-black/60" onClick={onClose}>
    <div role="dialog" aria-modal="true" aria-label={label} className="fk-sheet absolute inset-x-0 mx-auto flex max-w-xl flex-col rounded-t-3xl border-t border-line bg-[#141518] shadow-2xl"
      style={{ bottom: vv?.kb ?? 0, maxHeight: `min(${maxH}, calc(100dvh - env(safe-area-inset-top) - 8px))` }} onClick={(e) => e.stopPropagation()}>
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-4 pb-2 pt-3">
        <div className="min-w-0 flex-1"><h2 className="truncate text-lg font-black">{title}</h2>{sub ? <div className="mt-0.5 text-xs text-muted">{sub}</div> : null}</div>
        <button type="button" aria-label="关闭" className="grid size-11 shrink-0 place-items-center rounded-full border border-line" onClick={onClose}><X className="size-5" /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">{children}</div>
      <footer className="shrink-0 border-t border-line px-4 pt-2" style={{ paddingBottom: vv?.kb ? 10 : "max(12px, env(safe-area-inset-bottom))" }}>{footer}</footer>
    </div>
  </div>;
}

export function Toast({ msg }: { msg: string }) {
  if (!msg) return null;
  return <div role="status" className="fixed left-1/2 top-[calc(env(safe-area-inset-top)+12px)] z-[90] -translate-x-1/2 rounded-full bg-emerald-500 px-4 py-2 text-sm font-bold text-black shadow-lg">{msg}</div>;
}
export function useToast(): [string, (m: string) => void] {
  const [m, setM] = useState("");
  useEffect(() => { if (!m) return; const t = setTimeout(() => setM(""), 1800); return () => clearTimeout(t); }, [m]);
  return [m, setM];
}
