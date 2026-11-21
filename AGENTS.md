# Bodhi — Project Context & Agent Instructions

Mobile-first meditation web application (**PWA**) designed for calm, distraction-free practice.

## Mandatory Language Rule

- **All versioned files MUST be written in English** — including source code, comments, UI copy, `AGENTS.md`, `README.md`, documentation, commit messages, and pull request titles/descriptions — regardless of the language used in the conversation with the user.
- In conversation, reply in the language the user is speaking.

## Stack & Infrastructure

- **Framework:** Next.js 16 (App Router, TypeScript, Turbopack), React 19, Tailwind CSS v4, Lucide icons, Zod.
- **Package Manager:** `pnpm` (v12, with `pnpm-workspace.yaml` enabling `allowBuilds` for Prisma and esbuild).
- **Database:** Neon PostgreSQL + Prisma v6 (`prisma/schema.prisma`, with `scripts/vercel-db-sync.mjs` syncing schema automatically on `VERCEL_ENV=production`).
- **Authentication:** Auth.js v5 (`next-auth@beta`, JWT session) with **Google OAuth 2.0** and optional `ALLOWED_EMAILS` allowlist (if empty/unset, any Google account is allowed). Route handling via `src/proxy.ts`. Login is optional — the Meditation Timer remains 100% public while signing in unlocks cloud-synced Favorite Guided Tracks (V2) and Meditation History (V3).
- **Audio Engine:**
  - Native Web Audio API synthesis (`src/lib/audio/`) for singing bowl start/end bells and looping ambient background sounds (starting with White Noise), architected to support future static audio files (`.mp3`/`.ogg`).
  - Official **YouTube IFrame Player API** and **SoundCloud Widget API** (`src/components/guided-session-player.tsx`) for full-track guided sessions.
- **Testing & Linting:** Vitest (`pnpm test`), ESLint (`pnpm lint`).
- **Hosting:** Vercel (continuous deployment from `master`).

## Product Roadmap

1. **V1 — Meditation Timer (Completed):**
   - Public timer with no login required.
   - Duration presets (`5`, `10`, `15`, `20`, `30` min) + custom duration (`1–180` min).
   - Optional warm-up countdown (`Off`, `5s`, `10s`).
   - Singing bowl start & end bells.
   - Selectable and previewable background sounds (`Silence` and `White Noise`).
   - Timestamp-based drift-free countdown (`endTime - Date.now()`), Screen Wake Lock API, light/dark organic theme, and installable PWA.
2. **V2 — Favorite Guided Tracks (SoundCloud & YouTube) + Auth + Neon + Pull-to-Refresh (Completed):**
   - Optional Google OAuth (`src/auth.config.ts`, `src/lib/auth.ts`) and Neon PostgreSQL via Prisma (`User`, `FavoriteTrack`).
   - Favorite tracks list where users paste a YouTube or SoundCloud URL (auto-detected provider + oEmbed metadata via `src/lib/tracks/`) and start a focused session playing the full track (no countdown timer), with optional closing singing bowl bell and Wake Lock.
   - Mobile PWA Pull-to-Refresh (`src/components/pull-to-refresh.tsx`, `src/lib/pull-to-refresh.ts`), automatically disabled during active sessions.
3. **V3 — Meditation History (Completed):**
   - `MeditationSession` Prisma model (`SessionMode`: `TIMER | TRACK`) storing date, actual duration, completion status, track snapshot, and optional reflection note.
   - Automatic session logging on completion for signed-in users, plus an inline prompt to save early stops with at least 1 minute elapsed (`MIN_SAVEABLE_EARLY_STOP_SECONDS = 60`).
   - History view (`src/components/meditation-history.tsx`) with 3-column KPI strip (total time meditated, current daily streak, total sessions) and chronological session log with inline note editing and deletion.
4. **V4 — Offline PWA / Airplane Mode (Current):**
   - Zero-dependency Service Worker (`public/sw.js`, registered via `src/components/sw-register.tsx`) with silent automatic updates, Network-First navigation fallback to cached `/`, Cache-First static assets/icons, and strict Network-Only `/api/*` & `/api/auth/*` handling.
   - Offline session queue and local history cache (`src/lib/offline/queue.ts` + `queue.test.ts`, `use-network-status.ts`) so signed-in Timer sessions completed offline queue locally with a `Pending sync` badge and automatically sync to Neon PostgreSQL when back online.
   - Subtle offline/syncing status pill below the header (hidden during active sessions) and serene offline state in `GuidedTracks` with a quick shortcut to the Timer.

