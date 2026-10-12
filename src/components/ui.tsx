import type { ReactNode } from "react"

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-sm font-bold text-muted">{children}</h2>
}

export function StatusBadge({ tone, children }: { tone: "normal" | "caution" | "risk" | "unknown"; children: ReactNode }) {
  const color = tone === "risk" ? "text-risk" : tone === "caution" ? "text-warn" : tone === "unknown" ? "text-muted" : "text-accent"
  return <p className={"text-2xl font-bold " + color}>{children}</p>
}

export function PrimaryButton({ children, onClick, type = "button" }: { children: ReactNode; onClick?: () => void; type?: "button" | "submit" }) {
  return (
    <button type={type} onClick={onClick} className="h-12 w-full rounded-2xl bg-accent text-base font-bold text-accent-fg">
      {children}
    </button>
  )
}

export function SecondaryButton({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="h-11 w-full rounded-2xl border border-line bg-surface text-sm font-bold">
      {children}
    </button>
  )
}
