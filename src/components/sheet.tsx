import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { lockSheetScroll } from "@/lib/ui/sheet-scroll-lock";

/** 统一底部弹窗：固定头部 + 可滚动中部 + 固定底部按钮；高度跟随屏幕和键盘（visualViewport）；关闭后恢复页面滚动位置。 */
export function Sheet({ title, sub, onClose, footer, children, label, full = false }: { title: ReactNode; sub?: ReactNode; onClose: () => void; footer: ReactNode; children: ReactNode; label: string; full?: boolean }) {
  const [vv, setVv] = useState<{ h: number; kb: number } | null>(null);
  const dialog = useRef<HTMLDivElement>(null), closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null, root = dialog.current;
    root?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')].filter(node => node.getClientRects().length > 0); if (dialogs.at(-1) !== root) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key !== 'Tab' || !root) return;
      const items = [...root.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([type="hidden"]), textarea:not(:disabled), select:not(:disabled), a[href], summary, [contenteditable="true"], [tabindex]')].filter(x => x.tabIndex >= 0 && !x.closest('[hidden], [inert]') && x.getClientRects().length > 0);
      const first = items[0], last = items.at(-1); if (!first || !last) { event.preventDefault(); root.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === root || !root.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === root || !root.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown); return () => { document.removeEventListener('keydown', keydown); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  const scrollY = useRef(0);
  useEffect(() => {
    scrollY.current = window.scrollY;
    const unlock = lockSheetScroll(document.body);
    const v = window.visualViewport;
    const on = () => { if (v) setVv({ h: v.height, kb: Math.max(0, window.innerHeight - v.height - v.offsetTop) }); };
    v?.addEventListener("resize", on); v?.addEventListener("scroll", on); on();
    return () => { const last = unlock(); v?.removeEventListener("resize", on); v?.removeEventListener("scroll", on); if (last) { const y = scrollY.current; window.scrollTo(0, y); requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, y))); setTimeout(() => window.scrollTo(0, y), 120); } };
  }, []);
  const maxH = vv ? `${Math.round(vv.h - 8)}px` : "calc(100dvh - 8px)";
  return <div className="fixed inset-0 z-[70] bg-black/60" onClick={onClose}>
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label} className="fk-sheet absolute inset-x-0 mx-auto flex max-w-xl flex-col rounded-t-3xl border-t border-line bg-[#141518] shadow-2xl"
      style={{ bottom: vv?.kb ?? 0, ...(full ? { height: `min(${maxH}, calc(100dvh - env(safe-area-inset-top) - 8px))` } : {}), maxHeight: `min(${maxH}, calc(100dvh - env(safe-area-inset-top) - 8px))` }} onClick={(e) => e.stopPropagation()}>
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-4 pb-2 pt-3">
        <div className="min-w-0 flex-1"><h2 className="truncate text-lg font-black">{title}</h2>{sub ? <div className="mt-0.5 text-xs text-muted">{sub}</div> : null}</div>
        <button type="button" aria-label="关闭" className="grid size-11 shrink-0 place-items-center rounded-full border border-line" onClick={onClose}><X className="size-5" /></button>
      </header>
      <div className="fk-sheet-content min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3" style={!footer ? { paddingBottom: "max(16px, env(safe-area-inset-bottom))" } : undefined}>{children}</div>
      {footer ? <footer className="shrink-0 border-t border-line px-4 pt-2" style={{ paddingBottom: vv?.kb ? 10 : "max(12px, env(safe-area-inset-bottom))" }}>{footer}</footer> : null}
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
