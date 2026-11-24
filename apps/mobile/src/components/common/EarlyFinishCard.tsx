import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { BODHI_RADIUS } from "@bodhi/core/theme";
import { useBodhiI18n } from "../../state/I18nContext";
import { useBodhiTheme } from "../../state/ThemeContext";

interface EarlyFinishCardProps {
  visible: boolean;
  elapsedLabel: string;
  onSave: () => void;
  onDiscard: () => void;
  onResume: () => void;
}

export function EarlyFinishCard({
  visible,
  elapsedLabel,
  onSave,
  onDiscard,
  onResume,
}: EarlyFinishCardProps) {
  const { colors } = useBodhiTheme();
  const { m } = useBodhiI18n();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onResume}
    >
      <View style={styles.overlay}>
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.title, { color: colors.foreground }]}>
            {m.timer.savePartialTitle}
          </Text>
          <Text style={[styles.body, { color: colors.foregroundMuted }]}>
            {m.timer.meditatedFor(elapsedLabel)}
          </Text>

          <View style={styles.actions}>
            <Pressable
              onPress={onSave}
              style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
            >
              <Text style={styles.primaryBtnText}>
                {m.timer.saveSession}
              </Text>
            </Pressable>

            <Pressable
              onPress={onDiscard}
              style={[
                styles.secondaryBtn,
                { backgroundColor: colors.surfaceMuted },
              ]}
            >
              <Text
                style={[styles.secondaryBtnText, { color: colors.foreground }]}
              >
                {m.timer.discard}
              </Text>
            </Pressable>

            <Pressable onPress={onResume} style={styles.ghostBtn}>
              <Text
                style={[styles.ghostBtnText, { color: colors.foregroundMuted }]}
              >
                {m.timer.keepPracticing}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    borderRadius: BODHI_RADIUS.lg,
    borderWidth: 1,
    padding: 24,
    gap: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    textAlign: "center",
  },
  body: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  actions: {
    marginTop: 12,
    gap: 10,
  },
  primaryBtn: {
    borderRadius: BODHI_RADIUS.full,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryBtnText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "600",
  },
  secondaryBtn: {
    borderRadius: BODHI_RADIUS.full,
    paddingVertical: 13,
    alignItems: "center",
  },
  secondaryBtnText: {
    fontSize: 14,
    fontWeight: "500",
  },
  ghostBtn: {
    paddingVertical: 10,
    alignItems: "center",
  },
  ghostBtnText: {
    fontSize: 14,
    fontWeight: "500",
  },
});
