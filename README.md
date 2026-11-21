# Bodhi

A serene, mobile-first meditation Progressive Web App (PWA) built with Next.js 16, React 19, Tailwind CSS v4, Prisma, and Neon PostgreSQL.

## Features

### V1 — Meditation Timer
- **Mindful Timer:** Quick presets (`5`, `10`, `15`, `20`, `30` min) and custom durations (`1–180` min) powered by timestamp-based drift-free timing.
- **Warm-up Countdown:** Optional `5s` or `10s` preparation period before the opening bell.
- **Opening, Closing & Interval Bells:** Synthesized locally via the Web Audio API (`None`, `Singing Bowl`, `Deep Gong`, `Soft Chime`, `Crystal Bowl`, and `Wood Block`), plus an optional repeating interval bell (disabled by default, configurable from `1–60` min) that pauses with the timer.
- **Background Soundscapes with Preview:** Preview and choose from synthesized ambient soundscapes (`Silence`, `White Noise`, `Pink Noise`, `Brown Noise`, `Gentle Rain`, `Ocean Waves`, and `Warm Drone`) with smooth fade-in/fade-out, volume control, and automatic local preference persistence.
- **Screen Wake Lock:** Keeps the screen awake during active meditation sessions on supported mobile browsers.

### V2 — Favorite Guided Tracks & Mobile Pull-to-Refresh
- **YouTube & SoundCloud Favorites:** Paste a YouTube video or SoundCloud track URL to auto-detect the provider, fetch metadata via oEmbed, and save to your cloud-synced favorites list.
- **Full-Track Guided Sessions:** Listen to the complete track via the official YouTube IFrame Player API or SoundCloud Widget API with Screen Wake Lock and an optional closing singing bowl bell.
- **Optional Google Sign-In:** The timer stays 100% public; signing in with Google (Auth.js v5 + Neon PostgreSQL) syncs your favorite tracks and history across devices.
- **Mobile Pull-to-Refresh:** Smooth rubber-band pull-to-refresh gesture for standalone PWA usage (automatically disabled during active sessions).

### V3 — Meditation History
- **Automatic Session Logging:** Completed Timer and Guided Track sessions are automatically logged to Neon PostgreSQL for signed-in users.
- **Partial Session Prompt:** Stopping a session early after at least 1 minute prompts you to save or discard the partial practice.
- **Streaks, Totals & Notes:** View total practice time, current daily streak, total sessions, and a chronological session log with optional reflection notes.

### V4 — Offline PWA (Airplane Mode)
- **Full Offline Timer:** Service Worker (`public/sw.js`) caches the app shell, assets, and icons so the Timer, singing bowl bells, and ambient sounds work 100% offline.
- **Offline Queue & Auto-Sync:** Signed-in Timer sessions completed offline are saved locally with a subtle `Pending sync` badge and automatically synced to Neon PostgreSQL once reconnected.
- **Offline History Access:** Cached meditation history remains viewable offline, while the Guided tab shows a calm offline notice with a one-tap shortcut back to the Timer.

## Environment Variables (V2+)

Copy `.env.example` to `.env.local` for local development with Favorite Guided Tracks and Meditation History:

- `DATABASE_URL` — Neon PostgreSQL connection string
- `AUTH_SECRET` — Random 32-byte secret (`openssl rand -base64 32`)
- `AUTH_GOOGLE_ID` — Google OAuth 2.0 Client ID
- `AUTH_GOOGLE_SECRET` — Google OAuth 2.0 Client Secret
- `ALLOWED_EMAILS` — Optional comma-separated allowlist of Google emails (leave empty to allow any Google account)

## Development

```bash
pnpm install
pnpm dev
```

### Verification

```bash
pnpm test
pnpm lint
pnpm build
```