import type { Metadata } from "next";
import Link from "next/link";
import { BodhiLogo } from "@/components/bodhi-logo";

export const metadata: Metadata = {
  title: "Privacy Policy — Bodhi",
  description:
    "How Bodhi handles your meditation practice data, offline storage, optional sign-in, and account deletion.",
};

export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-6 py-10 text-[var(--foreground)]">
      <header className="mb-8 flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-2.5 text-lg font-semibold tracking-tight"
        >
          <BodhiLogo className="h-7 w-7" />
          <span>Bodhi</span>
        </Link>
        <Link
          href="/support"
          className="text-sm font-medium text-[var(--accent)] hover:underline"
        >
          Support
        </Link>
      </header>

      <article className="space-y-6 rounded-3xl border border-black/6 bg-[var(--surface)] p-6 shadow-2xs sm:p-8 dark:border-white/10">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Privacy Policy
          </h1>
          <p className="mt-1 text-xs text-[var(--foreground-muted)]">
            Last updated: November 24, 2026
          </p>
        </div>

        <section className="space-y-2 text-sm leading-relaxed text-[var(--foreground-muted)]">
          <h2 className="text-base font-semibold text-[var(--foreground)]">
            1. Practice Without an Account
          </h2>
          <p>
            Bodhi&apos;s Meditation Timer, Open-Ended timer, Guided Breathing,
            bells, and ambient soundscapes work completely offline without
            requiring an account. Local preferences and presets remain on your
            device.
          </p>
        </section>

        <section className="space-y-2 text-sm leading-relaxed text-[var(--foreground-muted)]">
          <h2 className="text-base font-semibold text-[var(--foreground)]">
            2. Optional Cloud Sync &amp; Sign-In
          </h2>
          <p>
            If you choose to sign in with Google or Apple to sync your history,
            presets, and guided meditation links across devices, Bodhi stores
            only your account identifier, email address, display name, profile
            image (if provided), saved track links, timer presets, and
            meditation session logs in a PostgreSQL database isolated strictly
            to your account.
          </p>
        </section>

        <section className="space-y-2 text-sm leading-relaxed text-[var(--foreground-muted)]">
          <h2 className="text-base font-semibold text-[var(--foreground)]">
            3. Optional Health Integrations (iOS &amp; Android)
          </h2>
          <p>
            On native mobile apps, if you explicitly opt in to Apple Health
            (Mindful Minutes) or Android Health Connect, Bodhi writes completed
            session durations to your device&apos;s health store. Bodhi never
            sells, shares, or uses health data for advertising or analytics.
          </p>
        </section>

        <section className="space-y-2 text-sm leading-relaxed text-[var(--foreground-muted)]">
          <h2 className="text-base font-semibold text-[var(--foreground)]">
            4. Diagnostics &amp; Zero Advertising
          </h2>
          <p>
            Bodhi contains no third-party ad networks, no cross-app tracking,
            and does not collect advertising identifiers (IDFA/AAID). Crash
            diagnostics may be collected via Sentry with personally identifiable
            information disabled by default solely to fix stability issues.
          </p>
        </section>

        <section className="space-y-2 text-sm leading-relaxed text-[var(--foreground-muted)]">
          <h2 className="text-base font-semibold text-[var(--foreground)]">
            5. Data Export &amp; Permanent Account Deletion
          </h2>
          <p>
            You can export your complete meditation history at any time in CSV
            or JSON format from the History tab. You can permanently delete your
            account and all associated cloud data directly inside the app
            (Settings &rarr; Delete Account, which invokes{" "}
            <code className="font-mono text-xs">DELETE /api/account</code> and
            cascades all sessions, tracks, presets, and refresh tokens).
          </p>
        </section>

        <section className="space-y-2 text-sm leading-relaxed text-[var(--foreground-muted)]">
          <h2 className="text-base font-semibold text-[var(--foreground)]">
            6. Contact
          </h2>
          <p>
            For privacy questions or manual deletion assistance, visit{" "}
            <Link
              href="/support"
              className="font-medium text-[var(--accent)] hover:underline"
            >
              Bodhi Support
            </Link>{" "}
            or email{" "}
            <a
              href="mailto:erykwho@gmail.com"
              className="font-medium text-[var(--accent)] hover:underline"
            >
              erykwho@gmail.com
            </a>
            .
          </p>
        </section>
      </article>
    </main>
  );
}
