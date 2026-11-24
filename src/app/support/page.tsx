import type { Metadata } from "next";
import Link from "next/link";
import { BodhiLogo } from "@/components/bodhi-logo";

export const metadata: Metadata = {
  title: "Support — Bodhi",
  description:
    "Help, offline practice guide, and account deletion support for Bodhi Meditation.",
};

export default function SupportPage() {
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
          href="/privacy"
          className="text-sm font-medium text-[var(--accent)] hover:underline"
        >
          Privacy Policy
        </Link>
      </header>

      <article className="space-y-6 rounded-3xl border border-black/6 bg-[var(--surface)] p-6 shadow-2xs sm:p-8 dark:border-white/10">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Bodhi Support
          </h1>
          <p className="mt-1 text-sm text-[var(--foreground-muted)]">
            Calm, distraction-free meditation timer, guided breathing, and
            personal guided audio library.
          </p>
        </div>

        <section className="space-y-2 text-sm leading-relaxed text-[var(--foreground-muted)]">
          <h2 className="text-base font-semibold text-[var(--foreground)]">
            Offline Practice
          </h2>
          <p>
            All acoustic singing bowls, gongs, nature soundscapes, and nasal
            breathing cues work offline in Airplane Mode. Signed-in sessions
            completed offline are queued locally and synced automatically once
            connectivity returns.
          </p>
        </section>

        <section className="space-y-2 text-sm leading-relaxed text-[var(--foreground-muted)]">
          <h2 className="text-base font-semibold text-[var(--foreground)]">
            Guided Tracks
          </h2>
          <p>
            Save links from YouTube, SoundCloud, publicly shared Google Drive
            audio files, or direct audio URLs (.mp3, .m4a, .ogg, .wav, .aac,
            .opus). Direct audio and Google Drive tracks can also be saved
            locally for offline listening.
          </p>
        </section>

        <section className="space-y-2 text-sm leading-relaxed text-[var(--foreground-muted)]">
          <h2 className="text-base font-semibold text-[var(--foreground)]">
            Account &amp; Data Deletion
          </h2>
          <p>
            You can permanently delete your Bodhi account and all synced
            meditation history, presets, and saved links directly inside the
            app via Settings &rarr; Delete Account. You may also request
            deletion by emailing{" "}
            <a
              href="mailto:erykwho@gmail.com?subject=Bodhi%20Account%20Deletion"
              className="font-medium text-[var(--accent)] hover:underline"
            >
              erykwho@gmail.com
            </a>{" "}
            from your account email address.
          </p>
        </section>

        <section className="space-y-2 text-sm leading-relaxed text-[var(--foreground-muted)]">
          <h2 className="text-base font-semibold text-[var(--foreground)]">
            Contact Us
          </h2>
          <p>
            Need help or found a bug? Reach out at{" "}
            <a
              href="mailto:erykwho@gmail.com?subject=Bodhi%20Support"
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
