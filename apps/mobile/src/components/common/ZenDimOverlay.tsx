import * as Brightness from "expo-brightness";
import React, { useEffect, useRef } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useBodhiI18n } from "../../state/I18nContext";

interface ZenDimOverlayProps {
  visible: boolean;
  timeText: string;
  subtitle?: string;
  onWake: () => void;
}

/**
 * Native OLED-friendly Zen Dim overlay: lowers hardware screen brightness via
 * `expo-brightness`, renders true `#000000` black, and restores the user's
 * original brightness automatically upon waking or unmounting.
 */
export function ZenDimOverlay({
  visible,
  timeText,
  subtitle,
  onWake,
}: ZenDimOverlayProps) {
  const { m } = useBodhiI18n();
  const previousBrightnessRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;

    const applyDim = async () => {
      try {
        const current = await Brightness.getBrightnessAsync();
        if (!active) return;
        previousBrightnessRef.current = current;
        await Brightness.setBrightnessAsync(0.03);
      } catch {
        // Ignore on unsupported simulators
      }
    };

    const restore = async () => {
      const prev = previousBrightnessRef.current;
      previousBrightnessRef.current = null;
      if (prev !== null) {
        try {
          await Brightness.setBrightnessAsync(prev);
        } catch {
          // Ignore
        }
      }
    };

    if (visible) {
      void applyDim();
    } else {
      void restore();
    }

    return () => {
      active = false;
      void restore();
    };
  }, [visible]);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      statusBarTranslucent
      presentationStyle="fullScreen"
      onRequestClose={onWake}
    >
      <Pressable
        style={styles.backdrop}
        onPress={onWake}
        accessibilityRole="button"
        accessibilityLabel={m.timer.wakeDimmedAria}
      >
        <View style={styles.center}>
          <Text style={styles.timeText}>{timeText}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          <Text style={styles.hint}>{m.timer.tapToWake}</Text>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "#000000",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  center: {
    alignItems: "center",
    gap: 12,
  },
  timeText: {
    fontSize: 48,
    fontWeight: "300",
    color: "rgba(236, 234, 228, 0.28)",
    fontVariant: ["tabular-nums"],
  },
  subtitle: {
    fontSize: 14,
    color: "rgba(236, 234, 228, 0.22)",
  },
  hint: {
    marginTop: 28,
    fontSize: 12,
    letterSpacing: 0.4,
    color: "rgba(236, 234, 228, 0.20)",
  },
});
