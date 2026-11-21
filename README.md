# Bodhi

A serene, mobile-first meditation timer Progressive Web App (PWA) built with Next.js 16, React 19, and Tailwind CSS v4.

## Features (V1)

- **Mindful Timer:** Quick presets (`5`, `10`, `15`, `20`, `30` min) and custom durations (`1–180` min) powered by timestamp-based drift-free timing.
- **Warm-up Countdown:** Optional `5s` or `10s` preparation period before the opening bell.
- **Singing Bowl Bells:** Warm harmonic singing bowl synthesized locally via the Web Audio API at session start and completion.
- **Background Sounds with Preview:** Preview and choose ambient soundscapes (starting with `Silence` and softly filtered `White Noise`) with smooth fade-in/fade-out and volume control.
- **Screen Wake Lock:** Keeps the screen awake during active meditation sessions on supported mobile browsers.
- **Installable PWA & Theme Support:** Serene warm stone light mode and deep charcoal dark mode with automatic system preference detection.

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

## Roadmap

- **V2:** Favorite guided meditation tracks from SoundCloud and YouTube (optional Google OAuth + Neon PostgreSQL sync).
- **V3:** Meditation history tracking, daily streak, total practice time, and optional session notes.