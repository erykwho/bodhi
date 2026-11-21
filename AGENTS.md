# Bodhi — Project Context & Agent Instructions

Mobile-first meditation web application (**PWA**) designed for calm, distraction-free practice.

## Mandatory Language Rule

- **All versioned files MUST be written in English** — including source code, comments, UI copy, `AGENTS.md`, `README.md`, documentation, commit messages, and pull request titles/descriptions — regardless of the language used in the conversation with the user.
- In conversation, reply in the language the user is speaking.

## Stack & Infrastructure

- **Framework:** Next.js 16 (App Router, TypeScript, Turbopack), React 19, Tailwind CSS v4, Lucide icons.
- **Package Manager:** `pnpm` (v12, with `pnpm-workspace.yaml` enabling `allowBuilds` where needed).
- **Audio Engine (V1):** Native Web Audio API synthesis (`src/lib/audio/`) for singing bowl start/end bells and looping ambient background sounds (starting with White Noise), architected to support future static audio files (`.mp3`/`.ogg`) as well as external providers in V2.
- **Testing & Linting:** Vitest (`pnpm test`), ESLint (`pnpm lint`).
- **Hosting:** Vercel (continuous deployment from `master`).
- **Planned Persistence & Auth (V2+):** Neon PostgreSQL + Prisma v6 (with `scripts/vercel-db-sync.mjs` syncing schema on `VERCEL_ENV=production`) and Auth.js v5 (`next-auth@beta`, Google OAuth with optional `ALLOWED_EMAILS`, route handling via `src/proxy.ts`).

## Product Roadmap

1. **V1 — Meditation Timer (Current):**
   - No login and no database/storage (zero required environment variables on Vercel).
   - Duration presets (`5`, `10`, `15`, `20`, `30` min) + custom duration (`1–180` min).
   - Optional warm-up countdown (`Off`, `5s`, `10s`).
   - Singing bowl start & end bells.
   - Selectable and previewable background sounds (initially `Silence` and `White Noise`).
   - Timestamp-based drift-free countdown (`endTime - Date.now()`), Screen Wake Lock API, light/dark organic theme, and installable PWA.
2. **V2 — Favorite Guided Tracks (SoundCloud & YouTube) + Auth + Neon:**
   - Introduces Google OAuth (optional login — the V1 timer stays public) and Neon PostgreSQL via Prisma.
   - Favorite tracks list where users paste a YouTube or SoundCloud URL (auto-detected provider + oEmbed metadata) and start a focused session playing the full track (no countdown timer), with optional ending bell and Wake Lock.
3. **V3 — Meditation History:**
   - Automatic session logging on completion (plus prompt to save early stops with at least 1 minute elapsed) storing date, actual duration, mode (`TIMER` or `TRACK`), and optional note.
   - History view with total time meditated, current daily streak, and chronological session log.

## Directory Structure (V1)

- `src/app/` — App Router layout, global styles, PWA `manifest.ts`, favicon, and main timer page.
- `src/lib/timer/` — Pure timestamp-based timer calculations (`engine.ts`, `types.ts`) and Vitest unit tests (`engine.test.ts`).
- `src/lib/audio/` — Extensible sound catalog (`sounds.ts`) and Web Audio API engine (`engine.ts`).
- `src/lib/wake-lock.ts` — Screen Wake Lock hook.
- `src/components/` — `BodhiLogo`, `ThemeProvider`, and `MeditationTimer` UI components.
- `public/icons/` — Official Bodhi leaf SVG and generated PWA PNG icons.

## Commands & Conventions

- `pnpm test` — Run unit tests (Vitest). Always add or update tests when changing `src/lib/timer/` or other pure domain logic.
- `pnpm lint` — Run ESLint checks.
- `pnpm build` — Run production Next.js build (always validate `pnpm test`, `pnpm lint`, and `pnpm build` before opening a PR).
- **Git Commit Author (required for Vercel Hobby):** Before creating any commit, ensure:
  - `git config user.name "Eryk Humberto Oliveira Alves"`
  - `git config user.email "erykwho@gmail.com"`
- **Pull Request Workflow:** Always work on a dedicated feature branch and open a Pull Request against `master` via `gh pr create` instead of pushing directly to `master`. Before pushing new commits to an existing branch in an ongoing conversation, check the PR state (`gh pr view --json state`); if `CLOSED` or `MERGED`, fetch `origin` and create a new branch from `origin/master`.
- **UI Mobile-First & Vertical Density:** Bodhi is used primarily as a mobile PWA (~360–414px width). Keep controls single-row where possible, avoid wrapped button groups taking excessive vertical space, and ensure the main timer dial and primary action fit comfortably above the fold.
- **Visual Direction:** Serene and organic palette — warm stone/sand light mode, deep warm charcoal dark mode, sage green primary accent, subtle warm amber highlight, with FOUC-free light/dark theme switching.
