import { useEffect, useState } from "react"
/** Small "已保存" indicator shown after an auto-save. Pass a changing `stamp` each time something is saved. */
export function SavedBadge({ stamp, text = "已保存" }: { stamp: number; text?: string }) {
  const [show, setShow] = useState(false)
  useEffect(() => { if (!stamp) return; setShow(true); const t = window.setTimeout(() => setShow(false), 2200); return () => window.clearTimeout(t) }, [stamp])
  return <span aria-live="polite" className={"fk-saved " + (show ? "fk-saved-on" : "")}>{show ? `✓ ${text}` : ""}</span>
}
