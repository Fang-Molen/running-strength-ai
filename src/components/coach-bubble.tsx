import { useEffect } from "react"
import { loadSettings } from "@/lib/ui/app-settings"
import { useState } from "react"
import { AlertTriangle } from "lucide-react"
import { splitReply } from "@/lib/ui/coach-bubble"

export function CoachBubble({ role, text }: { role: "user" | "coach"; text: string }) {
  const [open, setOpen] = useState(false)
  const [ev, setEv] = useState(false)
  useEffect(() => { const st = loadSettings(); setOpen(st.coachStyle === "detailed"); setEv(st.showEvidence) }, [])
  if (role === "user") return <div className="flex justify-end"><p className="fk-bubble-user whitespace-pre-wrap">{text}</p></div>
  const p = splitReply(text)
  return <div className="flex justify-start">
    <div className={"fk-bubble fk-bubble-coach " + (p.risk ? "fk-bubble-risk" : "")} role={p.risk ? "alert" : undefined}>
      {p.risk ? <p className="fk-risk-head"><AlertTriangle className="size-4" />安全提醒 · 请先处理</p> : null}
      <p className="fk-bubble-lead whitespace-pre-wrap">{p.lead}</p>
      {p.points.length ? <ul>{p.points.map((x, i) => <li key={i}>{x}</li>)}</ul> : null}
      {open && p.more.length ? <ul>{p.more.map((x, i) => <li key={i}>{x}</li>)}</ul> : null}
      {ev && p.evidence.length ? <div className="mt-2 rounded-lg bg-surface-2 p-2 text-xs text-muted">{p.evidence.map((x, i) => <p key={i}>{x}</p>)}</div> : null}
      {p.more.length || p.evidence.length ? <div className="mt-1 flex gap-3 text-xs">
        {p.more.length ? <button type="button" className="fk-link" onClick={() => setOpen(!open)}>{open ? "收起" : `展开 ${p.more.length} 条`}</button> : null}
        {p.evidence.length ? <button type="button" className="fk-link" onClick={() => setEv(!ev)}>{ev ? "隐藏依据" : "看依据"}</button> : null}
      </div> : null}
    </div>
  </div>
}
