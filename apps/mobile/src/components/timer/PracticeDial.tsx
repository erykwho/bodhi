import React from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { useBodhiTheme } from "../../state/ThemeContext";

interface PracticeDialProps {
  /** Progress in [0, 1] for ring stroke. */
  progress: number;
  /** Primary display text (MM:SS or breath countdown). */
  primaryText: string;
  /** Secondary caption inside the ring. */
  secondaryText?: string;
  /** Optional normalized breathing orb expansion in [0, 1]. */
  orbScale?: number;
  /** Optional subtle amber accent (e.g. during warm-up or retention). */
  accentTone?: "sage" | "amber";
  size?: number;
  /** Enables tap-to-edit on the primary display when idle. */
  editable?: boolean;
  isEditing?: boolean;
  editValue?: string;
  editUnit?: string;
  editAccessibilityLabel?: string;
  inputAccessibilityLabel?: string;
  onPressPrimary?: () => void;
  onChangeEditValue?: (value: string) => void;
  onSubmitEdit?: () => void;
  onBlurEdit?: () => void;
}

export function PracticeDial({
  progress,
  primaryText,
  secondaryText,
  orbScale,
  accentTone = "sage",
  size = 248,
  editable = false,
  isEditing = false,
  editValue = "",
  editUnit = "min",
  editAccessibilityLabel,
  inputAccessibilityLabel,
  onPressPrimary,
  onChangeEditValue,
  onSubmitEdit,
  onBlurEdit,
}: PracticeDialProps) {
  const { colors } = useBodhiTheme();
  const strokeWidth = 6;
  const radius = (size - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const clampedProgress = Math.min(1, Math.max(0, progress));
  const strokeDashoffset = circumference * (1 - clampedProgress);
  const strokeColor =
    accentTone === "amber" ? colors.warmAmber : colors.accent;

  const orbRadius =
    orbScale !== undefined
      ? radius * (0.42 + Math.min(1, Math.max(0, orbScale)) * 0.48)
      : null;

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Svg width={size} height={size} style={styles.svg}>
        {orbRadius !== null ? (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={orbRadius}
            fill={strokeColor}
            fillOpacity={0.14}
          />
        ) : null}

        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={colors.surfaceMuted}
          strokeWidth={strokeWidth}
          fill="none"
        />

        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={strokeDashoffset}
          rotation={-90}
          origin={`${size / 2}, ${size / 2}`}
          fill="none"
        />
      </Svg>

      <View style={styles.center}>
        {isEditing ? (
          <View
            style={[
              styles.editBox,
              {
                backgroundColor: colors.surfaceMuted,
                borderColor: colors.accent,
              },
            ]}
          >
            <TextInput
              value={editValue}
              onChangeText={onChangeEditValue}
              onSubmitEditing={onSubmitEdit}
              onBlur={onBlurEdit}
              keyboardType="number-pad"
              returnKeyType="done"
              maxLength={3}
              autoFocus
              selectTextOnFocus
              accessibilityLabel={inputAccessibilityLabel}
              style={[styles.editInput, { color: colors.foreground }]}
            />
            <Text
              style={[styles.editUnit, { color: colors.foregroundMuted }]}
            >
              {editUnit}
            </Text>
          </View>
        ) : editable && onPressPrimary ? (
          <Pressable
            onPress={onPressPrimary}
            accessibilityRole="button"
            accessibilityLabel={editAccessibilityLabel}
            style={({ pressed }) => [
              styles.editableTrigger,
              {
                borderBottomColor: colors.border,
                backgroundColor: pressed ? colors.surfaceMuted : "transparent",
              },
            ]}
          >
            <Text
              style={[styles.primary, { color: colors.foreground }]}
              numberOfLines={1}
            >
              {primaryText}
            </Text>
          </Pressable>
        ) : (
          <Text
            style={[styles.primary, { color: colors.foreground }]}
            numberOfLines={1}
          >
            {primaryText}
          </Text>
        )}
        {secondaryText ? (
          <Text
            style={[styles.secondary, { color: colors.foregroundMuted }]}
            numberOfLines={2}
          >
            {secondaryText}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
  },
  svg: {
    position: "absolute",
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 4,
  },
  primary: {
    fontSize: 44,
    fontWeight: "300",
    letterSpacing: -1,
    fontVariant: ["tabular-nums"],
  },
  editableTrigger: {
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 12,
    borderBottomWidth: 1,
    borderStyle: "dashed",
  },
  editBox: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 14,
    borderWidth: 1,
  },
  editInput: {
    fontSize: 40,
    fontWeight: "300",
    letterSpacing: -1,
    fontVariant: ["tabular-nums"],
    textAlign: "center",
    minWidth: 72,
    padding: 0,
  },
  editUnit: {
    fontSize: 14,
    fontWeight: "500",
  },
  secondary: {
    fontSize: 13,
    fontWeight: "500",
    textAlign: "center",
  },
});
