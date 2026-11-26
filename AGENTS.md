# Bodhi — Project Context, Invariants & Agent Instructions

Mobile-first meditation web application (**PWA**) designed for calm, distraction-free practice — serving real users in production.

## Mandatory Language Rule

- **All versioned files MUST be written in English** — including source code, comments, default UI copy, `AGENTS.md`, `README.md`, documentation, commit messages, and pull request titles/descriptions — regardless of the language used in the conversation with the user.
- **Localized UI message catalogs** are the sole exception and live strictly under `src/lib/i18n/messages/` (e.g., `pt-br.ts`), always keeping 100% key parity with `en.ts`.
- In conversation, reply in the language the user is speaking.

## Living Documentation Rule (Mandatory)

`AGENTS.md` is a **living specification** of Bodhi's production invariants and business rules.
- Whenever a change introduces or modifies a **business rule**, **production invariant**, **Prisma schema model/migration rule**, **`localStorage` key/format**, **Service Worker caching rule**, or **API contract**, the agent MUST update the relevant section of `AGENTS.md` in the **same Pull Request**.
- Keep this file concise, declarative, and focused on current truth (not a verbose changelog). If it grows beyond ~250 lines, extract detailed domain specs into `docs/invariants.md` and link them here.
- Every critical invariant documented here should also be backed by an automated check (Vitest unit test, Prisma validation, ESLint, or GitHub Actions CI) whenever feasible.

## Production Invariants (Never Break)

1. **Public & Offline-First Timer:** The Meditation Timer, Web Audio bells, and ambient soundscapes MUST remain 100% usable without signing in and without an internet connection (Airplane Mode).
2. **Strict Multi-Tenant Data Isolation:** Every authenticated API route (`/api/tracks/**`, `/api/sessions/**`, `/api/presets/**`, `/api/account`, `/api/mobile/bootstrap`) MUST verify the user session (Web Auth.js cookie OR Mobile Bearer HS256 JWT; return `401` when unauthenticated), validate inputs with Zod (return `400` on invalid payloads), and scope every read, update, and delete query by `userId` (zero IDOR).
3. **Zero-Downtime Database Migrations (Expand-and-Contract):**
   - Production database updates run exclusively via **Prisma Migrations** (`prisma migrate deploy` in `scripts/vercel-db-sync.mjs`). Never re-enable `prisma db push` in production.
   - Never drop or rename an existing column, table, or enum value in a single deploy. Always use *expand-and-contract* (add nullable/default column first → deploy compatible app code → backfill/migrate → remove legacy column in a subsequent release) so 1-click Vercel rollbacks remain safe.
4. **Service Worker & Cache Safety (`public/sw.js`):** Never cache `/api/*` or `/api/auth/*` requests. Keep `Cache-Control: no-cache` on `public/sw.js` (`next.config.ts`) and keep it excluded from `src/proxy.ts` so silent PWA updates always propagate. Precaches all 14 `/audio/` acoustic assets (6 multi-sample nasal breath files, 6 loudness-matched bells, and 2 seamless nature loops in `bodhi-offline-v8`) and serves them Cache-First with HTTP `206 Partial Content` Range support. `activate` cache cleanup MUST preserve `bodhi-user-audio-v1` so PWA updates never wipe user-downloaded offline guided tracks.
5. **Backward-Compatible Client Storage:** All `localStorage` readers (`bodhi.timer.preferences.v1`, `bodhi.breathing.preferences.v1`, `bodhi-locale`, local presets, offline session queue, history cache, and `bodhi.offline.guided-tracks.v1`) MUST gracefully handle missing, partial, or older JSON shapes with safe defaults — never throw on parse.
6. **100% i18n Key Parity:** Every locale catalog under `src/lib/i18n/messages/` MUST satisfy the `Messages` type from `en.ts` and pass `src/lib/i18n/locale.test.ts`.
7. **React 19 & Next.js 16 Guardrails:**
   - Do not call `setState` synchronously inside a `useEffect` body (`react-hooks/set-state-in-effect`); use `useSyncExternalStore`, `queueMicrotask`, or async callbacks.
   - Extract optional-chained values (e.g., `const userId = user?.id ?? null`) before passing them into `useCallback`/`useMemo` dependency arrays (`react-hooks/preserve-manual-memoization`).
   - Use `src/proxy.ts` (Next.js 16 convention) instead of `middleware.ts`.
   - Mount third-party DOM-replacing embeds (e.g., YouTube `YT.Player`) into an unmanaged child DOM node so React unmount reconciliation never crashes.

