# Bodhi — Project Context & Agent Instructions

Mobile-first meditation web application (**PWA**) designed for calm, distraction-free practice.

## Mandatory Language Rule

- **All versioned files MUST be written in English** — including source code, comments, UI copy, `AGENTS.md`, `README.md`, documentation, commit messages, and pull request titles/descriptions — regardless of the language used in the conversation with the user.
- In conversation, reply in the language the user is speaking.

## Stack & Infrastructure

- **Framework:** Next.js 16 (App Router, TypeScript, Turbopack), React 19, Tailwind CSS v4, Lucide icons, Zod.
- **Package Manager:** `pnpm` (v12, with `pnpm-workspace.yaml` enabling `allowBuilds` for Prisma and esbuild).
- **Database:** Neon PostgreSQL + Prisma v6 (`prisma/schema.prisma`, with `scripts/vercel-db-sync.mjs` syncing schema automatically on `VERCEL_ENV=production`).
- **Authentication:** Auth.js v5 (`next-auth@beta`, JWT session) with **Google OAuth 2.0** and optional `ALLOWED_EMAILS` allowlist (if empty/unset, any Google account is allowed). Route handling via `src/proxy.ts`. Login is optional — the Meditation Timer remains 100% public while signing in unlocks cloud-synced Favorite Guided Tracks, Meditation History, and Practice Presets.
- **Audio Engine:**
  - Native Web Audio API synthesis (`src/lib/audio/`) with 7 configurable bells (`None`, `Singing Bowl`, `Tibetan Healing Bowl`, `Deep Gong`, `Soft Chime`, `Crystal Bowl`, `Wood Block`) for start, interval, and end chimes, and 7 offline ambient soundscapes (`Silence`, `White Noise`, `Pink Noise`, `Brown Noise`, `Gentle Rain`, `Ocean Waves`, `Warm Drone`), architected to support future static audio files (`.mp3`/`.ogg`).
  - Official **YouTube IFrame Player API** and **SoundCloud Widget API** (`src/components/guided-session-player.tsx`) for full-track guided sessions.
- **Testing & Linting:** Vitest (`pnpm test`), ESLint (`pnpm lint`).
- **Hosting:** Vercel (continuous deployment from `master`).

## Product Roadmap

1. **V1 — Meditation Timer (Completed):**
   - Public timer with duration presets (`5`, `10`, `15`, `20`, `30` min) + custom duration (`1–180` min), optional warm-up (`Off`, `5s`, `10s`), timestamp-based drift-free countdown, Screen Wake Lock API, light/dark organic theme, and installable PWA.
2. **V2 — Favorite Guided Tracks + Auth + Neon + Pull-to-Refresh (Completed):**
   - Optional Google OAuth and Neon PostgreSQL via Prisma (`User`, `FavoriteTrack`).
   - Favorite YouTube/SoundCloud tracks (URL auto-detection + oEmbed metadata), full-track focused session player, press-and-hold drag reordering (`/api/tracks/reorder`), and mobile PWA Pull-to-Refresh.
3. **V3 — Meditation History (Completed):**
   - `MeditationSession` Prisma model (`SessionMode`: `TIMER | TRACK`) with automatic logging on completion, early-stop save prompt (`MIN_SAVEABLE_EARLY_STOP_SECONDS = 60`), reflection notes, and History view (total time, daily streak, session count, chronological log).
4. **V4 — Offline PWA / Airplane Mode & Configurable Sounds (Completed):**
   - Zero-dependency Service Worker (`public/sw.js`) with silent updates, offline session queue & local history cache (`src/lib/offline/`), and automatic sync to Neon when back online.
   - Configurable start/interval/end bells, 7 ambient soundscapes with bottom-sheet preview (`src/components/sound-picker-sheet.tsx`), and persisted timer preferences (`src/lib/timer/preferences.ts`).
5. **V5 — Practice Presets & Zen Dim Mode (Completed):**
   - Named Practice Presets (`TimerPreset` Prisma model + `/api/presets`, `/api/presets/[id]`, local fallback via `src/lib/timer/presets.ts`, and compact single-row `src/components/preset-strip.tsx`) capturing full timer settings.
   - OLED-friendly **Zen Dim Mode** during active timer sessions (`Dim screen` pill + tap-anywhere-to-wake overlay).
6. **V6 — Visual History, Manual Logging & Export (Completed):**
   - Minimalist monthly practice calendar/heatmap (`src/components/history-calendar.tsx`, `buildMonthlyCalendar`) with tap-to-filter day inspection.
   - Longest streak display (`Best Xd`), period filters (`7d | 30d | All`), inline manual/offline session logging (`+ Log`), and RFC-4180 CSV / JSON export (`src/lib/history/export.ts` + `export.test.ts`).
