"use client";

import { useEffect } from "react";
import { RotateCcw } from "lucide-react";
import { BodhiLogo } from "@/components/bodhi-logo";
import { useI18n } from "@/components/i18n-provider";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function AppError({ error, reset }: ErrorPageProps) {
  const { m } = useI18n();

  useEffect(() => {
    console.error("[bodhi] Unhandled route error:", error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="w-full rounded-3xl border border-black/6 bg-[var(--surface)] p-6 shadow-xs dark:border-white/10">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--accent-soft)]">
          <BodhiLogo className="h-9 w-9" />
        </div>

        <h1 className="mt-4 text-lg font-semibold tracking-tight text-[var(--foreground)]">
          {m.errorBoundary.title}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--foreground-muted)]">
          {m.errorBoundary.body}
        </p>

        <div className="mt-6 grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="flex h-11 items-center justify-center rounded-2xl border border-black/8 bg-[var(--background)] text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--surface-muted)] dark:border-white/10"
          >
            {m.errorBoundary.reloadApp}
          </button>
          <button
            type="button"
            onClick={() => reset()}
            className="flex h-11 items-center justify-center gap-1.5 rounded-2xl bg-[var(--accent)] text-xs font-semibold text-[#fcfaf6] transition-colors hover:bg-[var(--accent-strong)] dark:text-[#151917]"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {m.errorBoundary.tryAgain}
          </button>
        </div>
      </div>
    </div>
  );
}