## Domain Business Rules

- **Meditation Timer, Open-Ended Mode & Audio (`src/lib/timer/`, `src/lib/audio/`):**
  - Subtle sub-mode selector (`Timer · Open · Breathe`) lives inside the Timer tab, keeping top-level navigation strictly 3 tabs (`Timer | Guided | History`).
  - Duration presets: `5`, `10`, `15`, `20`, `30` min; custom duration clamped to `1–180` min (`MIN_DURATION_MINUTES` / `MAX_DURATION_MINUTES`); plus **Open-Ended (`Open`)** count-up mode with no fixed time limit (`plannedDurationSec: null`, plays closing bell when finished manually).
  - Optional warm-up: `Off (0s)`, `5s`, `10s` before the opening bell.
  - Countdown and count-up timing are timestamp-based and drift-free; Screen Wake Lock is held during active sessions.
  - 7 bells (`None` + 6 loudness-matched acoustic recordings decoded into in-RAM Web Audio `AudioBuffer`s: `Singing Bowl`, `Tibetan Healing Bowl`, `Deep Gong`, `Soft Chime`, `Crystal Bowl`, `Wood Block`) with independent **bell volume** (`bellVolume`, default `0.85`, `volume^0.85` curve) and configurable closing bell strikes (`1×` or `3×`, `endBellStrikes`), plus interval chimes (`1–60` min, pause with timer) and 7 offline ambient soundscapes (`Silence`, mathematically synthesized `White Noise`, `Pink Noise`, `Brown Noise`, `Warm Drone`, plus 2 seamless equal-power crossfaded CC0 stereo nature loops: `Gentle Rain` and `Ocean Waves`). **Fallback policy:** on Web, synthesized fallback is restricted strictly to offline asset-load failures (`navigator.onLine === false` when the file cannot be loaded); on Native Mobile (`apps/mobile`), all audio assets are bundled directly inside the app with zero synthesized bell fallback.
  - **iOS Silent Mode Bypass & Context Resilience:** `MeditationAudioEngine.unlock()` sets `navigator.audioSession.type = "playback"` (iOS Safari 16.4+), plays a 50ms silent `<audio>` WAV once on user gesture (pre-16.4 / standalone PWA fallback), resumes `AudioContext` on any non-`"running"` state (including iOS Safari's `"interrupted"` state), and preloads configured bell, ambient, and breath `AudioBuffer`s so all practice audio remains audible even when the hardware Silent switch is enabled.
  - **Unified Media Session API (`src/lib/media-session.ts`):** Lock-screen / control-center metadata, playbackState, positionState, and play/pause/stop (plus seek for `DIRECT_AUDIO`) handlers are wired consistently across Timer, Open-Ended, Guided Breathing, and Guided Tracks.
  - OLED-friendly **Zen Dim Mode** (`ZenDimOverlay` — `Dim screen` pill + tap-anywhere-to-wake overlay) keeps Wake Lock active during Timer, Breathing, and Guided sessions.
- **Guided Breathing (`src/lib/breathing/`, `BreathingPractice`, `RetentionBreathing`, `BreathingSheet`):**
  - 100% public & offline-first with a subtle `Rhythmic | Retention` mode toggle anchored below the circular dial (preserving `<= 2px` dial vertical alignment across `Timer`, `Open`, `Rhythmic`, and `Retention`).
  - **Rhythmic mode:** 4 rhythms: `Box` (`4-4-4-4`), `4-7-8` (`4-7-8`), `Coherent` (`5.5-5.5`), and `Custom` (`inhale 1–8s`, `holdIn 0–8s`, `exhale 1–8s`, `holdOut 0–8s`), duration `1–30` min (default `3` min).
  - **Retention mode (Wim Hof-style cyclic breathing):** Round-based drift-free state machine (`1–5` rounds, default `3`; `20 | 30 | 40` power breaths per round at `Slow` `1.8s/1.4s`, `Standard` `1.4s/1.1s`, or `Fast` `1.1s/0.85s` pace; open-ended empty-lung retention count-up with optional minute chime and tap-to-inhale transition; guided `2.0s` deep recovery inhale → `10–20s` full hold, default `15s` → `2.2s` release exhale), safety guidance, and per-round retention summary (`Best` / `Avg`).
  - Eyes-closed guidance via phase cues (`tone` = 3-tier duration-matched CC0 human nasal breath samples from `thomasXkiteXforXlife` & `giddster`, pre-centered offline with formant-preserving `librubberband` and acoustically distinct inhale crescendo/airy vs exhale warm/soothing release profiles, fetched and decoded into in-memory Web Audio API `AudioBufferSourceNode` + `GainNode` buffers | `chime` | `silent`; hold phases stay silent except optional 60s retention chime) + optional haptic vibration (`navigator.vibrate`, enabled by default on supported mobile devices) + optional ambient soundscape.
  - Completion view saves automatically for signed-in users (`SessionMode.BREATHING` + canonical `breathingPattern` `<= 80` chars, `plannedDurationSec: null` for Retention, offline-queued when offline) and provides a one-tap **"Continue to Meditation"** bridge directly into the Timer.
- **Practice Presets (`TimerPreset`, `src/lib/timer/presets.ts`, `PresetStrip`):**
  - Presets capture full timer configuration (duration, open-ended mode, warm-up, bells, closing strikes, bell volume, interval, ambient sound & volume).
  - Synced to Neon PostgreSQL when signed in and online; automatically falls back to `localStorage` when signed out or offline.
- **Guided Tracks & Player (`FavoriteTrack`, `src/lib/tracks/`, `src/lib/offline/audio-cache.ts`, `GuidedTracks`, `GuidedSessionPlayer`):**
  - Supports `YOUTUBE`, `SOUNDCLOUD` (including private tracks with `s-...` secret tokens), `GOOGLE_DRIVE` (publicly shared "Anyone with the link" audio files), and `DIRECT_AUDIO` (`.mp3`/`.m4a`/`.ogg`/`.wav`/`.aac`/`.opus`) URLs with auto-detection and oEmbed / `Content-Disposition` metadata resolution.
  - **Starred Favorites (`isFavorite`):** Individual guided tracks can be starred/unstarred with 1 tap from the track card or the `GuidedSessionPlayer` header (`PATCH /api/tracks/[id]`). Favorited tracks stay pinned at the top with a subtle warm-amber highlight, filled amber `Star` icon, optional subtle section divider when both groups are present, and a `Favorites` filter chip alongside tags; toggling places the track at the top of its destination group. Offline mode preserves `isFavorite` ordering and read-only markers from `bodhi.offline.guided-tracks.v1`.
  - **Offline Guided Audio (`DIRECT_AUDIO` & `GOOGLE_DRIVE`):** Users can save `DIRECT_AUDIO` and `GOOGLE_DRIVE` tracks locally into the dedicated `bodhi-user-audio-v1` Cache Storage bucket (with `bodhi.offline.guided-tracks.v1` index) for Airplane Mode browsing and playback. `DIRECT_AUDIO` downloads try direct CORS fetch first before falling back to the authenticated, `userId`-scoped, SSRF-hardened, 50 MB-capped streaming `/api/tracks/[id]/audio` proxy (supporting HTTP `206 Partial Content` `Range` forwarding); `GOOGLE_DRIVE` tracks both stream online and download offline through `/api/tracks/[id]/audio`.
  - Press-and-hold drag reordering (`/api/tracks/reorder`) is strictly constrained within each group (favorites among favorites; non-favorites among non-favorites), MUST keep `data-no-drag="true"` on interactive card controls/editors (including favorite star and offline download buttons), and MUST disable `PullToRefresh` while dragging.
  - **Embed Resilience & External Companion Mode (YouTube & SoundCloud, `src/lib/tracks/youtube-player.ts`):** `YT.Player` passes validated `origin` + `enablejsapi: 1` in `playerVars`, applies `referrerpolicy="strict-origin-when-cross-origin"` to the iframe to avoid false-positive Error `153` blocks, and handles `onError` (`101`/`150` embed disabled, `100` unavailable, `153` config error, playback/script load errors); SoundCloud Widget binds `Events.ERROR` alongside script-load error handling. When embedding is blocked or fails on YouTube or SoundCloud, offers a 1-tap **Open on YouTube/SoundCloud & Track** External Companion fallback (plus retry for recoverable errors) with a drift-free count-up timer (syncing on `visibilitychange`), pause/resume, 1-tap discard without saving, Zen Dim display, closing bell, and standard `TRACK` history logging, while clearing Bodhi's Media Session so it never competes with the external app.
  - Supports custom and suggested tags, single-row filter bar (`All`, `Favorites`, tags), inline title/tag editing (`PATCH /api/tracks/[id]`), closing bell synced with the user's configured Timer end bell (including `1×`/`3×` strikes and `bellVolume`), **Zen Dim Mode**, and unified **Media Session API** lock-screen controls (with seek support for `DIRECT_AUDIO` and `GOOGLE_DRIVE`).
- **Meditation History & Offline Sync (`MeditationSession`, `src/lib/history/`, `src/lib/offline/`):**
  - `SessionMode` is `TIMER | TRACK | BREATHING` (with nullable `breathingPattern` for breathing sessions and `plannedDurationSec: null` for open-ended timer sessions). Completed sessions are logged automatically for signed-in users and all modes count toward totals and daily streaks.
  - Active sessions across all modes provide a `Finish` button; the early-finish save prompt (`EarlyFinishCard`, with Save to History, Discard, and Keep going) triggers when active practice duration is `>= MIN_SAVEABLE_EARLY_STOP_SECONDS` (`10` seconds).
  - Signed-in Timer, Breathing, and offline-saved Guided Track sessions completed offline are queued locally (`Pending sync`), merged into the History view, and flushed automatically to `/api/sessions` upon reconnect.
  - History provides period filters (`7d | 30d | All`), total time, current and all-time longest streak (`Best Xd`), session count, monthly practice calendar/heatmap with tap-to-filter, inline manual logging (`+ Log`), reflection notes, and RFC-4180 CSV / JSON export.
- **Authentication (`src/lib/auth.ts`, `src/lib/mobile-token.ts`, `src/lib/mobile-auth.ts`, `src/proxy.ts`):**
  - Dual-mode authentication: Auth.js v5 (`next-auth@beta`, JWT cookie session) with Google OAuth 2.0 on Web, plus HS256 Bearer Access JWTs (`15m`) and SHA-256 hashed rotating `MobileRefreshToken`s (`30d`, with reuse-attack session revocation) on native iOS/Android via `/api/mobile/auth/{google,apple,refresh,logout}` verifying Google/Apple ID tokens against official JWKS.
  - `User` stores nullable unique `appleSub` and `googleSub` so Sign in with Apple works reliably across subsequent logins where Apple omits email/name.
  - `ALLOWED_EMAILS` is optional: if unset or empty, any Google/Apple account is allowed; if populated, only listed emails may sign in.
  - **Store Compliance:** `DELETE /api/account` permanently deletes the authenticated user and cascades all user data; `/privacy` and `/support` are public static pages.
- **Internationalization (`src/lib/i18n/`, `I18nProvider`, `LanguageSwitcher`, `LocaleFlag`):**
  - Supports Brazilian Portuguese (`pt-BR`, default), English (`en`), and Spanish (`es`), persisted in `localStorage` (`bodhi-locale`) with cross-tab sync, `<html lang>` updates, inline circular SVG flags (Brazil, United States, Spain) in a compact popover menu, and `Intl.DateTimeFormat` locale-aware dates/calendars.

## Stack & Infrastructure

- **Framework:** Next.js 16 (App Router, TypeScript, Turbopack), React 19, Tailwind CSS v4, Lucide icons, Zod, `jose`.
- **Package Manager:** `pnpm` (v12 workspace with `packages/*` and `apps/*`, enabling `allowBuilds` for Prisma and esbuild in `pnpm-workspace.yaml`).
- **Database:** Neon PostgreSQL + Prisma v6 (`prisma/schema.prisma`, versioned `prisma/migrations/`, synced automatically via `prisma migrate deploy` in `scripts/vercel-db-sync.mjs` on `VERCEL_ENV=production`).
- **Observability:** Sentry (`@sentry/nextjs`, org `bodhi-09`, project `bodhi`), enabled automatically when `NEXT_PUBLIC_SENTRY_DSN` is set (no-op in dev/CI without DSN; PII off by default in SDK v11; source maps uploaded on build when `SENTRY_AUTH_TOKEN` is configured).
- **CI/CD & Hosting:** GitHub Actions (`.github/workflows/ci.yml` running `prisma validate`, `pnpm typecheck:core`, `pnpm typecheck:mobile`, `pnpm test`, `pnpm lint`, `pnpm build`, and `pnpm test:e2e`) + Vercel (continuous deployment from `master`, protected branch requiring PR + passing checks) + EAS Build (`apps/mobile/eas.json`).

## Directory Structure (V10)

- `.github/workflows/ci.yml` — GitHub Actions CI (`CI` job: Prisma validate, `@bodhi/core` & `@bodhi/mobile` typecheck, Vitest, ESLint, Next.js build, Playwright E2E smoke tests).
- `.github/dependabot.yml` — Grouped weekly Dependabot updates for `npm`/`pnpm` dependencies and GitHub Actions.
- `packages/core/` (`@bodhi/core`) — Platform-agnostic, DOM-free shared TypeScript domain package (enforced by `packages/core/src/dom-free.test.ts`) reused by Web (`src/lib/*`) and React Native (`apps/mobile/`): timer/breathing/retention engines, sound & breath catalogs + `MeditationAudioPort`, history stats & CSV/JSON serializers, track URL parsers/reordering/YouTube error classifier, `KeyValueStorage` + offline session queue, i18n types/messages (`en`, `pt-BR`, `es`), design tokens (`theme/tokens.ts`), and typed platform-agnostic REST API client (`api/client.ts`).
- `apps/mobile/` (`@bodhi/mobile`) — Native iOS & Android React Native + Expo SDK 58 (CNG / EAS Build) application sharing `@bodhi/core` and the Vercel backend API: `NativeMeditationAudioEngine` (`react-native-audio-api` C++ DSP + iOS `AVAudioSession` Silent Mode bypass + `allowHaptics: true` + silent background keep-alive + Lock Screen controls + all 14 bundled CC0 audio assets), `expo-sqlite/kv-store`, `expo-secure-store`, `expo-file-system` permanent offline guided audio downloads, `expo-brightness` OLED Zen Dim, Taptic Engine breathing haptics, `expo-notifications` offline daily practice reminders, Mindful Minutes health hook, Sign in with Apple + Google Sign-In + account deletion, full Timer/Open/Breathing/Retention/Guided/History/Settings screens, and Maestro E2E smoke flow (`maestro/smoke.yaml`). See `docs/mobile-release.md`.
- `e2e/smoke.spec.ts` & `playwright.config.ts` — Mobile PWA Playwright E2E smoke tests (Timer, Open-Ended, Guided Breathing, 3× bell, Zen Dim, Sound Picker, local Presets, i18n, theme persistence, navigation, `/api/health`, 14 cached `/audio/` assets, offline mode).
- `sentry.server.config.ts`, `sentry.edge.config.ts`, `src/instrumentation.ts`, `src/instrumentation-client.ts` — Conditional Sentry SDK initialization and `onRequestError` / router transition hooks.
- `public/sw.js` — Offline PWA Service Worker (`bodhi-offline-v8`, preserving `bodhi-user-audio-v1`).
- `prisma/schema.prisma` & `prisma/migrations/` — `User` (with nullable `appleSub`, `googleSub`), `MobileRefreshToken`, `FavoriteTrack`, `MeditationSession` (`TIMER | TRACK | BREATHING`), and `TimerPreset` models and versioned SQL migrations.
- `scripts/vercel-db-sync.mjs` — Production-only `prisma migrate deploy` runner (with one-time `P3005` baseline transition and no `db push` fallback).
- `src/app/` — App Router layout, global styles, Error Boundaries (`error.tsx`, `global-error.tsx`), PWA `manifest.ts`, server actions (`actions.ts`), main page, public `/privacy` & `/support` pages, and REST API routes (`/api/health` with optional `?db=1` Neon check, `/api/auth/[...nextauth]`, `/api/mobile/auth/{google,apple,refresh,logout}`, `/api/mobile/bootstrap`, `/api/account`, `/api/tracks/**`, `/api/sessions/**`, `/api/presets/**`, plus Vitest security & contract tests).
- `src/lib/` — Web platform adapters (`localStorage`, Web Audio API `MeditationAudioEngine`, browser file download, `MediaSession`, Screen Wake Lock, Cache Storage offline audio manager) and thin re-exports from `@bodhi/core/*` plus Vitest unit tests.
- `src/components/` — `BodhiShell`, `BodhiLogo`, `ThemeProvider`, `I18nProvider`, `LanguageSwitcher`, `LocaleFlag`, `ServiceWorkerRegister`, `PullToRefresh`, `MeditationTimer`, `BreathingPractice`, `RetentionBreathing`, `BreathingSheet`, `ZenDimOverlay`, `EarlyFinishCard`, `PresetStrip`, `SoundPickerSheet`, `GuidedTracks`, `GuidedSessionPlayer`, `MeditationHistory`, and `HistoryCalendar`.
- `public/audio/` — 14 precached acoustic assets: 6 multi-sample nasal breath cues (`breath-{inhale,exhale}-{short,medium,long}.mp3`, CC0, `giddster` & `thomasXkiteXforXlife`), 6 loudness-matched bells (`singing-bowl.mp3` CC0 by `ryancacophony`, `tibetan-healing-bowl.mp3` CC0 by `BuddhasSoundOfSilence`, `deep-gong.mp3` CC-BY 3.0 "Keisu temple bell" by `milivolt`, `soft-chime.mp3` CC0 by `loganzsound`, `wood-block.mp3` CC0 by `calaudio`, `crystal-bowl.mp3` CC0), and 2 seamless stereo nature loops (`ambient/{gentle-rain,ocean-waves}.mp3`, CC0, `shelbyshark` & `SamsterBirdies`).
- `public/icons/` — Official Bodhi leaf SVG, transparent PNG favicon, and PWA PNG icons.

## Commands & Conventions

- `pnpm typecheck:core` — Typecheck `@bodhi/core` without DOM runtime coupling.
- `pnpm typecheck:mobile` — Typecheck `@bodhi/mobile` (React Native / Expo SDK 58).
- `pnpm test` — Run unit tests (Vitest) across `src/` and `packages/core/`. Always add or update tests when changing pure domain logic in `packages/core/` or `src/lib/`.
- `pnpm test:e2e` — Run Playwright mobile PWA E2E smoke tests (`e2e/smoke.spec.ts`) against the production Next.js server (`pnpm build` first).
- `pnpm lint` — Run ESLint checks.
- `pnpm build` — Run `prisma generate && node scripts/vercel-db-sync.mjs && next build`.
- `pnpm db:migrate` — Create and apply a new Prisma migration locally (`prisma migrate dev`). Always commit generated files in `prisma/migrations/`.
- `pnpm db:migrate:deploy` — Apply pending migrations in production/staging environments.
- **Pre-PR Verification:** Always validate `prisma validate`, `pnpm typecheck:core`, `pnpm typecheck:mobile`, `pnpm test`, `pnpm lint`, `pnpm build`, and `pnpm test:e2e` before opening a PR.
- **Git Commit Author (required for Vercel Hobby):** Before creating any commit, ensure:
  - `git config user.name "Eryk Humberto Oliveira Alves"`
  - `git config user.email "erykwho@gmail.com"`
- **Pull Request Workflow:** Always work on a dedicated feature branch and open a Pull Request against `master` via `gh pr create` instead of pushing directly to `master` (`master` is protected). Before pushing new commits to an existing branch in an ongoing conversation, check the PR state (`gh pr view --json state`); if `CLOSED` or `MERGED`, fetch `origin` and create a new branch from `origin/master`.
- **UI Mobile-First & Vertical Density:** Bodhi is used primarily as a mobile PWA (~360–414px width). Keep controls single-row where possible, avoid wrapped button groups taking excessive vertical space, and ensure the main timer dial and primary action fit comfortably above the fold.
- **Visual Direction:** Serene and organic palette — warm stone/sand light mode, deep warm charcoal dark mode, sage green primary accent, subtle warm amber highlight, with FOUC-free light/dark theme switching.
