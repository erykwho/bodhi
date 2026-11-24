# Bodhi Native Mobile App (iOS & Android) — Build & Store Release Guide

This document describes how to run, build, test, and submit `@bodhi/mobile` (Expo CNG / React Native) to the Apple App Store and Google Play Store using EAS Build.

## 1. Local Development (Mac + iOS Simulator / Android Emulator)

```bash
# From repository root
pnpm install
pnpm --filter @bodhi/mobile sync:assets
pnpm --filter @bodhi/mobile typecheck

# Copy environment template and point to your Vercel backend URL
cp apps/mobile/.env.example apps/mobile/.env

# Start Expo dev server (requires EAS development build or native prebuild for audio/apple-auth)
pnpm --filter @bodhi/mobile ios
# or
pnpm --filter @bodhi/mobile android
```

## 2. EAS Build Setup (Cloud iOS & Android Builds)

```bash
npm install -g eas-cli
eas login

cd apps/mobile
eas init
```

Configure environment secrets on EAS (`eas env:create`) or `.env`:
- `EXPO_PUBLIC_API_BASE_URL` — Production Vercel URL (e.g. `https://bodhi.vercel.app`)
- `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` — Web OAuth 2.0 Client ID from Google Cloud Console
- `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` — iOS OAuth 2.0 Client ID from Google Cloud Console

And configure matching backend variables on Vercel:
- `MOBILE_GOOGLE_IOS_CLIENT_ID`
- `MOBILE_GOOGLE_ANDROID_CLIENT_ID`
- `AUTH_APPLE_BUNDLE_ID=app.bodhi.meditation`
- `AUTH_APPLE_SERVICE_ID` (if also using Apple OAuth on Web)

## 3. Building & Testing on Physical Devices

```bash
cd apps/mobile

# Development client with native audio & Apple/Google sign-in
eas build --profile development-device --platform ios
eas build --profile development-device --platform android

# Internal Preview (TestFlight & Google Play Internal Testing)
eas build --profile preview --platform all

# Optional free local build on macOS using identical eas.json settings
eas build --profile preview --platform ios --local
```

## 4. App Store & Google Play Store Submission Checklist

1. **Accounts & Signing**
   - Apple Developer Program (US$ 99/year): enable **Sign in with Apple** capability for `app.bodhi.meditation`.
   - Google Play Console (US$ 25 one-time): register Play App Signing SHA-1/SHA-256 fingerprints in Google Cloud Console.
2. **Mandatory Compliance Verified**
   - Public Privacy Policy URL: `<PROD_URL>/privacy`
   - Public Support URL: `<PROD_URL>/support`
   - In-app account deletion: Settings → Delete Account (`DELETE /api/account`)
   - Sign in with Apple offered alongside Google Sign-In on iOS (Guideline 4.8)
   - Timer & Guided Breathing work 100% without signing in and in Airplane Mode
   - YouTube embeds never play audio in background (foreground or External Companion only)
3. **Production Build & Submit**
   ```bash
   cd apps/mobile
   eas build --profile production --platform all
   eas submit --platform ios --latest
   eas submit --platform android --latest
   ```
4. **Native E2E Verification**
   ```bash
   maestro test apps/mobile/maestro/smoke.yaml
   ```
