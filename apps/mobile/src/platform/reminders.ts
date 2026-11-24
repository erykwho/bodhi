import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import type { Locale } from "@bodhi/core/i18n/types";
import {
  type ReminderPreferences,
  writeReminderPreferences,
} from "./storage";

const REMINDER_CHANNEL_ID = "bodhi-practice-reminders";

const REMINDER_COPY: Record<Locale, { title: string; body: string }> = {
  "pt-BR": {
    title: "Hora da sua prática",
    body: "Reserve alguns minutos de silêncio e respiração consciente no Bodhi.",
  },
  en: {
    title: "Time for your practice",
    body: "Take a few quiet minutes to breathe and settle in with Bodhi.",
  },
  es: {
    title: "Hora de tu práctica",
    body: "Tómate unos minutos de calma y respiración consciente en Bodhi.",
  },
};

export async function ensureNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
      name: "Practice Reminders",
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 150],
      lightColor: "#4a6b5d",
    });
  }

  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;

  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

/**
 * Cancels all scheduled Bodhi practice reminders and persists the updated state.
 */
export async function cancelPracticeReminders(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

/**
 * Schedules offline-first weekly recurring local practice reminders.
 */
export async function syncPracticeReminders(
  prefs: ReminderPreferences,
  locale: Locale
): Promise<{ ok: boolean; permissionDenied?: boolean }> {
  await Notifications.cancelAllScheduledNotificationsAsync();

  if (!prefs.enabled) {
    writeReminderPreferences(prefs);
    return { ok: true };
  }

  const granted = await ensureNotificationPermissions();
  if (!granted) {
    writeReminderPreferences({ ...prefs, enabled: false });
    return { ok: false, permissionDenied: true };
  }

  const copy = REMINDER_COPY[locale] ?? REMINDER_COPY.en;

  for (const weekday of prefs.weekdays) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: copy.title,
        body: copy.body,
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
        weekday,
        hour: prefs.hour,
        minute: prefs.minute,
        channelId: Platform.OS === "android" ? REMINDER_CHANNEL_ID : undefined,
      },
    });
  }

  writeReminderPreferences(prefs);
  return { ok: true };
}