## Directory Structure (V4)

- `public/sw.js` — Offline PWA Service Worker (served with `Cache-Control: no-cache` via `next.config.ts` and excluded from `src/proxy.ts`).
- `prisma/schema.prisma` — `User`, `FavoriteTrack`, and `MeditationSession` models (`TrackProvider`: `YOUTUBE | SOUNDCLOUD`, `SessionMode`: `TIMER | TRACK`).
- `scripts/vercel-db-sync.mjs` — Automatic Prisma schema sync on Vercel production deploys.
- `src/app/` — App Router layout, global styles, PWA `manifest.ts`, server actions (`actions.ts`), main page, and REST API routes (`/api/auth/[...nextauth]`, `/api/tracks`, `/api/tracks/resolve`, `/api/tracks/[id]`, `/api/sessions`, `/api/sessions/[id]`).
- `src/lib/timer/` — Pure timestamp-based timer calculations (`engine.ts`, `types.ts`) and Vitest unit tests (`engine.test.ts`).
- `src/lib/audio/` — Extensible sound catalog (`sounds.ts`) and Web Audio API engine (`engine.ts`).
- `src/lib/tracks/` — YouTube/SoundCloud URL parser (`providers.ts` + `providers.test.ts`), oEmbed metadata resolver (`oembed.ts`), and shared types (`types.ts`).
- `src/lib/history/` — Pure history statistics & daily streak engine (`stats.ts` + `stats.test.ts`), client API helpers with offline fallback (`client.ts`), and shared types (`types.ts`).
- `src/lib/offline/` — Offline session queue & history cache (`queue.ts` + `queue.test.ts`) and reactive online status hook (`use-network-status.ts`).
- `src/lib/pull-to-refresh.ts` + `pull-to-refresh.test.ts` — Pure rubber-band pull-to-refresh physics and tests.
- `src/lib/wake-lock.ts` — Screen Wake Lock hook.
- `src/components/` — `BodhiShell`, `BodhiLogo`, `ThemeProvider`, `ServiceWorkerRegister`, `PullToRefresh`, `MeditationTimer`, `GuidedTracks`, `GuidedSessionPlayer`, and `MeditationHistory`.
- `public/icons/` — Official Bodhi leaf SVG, transparent PNG favicon, and PWA PNG icons.

## Commands & Conventions

- `pnpm test` — Run unit tests (Vitest). Always add or update tests when changing `src/lib/timer/`, `src/lib/tracks/`, `src/lib/history/`, `src/lib/pull-to-refresh.ts`, or other pure domain logic.
- `pnpm lint` — Run ESLint checks.
- `pnpm build` — Run `prisma generate && node scripts/vercel-db-sync.mjs && next build` (always validate `pnpm test`, `pnpm lint`, and `pnpm build` before opening a PR).
- **Git Commit Author (required for Vercel Hobby):** Before creating any commit, ensure:
  - `git config user.name "Eryk Humberto Oliveira Alves"`
  - `git config user.email "erykwho@gmail.com"`
- **Pull Request Workflow:** Always work on a dedicated feature branch and open a Pull Request against `master` via `gh pr create` instead of pushing directly to `master`. Before pushing new commits to an existing branch in an ongoing conversation, check the PR state (`gh pr view --json state`); if `CLOSED` or `MERGED`, fetch `origin` and create a new branch from `origin/master`.
- **UI Mobile-First & Vertical Density:** Bodhi is used primarily as a mobile PWA (~360–414px width). Keep controls single-row where possible, avoid wrapped button groups taking excessive vertical space, and ensure the main timer dial and primary action fit comfortably above the fold.
- **Visual Direction:** Serene and organic palette — warm stone/sand light mode, deep warm charcoal dark mode, sage green primary accent, subtle warm amber highlight, with FOUC-free light/dark theme switching.
