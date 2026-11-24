import React from "react";
import { StyleSheet, Text, View } from "react-native";
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
}

export function PracticeDial({
  progress,
  primaryText,
  secondaryText,
  orbScale,
  accentTone = "sage",
  size = 248,
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
        <Text
          style={[styles.primary, { color: colors.foreground }]}
          numberOfLines={1}
        >
          {primaryText}
        </Text>
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
  secondary: {
    fontSize: 13,
    fontWeight: "500",
    textAlign: "center",
  },
});
