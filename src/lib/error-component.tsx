import type { ErrorComponentProps } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import { isChunkError, recoverFromChunkError } from "@/lib/chunk-recover";

const FALLBACK_MESSAGE = "发生了意外错误，请重新加载页面。";

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return FALLBACK_MESSAGE;
}

export function AppErrorComponent({ error }: ErrorComponentProps) {
  useEffect(() => { if (isChunkError(error)) void recoverFromChunkError(); }, [error]);
  return (
    <main
      role="alert"
      className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-bg px-6 text-center text-fg"
    >
      <span className="text-risk" aria-hidden="true">
        <TriangleAlert className="size-10" strokeWidth={2} />
      </span>
      <h1 className="text-lg font-semibold">页面出错了</h1>
      <p className="max-w-md text-sm break-words text-muted">{errorMessage(error)}</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-2 min-h-11 rounded-xl bg-[var(--color-accent)] px-5 font-semibold text-[var(--color-accent-fg)]"
      >
        重新加载
      </button>
    </main>
  );
}
