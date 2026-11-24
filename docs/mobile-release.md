# Bodhi Native Mobile App (iOS & Android) — Build & Store Release Guide

This document describes how to run, build, test, and submit `@bodhi/mobile` (Expo CNG / React Native) using EAS Build. You can ship **Android first** without an Apple Developer account and enable iOS later without code changes.

---

## 1. Android-First Quickstart (Recommended Starting Point)

iOS-only UI (such as the Sign in with Apple button in `src/app/settings.tsx`) is already gated behind `Platform.OS === "ios"`, and `expo-apple-authentication` is a safe no-op on Android.

### Step A — Initialize EAS & Configure Mobile Env Vars

```bash
# From repository root
pnpm install
npm install -g eas-cli
eas login

cd apps/mobile
eas init
```

Create `apps/mobile/.env` (or configure the same variables in EAS Project Environment Variables):

```env
EXPO_PUBLIC_API_BASE_URL="https://<your-bodhi-domain>.vercel.app"
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID="<your-AUTH_GOOGLE_ID-from-vercel>.apps.googleusercontent.com"
```

> **Note:** On Android, `@react-native-google-signin/google-signin` uses your **Web OAuth 2.0 Client ID** (the same `AUTH_GOOGLE_ID` already configured in Vercel) to return a verifiable `idToken`. Because `src/lib/mobile-auth.ts` already accepts `AUTH_GOOGLE_ID`, **no additional backend environment variables are required on Vercel** for Android Google Sign-In.

### Step B — Build & Install a Direct Preview `.apk` on Your Phone

```bash
cd apps/mobile
eas build --platform android --profile preview
```

The `preview` profile builds a directly installable `.apk` (`"buildType": "apk"`) with a QR code — no Google Play Console account is needed to test Timer, Open-Ended, Breathing, Retention, all 14 bundled CC0 audio files, Zen Dim, offline downloads, and reminders on your phone.

### Step C — Enable Google Sign-In on Android (SHA-1)

1. Inspect the EAS-managed Android keystore fingerprint:
   ```bash
   cd apps/mobile
   eas credentials -p android
   ```
   Select `preview` → Keystore and copy the **SHA-1 fingerprint**.
2. In **Google Cloud Console** (same project as your Web OAuth client) → **APIs & Services → Credentials → Create Credentials → OAuth client ID → Android**:
   - **Package name:** `app.bodhi.meditation`
   - **SHA-1 certificate fingerprint:** paste the EAS SHA-1 fingerprint.
3. No rebuild is required; Google Sign-In starts working within a few minutes.

### Step D — Publish to Google Play Store (`.aab`)

1. Build the production Android App Bundle:
   ```bash
   cd apps/mobile
   eas build --platform android --profile production
   ```
2. Create the app in **Google Play Console** (US$ 25 one-time fee):
   - Privacy Policy URL: `https://<your-bodhi-domain>.vercel.app/privacy`
   - Support / Account Deletion URL: `https://<your-bodhi-domain>.vercel.app/support`
   - In-app deletion path: **Settings → Delete Account** (`DELETE /api/account`)
3. **Important (Play App Signing SHA-1):** After uploading your first `.aab`, open **Setup → App integrity → App signing** in Google Play Console, copy the **App signing key SHA-1**, and register a **second Android OAuth 2.0 Client ID** in Google Cloud Console for `app.bodhi.meditation` so Google Sign-In works in Play Store installs as well as preview APKs.
4. Submit updates via:
   ```bash
   cd apps/mobile
   eas submit --platform android --latest
   ```

---

## 2. Adding iOS Later (Apple App Store & TestFlight)

When ready to launch on iOS:

1. Enroll in the **Apple Developer Program** (US$ 99/year) and enable the **Sign in with Apple** capability for bundle ID `app.bodhi.meditation`.
2. Add iOS environment variables:
   - In EAS / `apps/mobile/.env`: `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`
   - In Vercel: `MOBILE_GOOGLE_IOS_CLIENT_ID` and `AUTH_APPLE_BUNDLE_ID=app.bodhi.meditation`
3. Build & test on TestFlight (cloud EAS or free local macOS build):
   ```bash
   cd apps/mobile
   eas build --platform ios --profile preview
   # or free local build on macOS:
   eas build --platform ios --profile preview --local
   ```
4. Submit to the App Store:
   ```bash
   cd apps/mobile
   eas build --platform ios --profile production
   eas submit --platform ios --latest
   ```

---

## 3. Local Development & Verification

```bash
# From repository root
pnpm --filter @bodhi/mobile sync:assets
pnpm typecheck:core
pnpm typecheck:mobile

# Start native dev client (requires prebuild/dev build for native audio & Google Sign-In)
pnpm --filter @bodhi/mobile android
pnpm --filter @bodhi/mobile ios

# Native E2E smoke test
maestro test apps/mobile/maestro/smoke.yaml
```
