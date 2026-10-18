import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { StrengthApp } from "@/components/strength-app";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  // The training screen reads browser-local dates and storage. Rendering it
  // during SSR can select a different day from the athlete's time zone.
  return <ClientOnly fallback={
    <main className="min-h-screen bg-bg p-6 text-fg" role="status" data-testid="training-app" data-ready="false">
      正在读取本地训练记录…
    </main>
  }><StrengthApp /></ClientOnly>;
}
