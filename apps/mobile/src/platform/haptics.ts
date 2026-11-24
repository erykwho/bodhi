import * as Haptics from "expo-haptics";
import type { BreathingPhase } from "@bodhi/core/breathing/types";

/**
 * Triggers a gentle Taptic Engine / Android haptic pulse tailored to each
 * eyes-closed breathing phase transition.
 */
export function triggerBreathPhaseHaptic(
  phase: BreathingPhase,
  enabled: boolean
): void {
  if (!enabled) return;

  switch (phase) {
    case "inhale":
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      break;
    case "exhale":
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
      break;
    case "holdIn":
    case "holdOut":
      void Haptics.selectionAsync();
      break;
  }
}

export function triggerRetentionMinuteHaptic(enabled: boolean): void {
  if (!enabled) return;
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
}

export function triggerBellHaptic(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
}

export function triggerSelectionHaptic(): void {
  void Haptics.selectionAsync();
}

export function triggerSuccessHaptic(): void {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}
