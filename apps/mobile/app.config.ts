import type { ConfigContext, ExpoConfig } from "expo/config";

const APP_BUNDLE_ID = "app.bodhi.meditation";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Bodhi",
  slug: "bodhi",
  version: "1.0.0",
  orientation: "portrait",
  scheme: "bodhi",
  userInterfaceStyle: "automatic",
  icon: "./assets/icons/icon-512.png",
  ios: {
    bundleIdentifier: APP_BUNDLE_ID,
    supportsTablet: true,
    usesAppleSignIn: true,
    infoPlist: {
      UIBackgroundModes: ["audio"],
      ITSAppUsesNonExemptEncryption: false,
      NSHealthShareUsageDescription:
        "Bodhi reads Mindful Minutes only if you enable Apple Health sync.",
      NSHealthUpdateUsageDescription:
        "Bodhi saves your completed meditation and breathing sessions as Mindful Minutes in Apple Health.",
    },
  },
  android: {
    package: APP_BUNDLE_ID,
    adaptiveIcon: {
      foregroundImage: "./assets/icons/icon-maskable-512.png",
      backgroundColor: "#f5f2eb",
    },
    permissions: [
      "android.permission.FOREGROUND_SERVICE",
      "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
      "android.permission.WAKE_LOCK",
      "android.permission.VIBRATE",
      "android.permission.POST_NOTIFICATIONS",
    ],
  },
  plugins: [
    ["expo-router", { root: "./src/app" }],
    "expo-secure-store",
    "expo-apple-authentication",
    "expo-sqlite",
    [
      "expo-audio",
      {
        microphonePermission: false,
        enableBackgroundPlayback: true,
      },
    ],
    [
      "expo-notifications",
      {
        color: "#4a6b5d",
      },
    ],
    [
      "expo-splash-screen",
      {
        backgroundColor: "#f5f2eb",
        dark: {
          backgroundColor: "#151917",
        },
        image: "./assets/icons/icon-512.png",
        imageWidth: 140,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    apiBaseUrl:
      process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://bodhi.vercel.app",
    googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "",
    googleIosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? "",
    eas: {
      projectId: process.env.EAS_PROJECT_ID ?? "",
    },
  },
});