7. **V7 — Direct Audio Guided Tracks, Track Organization & Guided Zen Dim (Current):**
   - Direct `.mp3`/`.m4a`/`.ogg`/`.wav`/`.aac`/`.opus` audio URL support (`TrackProvider.DIRECT_AUDIO`) with native HTML5 `<audio>` + **Media Session API** for lock-screen playback and controls.
   - Track tags (`FavoriteTrack.tags`), single-row tag filter bar, inline title & tag editing (`PATCH /api/tracks/[id]`), syncing the configured timer end bell into guided sessions, and **Zen Dim Mode** inside `GuidedSessionPlayer`.

## Directory Structure (V7)

- `public/sw.js` — Offline PWA Service Worker (served with `Cache-Control: no-cache` via `next.config.ts` and excluded from `src/proxy.ts`).
- `prisma/schema.prisma` — `User`, `FavoriteTrack`, `MeditationSession`, and `TimerPreset` models.
- `scripts/vercel-db-sync.mjs` — Automatic Prisma schema sync on Vercel production deploys.
- `src/app/` — App Router layout, global styles, PWA `manifest.ts`, server actions (`actions.ts`), main page, and REST API routes (`/api/auth/[...nextauth]`, `/api/tracks`, `/api/tracks/resolve`, `/api/tracks/reorder`, `/api/tracks/[id]`, `/api/sessions`, `/api/sessions/[id]`, `/api/presets`, `/api/presets/[id]`).
- `src/lib/timer/` — Timestamp-based timer engine (`engine.ts` + `engine.test.ts`), persisted preferences (`preferences.ts` + `preferences.test.ts`), named presets (`presets.ts` + `presets.test.ts`), and types (`types.ts`).
- `src/lib/audio/` — Extensible bell & ambient sound catalog (`sounds.ts`) and Web Audio API synthesis engine (`engine.ts`).
- `src/lib/tracks/` — YouTube/SoundCloud URL parser (`providers.ts` + `providers.test.ts`), oEmbed resolver (`oembed.ts`), drag-reorder helpers (`reorder.ts` + `reorder.test.ts`), and types (`types.ts`).
- `src/lib/history/` — History statistics, period filter & monthly calendar engine (`stats.ts` + `stats.test.ts`), CSV/JSON export (`export.ts` + `export.test.ts`), client helpers with offline fallback (`client.ts`), and types (`types.ts`).
- `src/lib/offline/` — Offline session queue & history cache (`queue.ts` + `queue.test.ts`) and reactive online status hook (`use-network-status.ts`).
- `src/lib/pull-to-refresh.ts` + `pull-to-refresh.test.ts` — Pure rubber-band pull-to-refresh physics and tests.
- `src/lib/wake-lock.ts` — Screen Wake Lock hook.
- `src/components/` — `BodhiShell`, `BodhiLogo`, `ThemeProvider`, `ServiceWorkerRegister`, `PullToRefresh`, `MeditationTimer`, `PresetStrip`, `SoundPickerSheet`, `GuidedTracks`, `GuidedSessionPlayer`, `MeditationHistory`, and `HistoryCalendar`.
- `public/icons/` — Official Bodhi leaf SVG, transparent PNG favicon, and PWA PNG icons.

## Commands & Conventions

- `pnpm test` — Run unit tests (Vitest). Always add or update tests when changing pure domain logic in `src/lib/`.
- `pnpm lint` — Run ESLint checks.
- `pnpm build` — Run `prisma generate && node scripts/vercel-db-sync.mjs && next build` (always validate `pnpm test`, `pnpm lint`, and `pnpm build` before opening a PR).
- **Git Commit Author (required for Vercel Hobby):** Before creating any commit, ensure:
  - `git config user.name "Eryk Humberto Oliveira Alves"`
  - `git config user.email "erykwho@gmail.com"`
- **Pull Request Workflow:** Always work on a dedicated feature branch and open a Pull Request against `master` via `gh pr create` instead of pushing directly to `master`. Before pushing new commits to an existing branch in an ongoing conversation, check the PR state (`gh pr view --json state`); if `CLOSED` or `MERGED`, fetch `origin` and create a new branch from `origin/master`.
- **UI Mobile-First & Vertical Density:** Bodhi is used primarily as a mobile PWA (~360–414px width). Keep controls single-row where possible, avoid wrapped button groups taking excessive vertical space, and ensure the main timer dial and primary action fit comfortably above the fold.
- **Visual Direction:** Serene and organic palette — warm stone/sand light mode, deep warm charcoal dark mode, sage green primary accent, subtle warm amber highlight, with FOUC-free light/dark theme switching.
