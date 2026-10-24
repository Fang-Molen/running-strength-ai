import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { StrengthApp } from "@/components/strength-app";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  // The training screen reads browser-local dates and storage. Rendering it
  // during SSR can select a different day from the athlete's time zone.
  return <ClientOnly fallback={
    <main className="grid min-h-dvh place-items-center bg-bg px-6 text-fg" role="status" aria-live="polite" data-testid="training-app" data-ready="false">
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="fk-boot-mark" aria-hidden="true">坤</span>
        <p className="text-sm text-muted">正在读取本地训练记录…</p>
        <div className="mt-2 flex w-64 max-w-full flex-col gap-2" aria-hidden="true">
          <div className="fk-skeleton h-3" />
          <div className="fk-skeleton h-3 w-4/5 self-center" />
        </div>
      </div>
    </main>
  }><StrengthApp /></ClientOnly>;
}
